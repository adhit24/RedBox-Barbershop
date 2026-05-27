# Investigasi: Slot Moka Open Bill Tidak Memblokir Web Booking

**Tanggal:** 2026-05-28 (WIB)
**Status saat pause:** Phase 1 — Root cause sudah diidentifikasi (Moka API `/v1/.../sync_bills/` returning 404 untuk semua outlet sejak 2026-05-19). Belum Phase 2/3/4 (pattern analysis, hypothesis test, fix).

---

## Pertanyaan asli

> "Kenapa slot jam 13.00 dan 15.00 abdul tidak terblokir/coret? padahal jelas di moka openbill terbuka"

Screenshot 1 (Moka POS Billing Management — Open Bills tab) menampilkan:
- `fajar 28/05 15.00 abdul` — 5h 57min open
- `riched hansen 28/05 13.00 abdul` — 9h 34min open
- `✔tomy` — 6h 5min open (format beda, no time)

Screenshot 2 (booking page RedBox, Choose Date & Time, May 2026 day 28) — slot 10:00–20:00 semua available, tidak ada coret.

---

## Investigasi (Phase 1: Root Cause)

### Tools yang sudah dipakai
- Memory: `project_moka_integration.md`, `project_moka_goshow_fix.md`
- Supabase MCP execute_sql
- Vercel MCP get_runtime_logs
- Bash curl ke production endpoint diagnostic

### Konteks code

