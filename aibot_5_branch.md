# AI Bot Override — 5 Branch Implementation

## Objective
Implementasi sistem override AI bot. Ketika admin/manusia takeover percakapan, AI bot OFF selama 30 menit. **Berlaku di SEMUA cabang** (Bypass, Sumber, Samadikun, CSB Mall, Tegal) via Supabase shared state.

---

## Arsitektur

### 2 Webhook System
1. **Fonnte Webhook** (`api/wa/webhook.js`) — Vercel serverless, pakai Fonnte gateway
2. **WhatsApp Cloud API** (`server/whatsapp-ai/`) — Express server, pakai Meta Cloud API

Keduanya sekarang share state via Supabase `wa_paused` table.

### Supabase Table: `wa_paused`
```sql
CREATE TABLE IF NOT EXISTS wa_paused (
  sender text PRIMARY KEY,
  paused_until timestamptz NOT NULL,
  paused_at timestamptz DEFAULT now(),
  paused_by text DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_wa_paused_until ON wa_paused (paused_until);
```

### Branch WA Numbers (Fonnte)
- **Bypass**: 0818202569
- **Sumber**: 0818202599
- **Samadikun**: 0818202589
- **CSB Mall**: 0818202889
- **Tegal**: 0818268883

### Fonnte Token Env Vars
- `FONNTE_TOKEN` (Bypass/default)
- `FONNTE_TOKEN_SUMBER`
- `FONNTE_TOKEN_SAMADIKUN`
- `FONNTE_TOKEN_CSB`
- `FONNTE_TOKEN_TEGAL`

---

## File yang Diubah

### 1. `server/whatsapp-ai/services/handoffStore.js` — Major Upgrade
**Sebelum:** File-based storage (handoff.json), hanya local per instance.
**Sesudah:** Supabase `wa_paused` table sebagai shared state cross-branch + file fallback.

Perubahan:
- Ditambah lazy Supabase client init (`_getSupabase()`)
- `enableHandoff(customerPhone, durationMinutes, pausedBy)` — persist ke Supabase + local file
- `disableHandoff(customerPhone)` — hapus dari Supabase + local
- `isHandoffActive(customerPhone)` — sync, cek local cache saja (fast path)
- **BARU:** `isHandoffActiveAsync(customerPhone)` — async, cek local → fallback Supabase (cross-branch)
- **BARU:** `getAllActive()` — sekarang async, query Supabase untuk complete cross-branch view
- `extendHandoff()` — juga persist ke Supabase
- Tracking `paused_by` untuk audit trail

### 2. `server/whatsapp-ai/services/messageHandler.js` — Admin Commands + Async Check
**Sebelum:** Hanya punya `/ai_on` command.
**Sesudah:** Full admin command suite + async cross-branch handoff check.

Perubahan:
- **BARU:** `handleAdminCommand(from, lower, text)` function dengan 4 commands:
  - `/ai_off 628xxx [menit]` — matikan AI untuk customer (default 30m)
  - `/ai_on 628xxx` — hidupkan AI kembali
  - `/ai_status` — lihat semua AI yang sedang OFF (cross-branch)
  - `/ai_help` — tampilkan daftar commands
- Handoff check diganti dari `handoffStore.isHandoffActive(from)` → `handoffStore.isHandoffActiveAsync(from)` untuk cross-branch lookup via Supabase
- Admin command hanya bisa dipakai oleh `config.ADMIN_WHATSAPP`

### 3. `api/wa/webhook.js` (Fonnte) — Admin Commands + Improved Tracking
Perubahan:
- **BARU:** `handleAdminCommand(sender, message, device)` — 4 admin commands sama seperti di messageHandler
- Admin check dari `ADMIN_WA` + `WA_ADMIN_NUMBER` env vars
- Intercept `/ai_*` commands di POST handler sebelum human takeover check (line ~1969-1976)
- `persistHumanTakeover(phone, pausedBy)` — sekarang terima `pausedBy` parameter untuk tracking
- `listPausedSenders()` — filter expired entries + include `paused_by` column
- Human takeover auto-detect sekarang track branch name: `manual_reply_${branchName}`

