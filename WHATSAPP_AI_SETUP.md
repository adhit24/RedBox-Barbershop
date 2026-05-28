# WhatsApp AI Bot Setup - Multi Branch

Dokumentasi setup AI Bot untuk multiple cabang RedBox Barbershop.

## Token Cabang

Setiap cabang membutuhkan token Fonnte terpisah untuk WhatsApp AI Bot.

### Environment Variables

| Variable | Cabang | Nomor WA | Status |
|----------|--------|----------|--------|
| `FONNTE_TOKEN` | Bypass (Pusat) | 0818-2025-69 | ✅ Aktif |
| `FONNTE_TOKEN_SUMBER` | Sumber | 0818-2025-99 | 🆕 Token: `RCmcYJ2VkQkq3JXPMe2p` |
| `FONNTE_TOKEN_SAMADIKUN` | Samadikun | 0818-2025-89 | ⏳ Menunggu token |
| `FONNTE_TOKEN_CSB` | CSB Mall | 0818-2028-89 | ⏳ Menunggu token |
| `FONNTE_TOKEN_TEGAL` | Tegal | 0818-268-883 | ⏳ Menunggu token |

## Setup Sumber

### 1. Tambah Environment Variable

Tambahkan ke Vercel Environment Variables:

```bash
FONNTE_TOKEN_SUMBER=RCmcYJ2VkQkq3JXPMe2p
```

### 2. Test Endpoint

Test apakah token sudah terdeteksi:

```bash
curl "https://redboxbarbershop.com/api/wa/webhook?debug=redbox2026&branch_info=1"
```

Response yang diharapkan:

```json
{
  "status": "ok",
  "branches": {
    "bypass": { "available": true, ... },
    "sumber": { "available": true, ... },
    ...
  }
}
```

### 3. Test Kirim Pesan (Debug)

```bash
curl "https://redboxbarbershop.com/api/wa/webhook?debug=redbox2026&send_to=0818xxxxxx&send_msg=Test%20AI%20Sumber&branch=sumber"
```

## Cara Kerja

1. **Webhook Menerima Pesan**: Fonnte mengirim payload dengan `device` info
2. **Branch Detection**: Sistem mendeteksi cabang dari nomor device
3. **Token Selection**: Sistem memilih token sesuai cabang
4. **AI Processing**: OpenAI memproses pesan dengan konteks cabang
5. **Balasan Dikirim**: AI membalas menggunakan token cabang yang sesuai

## Fitur Per Cabang

Setiap cabang dengan AI bot aktif akan:

- ✅ Auto-reply dengan AI (GPT-4o-mini)
- ✅ Memory percakapan per customer
- ✅ Human takeover (pause AI saat admin balas manual)
- ✅ Forward booking ke admin cabang
- ✅ Deteksi cabang-aware (jam operasional, lokasi, dll)

## Monitoring

Cek status AI bot:

```bash
# Status semua cabang
curl "https://redboxbarbershop.com/api/wa/webhook"

# Info device per cabang
curl "https://redboxbarbershop.com/api/wa/webhook?debug=redbox2026&branch_info=1"
```

## Troubleshooting

### Token tidak terdeteksi

- Cek environment variable sudah di-set di Vercel
- Pastikan deployment sudah selesai
- Clear cache dan re-deploy jika perlu

### AI tidak membalas

- Cek `OPENAI_API_KEY` tersedia
- Cek log di Vercel Functions
- Test dengan endpoint debug

### Pesan terkirim ke cabang salah

- Pastikan nomor WA di Fonnte sesuai dengan mapping di `BRANCH_WA_NUMBER`
- Cek `device` field di webhook payload