**Pipeline yang diharapkan:**
1. UI booking → GET `/api/availability?outletId=&date=&barberId=&durationMinutes=`
2. Endpoint trigger `_refreshFreshTodayData()` (await sync)
3. Sync function: `pullMokaToWeb` → di [server/moka/sync.js:292](server/moka/sync.js#L292)
4. Pull 1: completed orders via `client.getOrders()` (v3/reports)
5. Pull 3: open bills via `client.getOpenBills(startWIB, tomorrowWIB)` di [sync.js:386](server/moka/sync.js#L386)
6. Untuk tiap bill PENDING → `_processOpenBill()` di [sync.js:720](server/moka/sync.js#L720)
7. Insert ke `schedules` table dengan `barber_id`, `start_time`, `end_time`, `status='reserved'`, `source='moka'`

**Parser bill name** (di [server/moka/improved-sync.js:77](server/moka/improved-sync.js#L77)):
```js
const structuredPattern = /^(\S+)\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\s+(\d{1,2}[.:]\d{2})\s+(.+)$/i;
```

⚠️ **Potential issue (belum diverifikasi):** regex pakai `\S+` (one token) untuk customer name. Bill "riched hansen 28/05 13.00 abdul" punya 2-kata customer, structured parse akan **gagal** dan fall-through ke fuzzy match. Tapi fuzzy match seharusnya tetap nemu "abdul" via substring. Bukan root cause utama (lihat di bawah).

**Time parser** di [sync.js:680](server/moka/sync.js#L680) (fungsi `_parseAppointmentTimeFromBillName`):
```js
const matchTimeOnly = billName.match(/\b(\d{1,2})[.:](\d{2})\b/);
```
Cari pola `HH.MM` atau `HH:MM`. Untuk "fajar 28/05 15.00 abdul" → "15.00" match, hours=15. Robust.

### Fakta dari produksi

**1. Outlet & barber Abdul:**
```
Abdul ( Dul ) — id: bypass-abdul-dul — outlet: bypass (RedBox Bypass)
```

**2. Schedules table — zero untuk Abdul/outlet-wide hari ini:**
```sql
SELECT ... FROM schedules WHERE outlet_id = bypass
  AND start_time < '2026-05-28T23:59:59+07:00'
  AND end_time > '2026-05-28T00:00:00+07:00'
  AND (barber_id = 'bypass-abdul-dul' OR barber_id IS NULL);
-- result: []
```

**3. Last Moka-source schedule pernah inserted:**
```
2026-05-19 20:52 WIB → setelah itu nothing.
```
**9 hari blackout.** Sync tetap di-trigger tiap 5-9 menit (cron-job.org) tapi tidak nge-insert apapun.

**4. Moka OAuth tokens semua valid** (expire November 2026, refreshed dalam minggu terakhir).
```
bypass: refreshed 2026-05-20 01:28 (sehari sebelum break) → token valid
csb:    refreshed 2026-05-26
samadikun: 2026-05-27
sumber: 2026-05-24
tegal:  2026-05-25
```

**5. sync_logs hanya track summary `_finishLog`** — error dari `getOpenBills` di-catch silent ke `console.warn` di [sync.js:386-389](server/moka/sync.js#L386-L389):
```js
try { billsRes = await client.getOpenBills(startWIB, tomorrowWIB); }
catch (e) {
  console.warn(`[Sync] getOpenBills(${startWIB}…${tomorrowWIB}) skipped (${e.message})`);
  billsRes = null;
}
```
Sehingga sync_logs selalu nunjukin `processed: 0` tanpa error_message — silent failure.

**6. Vercel runtime logs menampilkan WARNING `[Sync] getOpenBills(...` tiap sync (5 menit-an) tapi pesan ter-truncate di tabel.**

**7. Diagnostic endpoint `/api/moka/open-bills` mengexpose error penuh:**
```bash
curl "https://www.redboxbarbershop.com/api/moka/open-bills?date=2026-05-28"
```
**Hasil — semua 5 outlet kena 404:**
```
RedBox Bypass    -> Moka API GET /v1/outlets/100818/sync_bills/?statuses=PENDING&start=28/05/2026&end=28/05/2026&per_page=200&deep=true → 404
RedBox Samadikun -> Moka API GET /v1/outlets/105517/sync_bills/... → 404
RedBox CSB Mall  -> Moka API GET /v1/outlets/216102/sync_bills/... → 404
RedBox Sumber    -> Moka API GET /v1/outlets/592422/sync_bills/... → 404
RedBox Tegal     -> Moka API GET /v1/outlets/1023616/sync_bills/... → 404
```

## 🎯 Root Cause (confirmed)

**Moka API endpoint `GET /v1/outlets/{id}/sync_bills/` mengembalikan 404 untuk semua outlet sejak ~2026-05-19/20.** 

Token-nya valid (bukan 401), endpoint deprecated/dipindah/dicabut aksesnya. Karena sync.js catch error silent ke console.warn (tidak ke sync_logs), bug ini menjalar 9 hari tanpa visibility.

**Definisi pipeline yang patah:**
- Web sync API masih jalan (cron-job.org hit tiap 5 menit, response `202`)
- _finishLog tetap nulis `processed: 0` sebagai "success"
- Tapi `getOpenBills` selalu throw 404 → ke catch silent
- Schedules table tidak pernah di-update untuk advance bill / GoShow

---

## Yang belum dikerjakan (resume here)

### Phase 2 — Pattern analysis

- [ ] Cek Moka API docs current spec untuk endpoint open-bill alternatif. Klien punya method ini di [server/moka/client.js:87](server/moka/client.js#L87). Path sekarang: `/v1/outlets/{outlet_id}/sync_bills/?statuses=PENDING&start=DD/MM/YYYY&end=DD/MM/YYYY&per_page=200&deep=true`.
- [ ] Apakah Moka migrasi ke endpoint baru? Misal:
  - `/v2/outlets/{id}/bills?...`
  - `/v3/outlets/{id}/bills?...`
  - Atau `/v1/outlets/{id}/orders?status=pending`
  - Atau path tanpa trailing slash: `/v1/outlets/{id}/sync_bills?...`
- [ ] Coba variants curl manual ke Moka API (butuh access token) untuk eksperimen path mana yang return 200.

### Phase 3 — Hypothesis

Hipotesis kandidat (sesuai prioritas):
1. **Endpoint path berubah** (Moka API spec update). Fix: update `client.getOpenBills()`.
2. **Trailing slash bug** — `/sync_bills/?` mungkin sekarang harus tanpa `/`. Fix: hapus trailing slash.
3. **Access scope dicabut** — token valid tapi `sync_bills` permission diturunkan. Fix: re-authorize dengan scope baru.
4. **Outlet ID format berubah** — Moka outlet IDs ada di kolom `outlets.moka_outlet_id` (e.g. 100818). Mungkin sekarang butuh format/encoding berbeda.

### Phase 4 — Implementation (setelah hypothesis confirmed)

- [ ] Update `client.getOpenBills()` dengan endpoint baru
- [ ] **Tambah error logging non-silent**: Bug ini dapat lolos 9 hari karena `console.warn`-only di [sync.js:386-389](server/moka/sync.js#L386-L389) dan [sync.js:420-422](server/moka/sync.js#L420-L422). Setidaknya tulis ke `sync_logs` table dengan `status=failed` saat `getOpenBills` throw — supaya cron monitoring kelihatan failure.
- [ ] Trigger manual sync untuk validasi (POST `/api/moka/sync` dengan CRON_SECRET)
- [ ] Verifikasi: query schedules table untuk Bypass hari ini — Abdul slot 13:00 & 15:00 harus ada
- [ ] Verifikasi UI: booking page Bypass + Abdul + 28/05 — slot 13:00 & 15:00 harus tercoret

### Backlog issues (out of scope tapi worth noting)

1. **Parser `_parseStructuredBillName` regex** ([improved-sync.js:82](server/moka/improved-sync.js#L82)) hanya support 1-token customer name. "riched hansen 28/05 13.00 abdul" akan jatuh ke fuzzy. Bukan blocker root cause (fuzzy berhasil match "abdul") tapi sebaiknya regex di-improve jadi `^(.+?)\s+(\d{1,2}[\/.-]\d{1,2})...`.
2. **Silent error handling** di sync flow secara umum (line 386, 420, 414). Bug ini contoh nyata dari over-eager catch — failure 9 hari tanpa visibility.
3. **Memory entries soal Moka cron-job.org masih akurat** — Job ID 7568788, auth Bearer CRON_SECRET, schedule every 5 minutes. Tidak ada hubungan dengan kemarin pruning Vercel cron.

---

## Snapshot state sebelum pause

**Commits di production:**
- `9428deb` (READY) — last successful deploy, current production

**Refactor Hobby plan baru kelar:**
- 12 functions (sebelumnya 13 — dipangkas webhook-meta)
- 2 crons (sebelumnya 4 — moka-sync & expire-stale-bills pindah ke external scheduler nantinya)
- `/api/cron/moka-sync` sebagai HTTP function tetap reachable (untuk cron-job.org nanti)

**Sync mechanism real-time:**
- cron-job.org Job ID 7568788 hits POST `/api/moka/sync` every 5 minutes
- Plus on-demand await di `/api/availability`, `/api/schedules`, `/api/slot-blockers` (per commit 924b7ab)
- **TAPI** semua silent-fail karena 404 di getOpenBills

**Affected files saat investigasi:**
- [server/moka/sync.js](server/moka/sync.js) — silent catch line 386-389
- [server/moka/client.js](server/moka/client.js#L87) — getOpenBills endpoint definition
- [server/moka/improved-sync.js](server/moka/improved-sync.js) — parser regex (backlog)

**Commands untuk resume verification:**
```bash
# 1. Cek apakah masih 404
curl "https://www.redboxbarbershop.com/api/moka/open-bills?outletId=bypass&date=2026-05-28"

# 2. Manual trigger sync (test setelah fix)
curl -X POST "https://www.redboxbarbershop.com/api/moka/sync" \
  -H "Authorization: Bearer 1c78d4adde332e0714a0af5f9c003379af955242444dacb7ba87be5acacc5172"

# 3. Cek schedules muncul setelah sync
# (via Supabase MCP execute_sql ke project khcvklzxfohwkyocenaf — query schedules table)
```