### 4. `server/whatsapp-ai/controllers/webhookController.js` — Minor Fix
- `detectAdminIntervention()` sekarang pass `pausedBy: 'cloud_api_status'` ke `enableHandoff()`

### 5. File Baru
- `server/migrations/wa_paused_add_paused_by.sql` — DDL untuk create table
- `@supabase/supabase-js` ditambahkan ke `server/whatsapp-ai/package.json`

---

## Cara Kerja

### Auto-detect (tanpa command)
1. Admin balas chat customer manual dari HP (cabang manapun)
2. Fonnte kirim webhook dengan `isFromMe: true`
3. System detect outgoing message → set human takeover
4. Persist ke Supabase `wa_paused` table + local Map
5. **Semua cabang** baca dari Supabase → AI OFF untuk customer tersebut
6. Setelah 30 menit → expired otomatis

### Manual via Admin Command
1. Admin kirim `/ai_off 628123456789 60` ke nomor WA cabang manapun
2. System detect admin command → persist ke Supabase
3. Semua cabang respect override tersebut
4. Admin bisa cek status: `/ai_status`
5. Admin bisa cancel: `/ai_on 628123456789`

### Cross-Branch Flow
```
Admin balas dari HP Sumber
    ↓
Fonnte webhook detect isFromMe
    ↓
setHumanTakeoverLocal() + persistHumanTakeover() → Supabase wa_paused
    ↓
Customer kirim pesan ke Bypass
    ↓
isHumanTakeover() → cek local Map (miss) → cek Supabase (hit!)
    ↓
AI skip response → "human_takeover active"
```

---

## Admin Commands Reference

| Command | Deskripsi | Contoh |
|---|---|---|
| `/ai_off 628xxx [menit]` | Matikan AI untuk customer | `/ai_off 628123456789 30` |
| `/ai_on 628xxx` | Hidupkan AI kembali | `/ai_on 628123456789` |
| `/ai_status` | Lihat semua AI yang OFF | `/ai_status` |
| `/ai_help` | Tampilkan bantuan | `/ai_help` |

**Catatan:** Command hanya bisa dipakai oleh nomor admin yang terdaftar di `ADMIN_WHATSAPP` atau `WA_ADMIN_NUMBER`.

---

## Trigger → Efek

| Trigger | Efek | Durasi | paused_by |
|---|---|---|---|
| Admin balas manual dari HP | AI OFF otomatis | 30 menit | `manual_reply_bypass` / `manual_reply_sumber` / etc |
| `/ai_off 628xxx` | AI OFF manual | 30m (atau custom) | `admin_628xxx` |
| `/ai_on 628xxx` | AI ON kembali | instant | — |
| WA Cloud API status webhook | AI OFF otomatis | 30 menit | `cloud_api_status` |
| Timer habis | AI ON otomatis | — | — |

---

## Dependencies

### server/whatsapp-ai/package.json
```json
"@supabase/supabase-js": "^2.45.0"  ← BARU
```

### Environment Variables (sudah ada)
- `SUPABASE_URL` — dari server/.env (sudah ada)
- `SUPABASE_SERVICE_KEY` — dari server/.env (sudah ada)
- `ADMIN_WHATSAPP` — nomor admin
- `WA_ADMIN_NUMBER` — nomor admin (alternatif)
- `HANDOFF_DURATION_MINUTES` — default 30

---

## Supabase Migration
File: `server/migrations/wa_paused_add_paused_by.sql`
Status: **SUDAH DIJALANKAN** di Supabase SQL Editor.

---

## Testing Checklist
- [ ] Admin balas manual dari HP → AI OFF 30m (cek di Supabase)
- [ ] `/ai_off 628xxx` → AI OFF, confirm di `/ai_status`
- [ ] `/ai_on 628xxx` → AI ON kembali
- [ ] Cross-branch: admin balas dari Sumber, customer chat ke Bypass → AI tetap OFF
- [ ] Timer 30 menit → AI otomatis ON (expired row di Supabase)
- [ ] `/ai_status` → tampilkan semua active overrides dari semua cabang
