# Moka OTP Auto-Provision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member yang terdaftar di Moka POS bisa login via OTP dan langsung melihat data asli mereka (nama, poin, tier, membership status) tanpa membuat akun baru dari nol.

**Architecture:** Saat `POST /api/auth/otp/send` dipanggil dan nomor tidak ditemukan di tabel `customers`, server fallback ke `member_profiles` (Moka-seeded). Jika ditemukan, buat row baru di `customers` dengan data Moka (auto-provision, satu kali saja, upsert by `wa`). Selanjutnya data hidup di `customers`.

**Tech Stack:** Node.js + Express, Supabase JS client (`@supabase/supabase-js`), PostgreSQL (via Supabase)

**Spec:** `docs/superpowers/specs/2026-05-30-moka-otp-auto-provision-design.md`

---

## File Map

| File | Aksi |
|------|------|
| `server/migrations/2026-05-30-customers-points-column.sql` | CREATE — tambah kolom `points` ke `customers` jika belum ada |
| `server/index.js` (lines 1812–1819) | MODIFY — ganti blok cek customer di `otp/send` |

`otp/verify`, `auth/me`, dan semua file frontend tidak disentuh.

---

## Task 1: Tambah kolom `points` ke tabel `customers`

**Files:**
- Create: `server/migrations/2026-05-30-customers-points-column.sql`

> **Catatan:** Kode existing di `sync-customers-full` (line 1768) sudah ada fallback jika kolom `points` tidak ada — artinya kolom ini mungkin belum eksis di production. Migration ini idempotent (`IF NOT EXISTS`), aman dijalankan berulang.

- [ ] **Step 1: Buat file migration**

Buat file `server/migrations/2026-05-30-customers-points-column.sql` dengan isi:

```sql
-- Tambah kolom points ke customers jika belum ada.
-- Idempotent — aman dijalankan berulang.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;

-- Backfill dari member_profiles untuk member yang sudah ada
-- tapi belum punya points (matching by phone_e164 ↔ member_profiles.phone)
UPDATE customers c
SET    points = COALESCE(mp.total_points, c.visits * 10)
FROM   member_profiles mp
WHERE  mp.phone      = c.phone_e164
  AND  mp.total_points > 0
  AND  (c.points IS NULL OR c.points = 0);
```

- [ ] **Step 2: Jalankan di Supabase SQL Editor**

Buka Supabase Dashboard → SQL Editor → paste isi file di atas → Run.

Expected output: `ALTER TABLE` lalu `UPDATE X` (X = jumlah row yang ter-backfill).

- [ ] **Step 3: Verifikasi kolom ada**

Jalankan di Supabase SQL Editor:
```sql
SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_name = 'customers'
  AND  column_name = 'points';
```

Expected: 1 row dengan `column_name = 'points'`, `data_type = 'integer'`.

---

## Task 2: Implementasi auto-provision di `otp/send`

**Files:**
- Modify: `server/index.js` lines 1812–1819

- [ ] **Step 1: Baca kode existing sebelum diubah**

Cari blok ini di `server/index.js` (sekitar line 1812):

```js
    // Cek customer terdaftar
    const { data: customer } = await supabase
      .from('customers').select('id, name, wa').eq('wa', wa).maybeSingle();
    if (!customer) {
      return res.status(404).json({
        error: 'Nomor tidak terdaftar sebagai member. Silakan kunjungi outlet untuk mendaftar.'
      });
    }
```

- [ ] **Step 2: Ganti dengan implementasi baru**

Ganti seluruh blok di atas dengan:

```js
    // Cek customer terdaftar
    let { data: customer } = await supabase
      .from('customers').select('id, name, wa').eq('wa', wa).maybeSingle();

    if (!customer) {
      // Fallback: cek member_profiles (member terdaftar via Moka POS)
      const phoneE164 = '+' + wa;
      const { data: profile } = await supabase
        .from('member_profiles')
        .select('full_name, phone, email, membership_status, membership_activated_at, total_points, total_visits, referral_code, birthdate, gender, address')
        .eq('phone', phoneE164)
        .maybeSingle();

      if (!profile) {
        return res.status(404).json({
          error: 'Nomor tidak terdaftar sebagai member. Silakan kunjungi outlet untuk mendaftar.'
        });
      }

      // Auto-provision ke customers — satu kali saja
      // upsert onConflict:'wa' mencegah duplikasi saat race condition
      const isSyntheticEmail = Boolean(
        profile.email && /^moka_.+@redbox\.internal$/.test(profile.email)
      );
      const bd = profile.birthdate ? new Date(profile.birthdate) : null;
      const provisionData = {
        name:                    profile.full_name || '',
        wa,
        phone_e164:              phoneE164,
        email:                   isSyntheticEmail ? null : (profile.email || null),
        membership_status:       profile.membership_status || 'INACTIVE',
        membership_activated_at: profile.membership_activated_at || null,
        points:                  Number(profile.total_points) || 0,
        visits:                  Number(profile.total_visits) || 0,
        referral_code:           profile.referral_code || generateReferralCode(),
        birth_date:              profile.birthdate || null,
        ...(bd && !isNaN(bd) ? {
          birthday: `${String(bd.getUTCMonth()+1).padStart(2,'0')}-${String(bd.getUTCDate()).padStart(2,'0')}`
        } : {}),
        gender:  profile.gender  || null,
        address: profile.address || null,
      };

      let { data: provisioned, error: provErr } = await supabase
        .from('customers')
        .upsert(provisionData, { onConflict: 'wa' })
        .select('id, name, wa')
        .single();

      // Fallback jika kolom points belum ada di DB (defensive — lihat line ~1768)
      if (provErr?.message?.includes('points')) {
        const { points: _, ...withoutPoints } = provisionData;
        ({ data: provisioned, error: provErr } = await supabase
          .from('customers')
          .upsert(withoutPoints, { onConflict: 'wa' })
          .select('id, name, wa')
          .single());
      }

      if (provErr) {
        console.warn('[OTP] Auto-provision gagal, lanjut in-memory:', provErr.message);
        customer = { id: null, name: provisionData.name, wa };
      } else {
        customer = provisioned;
        console.log(`[OTP] Auto-provision sukses: ${wa}`);
      }
    }
```

> **Catatan penting:** `generateReferralCode()` sudah terdefinisi di scope yang sama (dalam blok `{ ... }` auth section, sekitar line 1794). Tidak perlu import tambahan.

- [ ] **Step 3: Simpan file**

---

## Task 3: Verifikasi manual (integration test)

Server harus sudah running (`node server/index.js` atau via Vercel dev).

- [ ] **Test 1 — Member Moka bisa kirim OTP**

Ambil satu nomor yang ADA di `member_profiles` tapi BELUM ada di `customers`. Jalankan di terminal:

```bash
curl -s -X POST https://redboxbarbershop.com/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"08XXXXXXXXXX"}' | jq .
```

Expected response:
```json
{ "success": true, "message": "Kode OTP sudah dikirim ke WhatsApp kamu 🎉" }
```

Verifikasi row terbuat di Supabase:
```sql
SELECT name, wa, membership_status, points, visits
FROM   customers
WHERE  wa = '628XXXXXXXXXX';
```

Expected: 1 row dengan data dari Moka (nama benar, poin > 0, membership_status = 'ACTIVE' jika member aktif).

- [ ] **Test 2 — Nomor tidak terdaftar di mana pun**

```bash
curl -s -X POST https://redboxbarbershop.com/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"08000000000"}' | jq .
```

Expected response (404):
```json
{ "error": "Nomor tidak terdaftar sebagai member. Silakan kunjungi outlet untuk mendaftar." }
```

- [ ] **Test 3 — Member yang sudah ada di customers tidak berubah**

Ambil nomor yang sudah ada di `customers`. Kirim OTP → harus tetap sukses tanpa ada perubahan data existing.

```bash
curl -s -X POST https://redboxbarbershop.com/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"08YYYYYYYYYY"}' | jq .
```

Expected: `{ "success": true, ... }` — sama seperti sebelumnya.

- [ ] **Test 4 — Login end-to-end di browser**

1. Buka `redboxbarbershop.com/member-login.html` di HP (mobile)
2. Masukkan nomor member Moka yang ditest di Test 1
3. Masukkan OTP yang diterima di WA
4. Cek dashboard — pastikan: nama sesuai Moka, poin sesuai, membership status sesuai

---

## Task 4: Commit

- [ ] **Step 1: Stage perubahan**

```bash
git add server/index.js \
        server/migrations/2026-05-30-customers-points-column.sql \
        docs/superpowers/specs/2026-05-30-moka-otp-auto-provision-design.md \
        docs/superpowers/plans/2026-05-30-moka-otp-auto-provision.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: auto-provision Moka members on first OTP login

Member yang terdaftar di Moka POS kini bisa login via OTP tanpa
error 404. Saat nomor tidak ditemukan di customers, fallback ke
member_profiles — jika ada, buat row di customers dengan data Moka
(nama, poin, tier, membership_status) secara otomatis.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Checklist Akhir

- [ ] Migration `points` sudah dijalankan di Supabase
- [ ] Migration `membership_status` (dari sesi sebelumnya) sudah dijalankan
- [ ] Test 1: Moka member dapat OTP ✓
- [ ] Test 2: Nomor tak terdaftar tetap 404 ✓
- [ ] Test 3: Member existing tidak terpengaruh ✓
- [ ] Test 4: Dashboard mobile menampilkan data Moka ✓
- [ ] Commit berhasil ✓
