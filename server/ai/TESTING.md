# Local Testing Guide - AI Grooming Assistant

## 🎯 Goal
Test AI integration **locally** before May 16, 2026 deployment.

---

## 📋 Prerequisites

1. **Node.js** installed (v18+)
2. **OpenAI API Key** (sudah disediakan)
3. **Image untuk testing** (URL public atau local)

---

## 🚀 Quick Start

### Step 1: Install Dependencies

```bash
cd server/ai
npm install
```

### Step 2: Setup Environment

Pastikan `server/.env` sudah punya:

```bash
OPENAI_API_KEY=sk-... (isi dari dashboard OpenAI, jangan commit ke git)
```

### Step 3: Run Tests

```bash
npm test
```

Atau:

```bash
node test-local.js
```

---

## 🧪 What Gets Tested

| Test | Description | Output |
|------|-------------|--------|
| 1️⃣ API Key | Validate OpenAI connection | Console |
| 2️⃣ Face Analysis | Detect face shape, skin tone | `test-results/face-analysis.json` |
| 3️⃣ Hairstyle | Recommend 3 hairstyles | `test-results/hairstyle-rec.json` |
| 4️⃣ Outfit | Color analysis + outfit ideas | `test-results/outfit-rec.json` |
| 5️⃣ Combined | All-in-one analysis | `test-results/combined-analysis.json` |

---

## 📁 Output Files

Setelah test selesai, cek folder `test-results/`:

```
ai/
├── test-results/
│   ├── face-analysis.json      # Face shape, skin tone, etc
│   ├── hairstyle-rec.json      # 3 hairstyle recommendations
│   ├── outfit-rec.json         # Color palette + outfit ideas
│   └── combined-analysis.json  # Complete analysis
```

---

## 🖼️ Test dengan Gambar Sendiri

Edit `test-local.js`, ganti URL:

```javascript
// Line 12
const TEST_IMAGE_URL = 'https://your-image-url.jpg';

// Atau pakai local file (base64 encode dulu)
const TEST_IMAGE_URL = 'data:image/jpeg;base64,/9j/4AAQ...';
```

**Syarat gambar:**
- Format: JPG, PNG, WebP
- Size: Max 10MB
- Content: Foto wajah jelas (tidak blur, tidak terlalu gelap)

---

## 💰 Cost Estimation (Per Test Run)

| Test | Model | Est. Cost |
|------|-------|-----------|
| Face Analysis | gpt-4.1-mini | ~$0.002 |
| Hairstyle | gpt-4.1-mini | ~$0.002 |
| Outfit | gpt-4.1-mini | ~$0.002 |
| Combined | gpt-4.1-mini | ~$0.003 |
| **Total** | | **~$0.009** |

**1 test run = ~1 cent USD** ✅

---

## 🔧 Troubleshooting

### Error: "Invalid API Key"
```bash
# Cek .env file
cat ../.env | grep OPENAI

# Pastikan key benar (tidak ada spasi)
```

### Error: "Module not found"
```bash
# Install dependencies
cd server/ai
npm install
```

### Error: "Cannot find dotenv"
```bash
# Install dotenv
npm install dotenv
```

---

## 📊 Expected Results

### Face Analysis JSON Structure:
```json
{
  "analysis": {
    "faceShape": "oval",
    "skinTone": "medium",
    "skinUndertone": "warm",
    "recommendations": {
      "haircuts": [...],
      "beardStyles": [...]
    }
  },
  "model": "gpt-4.1-mini",
  "processingTime": 2500,
  "cost": 0.0012
}
```

### Hairstyle Recommendation:
```json
{
  "recommendations": [
    {
      "name": "Modern Quiff",
      "category": "modern",
      "maintenance": { "level": "medium" }
    }
  ]
}
```

---

## ✅ Ready Checklist

Sebelum deploy ke website (May 16):

- [ ] `npm test` berhasil tanpa error
- [ ] API key valid
- [ ] Face analysis menghasilkan JSON valid
- [ ] Hairstyle recommendations ada 3 styles
- [ ] Outfit color analysis akurat
- [ ] Processing time < 5 detik per request
- [ ] Cost estimation sesuai budget

---

## 🚀 Deploy Timeline

| Date | Task |
|------|------|
| **Now - May 15** | Test locally, refine prompts |
| **May 16** | Deploy to production |
| **May 17+** | Monitor & optimize |

---

## 📞 Support

Jika ada error saat testing:
1. Cek console error message
2. Review `test-results/` output
3. Verifikasi API key valid di OpenAI dashboard
4. Test dengan gambar yang berbeda

**Happy Testing!** 🎉
