# RedBox WhatsApp AI Assistant

WhatsApp AI chatbot untuk RedBox Barbershop. Runtime produksi menerima webhook Fonnte di `api/wa/webhook.js` dan mengirim pesan melalui `server/services/fonnte.js`. Folder ini berisi policy, knowledge base, service status booking, dan legacy Express adapter untuk kompatibilitas/testing.

---

## Arsitektur

```
whatsapp-ai/
 ├── app.js                    # Entry point
 ├── config/index.js           # All config & env vars
 ├── routes/webhook.js         # Express routes
 ├── controllers/
 │   └── webhookController.js  # Webhook verify + receive
 ├── services/
 │   ├── messageHandler.js     # Orchestrator — routes messages
 │   ├── whatsappService.js    # Send messages via WA Cloud API
 │   ├── aiService.js          # GPT-4o-mini integration
 │   ├── bookingStatusService.js # Status booking dari database website
 │   ├── bookingService.js     # Guard legacy booking chat (disabled)
 │   ├── knowledgeService.js   # Load + query knowledge base
 │   ├── escalationService.js  # Keyword-based escalation
 │   └── handoffStore.js       # Human takeover detection & state
 ├── prompts/system.txt        # AI personality + decision boundaries
 ├── policy/                   # Policy matrix + regression scenarios
 ├── knowledge/
 │   ├── services.json         # Daftar layanan & harga
 │   └── faq.json              # FAQ dengan keywords
 ├── middleware/
 │   ├── rateLimiter.js        # Per-user request limiter
 │   └── costGuard.js          # Daily AI call limit + cooldown
 ├── utils/logger.js           # File-based logging
 ├── logs/                     # Auto-generated log files
 ├── .env.example
 └── package.json
```

---

## Instalasi

```bash
cd server/whatsapp-ai
npm install
cp .env.example .env
# Edit .env dengan credentials kamu
node app.js
```

---

## Gateway Produksi: Fonnte

Webhook perangkat Fonnte diarahkan ke:

`https://redboxbarbershop.com/api/wa/webhook`

Status booking customer dibaca dari tabel `bookings` Supabase. Hanya status `confirmed` yang boleh dipakai untuk menyatakan booking aman; chat tidak dapat membuat booking outlet.

## Legacy WhatsApp Cloud API Adapter

Folder Express di bawah ini bukan entrypoint produksi Fonnte. Gunakan hanya untuk kompatibilitas/testing terisolasi.

1. Buka https://developers.facebook.com/apps/
2. Buat App → Business → WhatsApp
3. Ambil **Phone Number ID** dan **Access Token** dari API Setup
4. Set Webhook URL: `https://your-domain.com/webhook`
5. Set **Verify Token** sama dengan `WA_VERIFY_TOKEN` di `.env`
6. Subscribe ke event: `messages`

### Expose local untuk testing (pakai ngrok):
```bash
ngrok http 3001
# Copy URL: https://xxxx.ngrok.io/webhook → paste ke Meta Webhook
```

---

## Flow Pesan

```
Customer WA
    ↓
Webhook POST /webhook
    ↓
rateLimiter (max 5 msg/menit per user)
    ↓
webhookController.receive()
    ↓
messageHandler.handle()
    ├── Booking flow active? → legacy guard → website redirect
    ├── Escalation keywords? → escalationService.escalate()
    ├── Keyword match (harga/booking/faq)? → direct reply
    ├── costGuard (cooldown + daily limit)
    └── AI fallback → aiService.chat() → GPT-4o-mini
    ↓
whatsappService.sendText()
    ↓
Customer menerima balasan
```

---

## Human Handoff (Admin Takeover)

Saat admin WhatsApp Business manual membalas pelanggan, bot akan **otomatis diam** agar tidak mengganggu percakapan manusia.

### Cara Kerja

1. **Explicit control**: Admin memakai `/ai_off` dan `/ai_on`; status `sent/delivered/read` tidak otomatis dianggap balasan admin.
2. **Handoff aktif**: Mode handoff aktif untuk customer tersebut
3. **Bot berhenti**: Bot tidak merespons pesan dari customer selama handoff aktif
4. **Auto-expire**: Handoff mati sendiri setelah timeout (default 30 menit)

### Konfigurasi

```bash
# Di .env — ubah durasi handoff (menit) jika memakai /ai_off
HANDOFF_DURATION_MINUTES=30

# Scheduler lokal legacy tidak aktif secara default.
WHATSAPP_AI_LOCAL_SCHEDULER_ENABLED=0
```

### Perintah Admin

| Perintah | Fungsi |
|----------|--------|
| `/ai_off 628123456789 [menit]` | Matikan AI sementara untuk customer |
| `/ai_on 628123456789` | Aktifkan kembali AI untuk customer tertentu |

Contoh: Admin kirim `/ai_off 628xxx 30` → bot diam 30 menit → admin kirim `/ai_on 628xxx` → bot aktif lagi.

---

## Cost Protection

| Layer | Implementasi |
|-------|-------------|
| Keyword replies | 0 token (no AI) |
| FAQ matching | 0 token (no AI) |
| Cooldown | 3 detik antar AI call |
| Daily limit | Max 30 AI calls/user/hari |
| Rate limiter | Max 5 messages/menit/user |
| Context limit | Max 6 messages per context |
| Max tokens | 300 tokens per response |

## Booking authority

Status booking customer Indonesia dibaca dari tabel website `bookings` melalui Supabase. Flow booking manual hanya dipertahankan untuk foreign customer melalui `foreignBookingService.js`.

## Local regression check

```bash
npm run test:policy
```

---

## Logs

File tersimpan di `logs/` dengan format:
- `messages-YYYY-MM-DD.log` — semua in/out messages
- `tokens-YYYY-MM-DD.log` — token usage per user
- `bookings-YYYY-MM-DD.log` — confirmed bookings
- `escalations-YYYY-MM-DD.log` — human escalations
- `errors-YYYY-MM-DD.log` — errors

---

## Deployment (Render / Railway / VPS)

```bash
# Set semua env vars di dashboard deployment
# Start command:
node app.js
```

Pastikan server bisa diakses publik via HTTPS untuk webhook Meta.
