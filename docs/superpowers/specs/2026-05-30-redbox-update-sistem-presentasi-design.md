# Design Spec — RedBox Update Sistem 2026 (Presentasi Admin & Kapster)

**Tanggal:** 2026-05-30  
**Output:** `RedBox_Update_Sistem_2026.pptx`  
**Audience:** Admin & Kapster internal (semua cabang)  
**Tujuan:** Training — pahami flow & cara kerja semua fitur baru  
**Gaya:** Dark brand RedBox (#C1121F), non-teknis + semi-teknis, Bahasa Indonesia

---

## Struktur (26 Slide)

### Bagian 1 — Pembuka (3 slide)
1. **Cover** — judul, logo, tagline
2. **Agenda** — 5 topik dengan card
3. **Big Picture** — ekosistem semua fitur terhubung

### Bagian 2 — Home Service (4 slide)
4. Konsep & Coverage — kapster ke lokasi, radius 5KM, jam 06–23 WIB
5. Paket & Harga — Single Rp 250K / Family Rp 200K (min 2 orang)
6. Flow Booking — 4 langkah: Pilih Paket → Kapster → Jadwal → Konfirmasi
7. Peran Admin & Kapster

### Bagian 3 — WA AI Bot 5 Cabang (5 slide)
8. Konsep WA Bot — AI auto-reply 24/7 per cabang
9. 5 Nomor Cabang — Bypass, Samadikun, CSB, Sumber, Tegal
10. Flow Percakapan — Chat → AI balas → Booking → Forward admin
11. Human Takeover — admin balas manual, AI pause 30 menit
12. 4 Jenis Reminder — H-1, 1 jam sebelum, Birthday, Re-engagement

### Bagian 4 — Wedding Package (4 slide)
13. Konsep — grooming pengantin, kapster ke venue
14. Paket & Harga — Home Service 1–4 orang (Rp 350K–1jt) + CSB packages
15. Flow Booking Wedding
16. Tips Admin — koordinasi kapster, prioritas jadwal

### Bagian 5 — Membership (4 slide)
17. Program Poin RedBox
18. 4 Tier — Bronze → Silver → Gold → Platinum
19. Cara Dapat & Redeem — kunjungan + Google Review 5⭐ = 5 poin (Rp 50K)
20. Flow Member Journey

### Bagian 6 — AI Grooming (Member Only) (4 slide)
21. Apa itu AI Grooming Consultant?
22. 3 Fitur AI — Analisis Wajah, Rekomendasi Gaya, Simulasi Foto
23. Flow — Login Member → Upload Foto → Hasil AI Instant
24. Cara Admin Guide Customer ke Fitur Ini

### Bagian 7 — Penutup (2 slide)
25. Ekosistem Lengkap — diagram semua fitur saling support
26. Closing

---

## Visual System
- **Background:** #0D0D12 (near-black)
- **Accent primary:** #C1121F (RedBox red)
- **Accent gold:** #FBBF24 (highlight / tier)
- **Text:** #F0F0F0 (off-white), #8A8A9A (muted)
- **Cards:** #161820 dengan border #2A2A35
- **Section dividers:** full red background slide
- **Flow arrows:** putih/abu dengan box merah

## Tooling
- `pptxgenjs` v4 (Node.js)
- Script: `generate_update_2026.js`
