# RedBox WhatsApp AI Assistant

WhatsApp AI chatbot untuk RedBox Barbershop. Dibangun dengan Node.js + Express + OpenAI GPT-4o-mini + WhatsApp Cloud API.

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
 │   ├── bookingService.js     # Booking state machine
 │   ├── knowledgeService.js   # Load + query knowledge base
 │   └── escalationService.js  # Human handoff logic
 ├── prompts/system.txt        # AI personality prompt
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

## Setup WhatsApp Cloud API

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
    ├── Booking flow active? → bookingService.handle()
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
