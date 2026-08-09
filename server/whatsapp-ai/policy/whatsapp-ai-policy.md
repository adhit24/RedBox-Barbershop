# RedBox WhatsApp AI Policy Matrix

Dokumen ini adalah sumber keputusan perilaku Reddy. Backend harus menegakkan rule kritis; system prompt hanya menangani percakapan yang lolos ke AI.

| Intent | Sumber data | Respons utama | Dilarang | URL / eskalasi | Verifikasi booking |
|---|---|---|---|---|---|
| Booking outlet | Website booking | Arahkan ke booking online dan jelaskan slot belum aman sebelum confirmed | Mengambil data booking manual, “sudah dicatat”, “ditunggu” | `/booking.html` | Tidak sebelum transaksi; wajib untuk status existing/OTW |
| Slot / antrian | Website realtime | Arahkan melihat slot live; jangan menjanjikan bebas antre | “Tidak ada antrean”, “pasti langsung dilayani” | `/booking.html` | Tidak |
| Request kapster | Website realtime | Arahkan memilih kapster di website | Mengklaim kapster tersedia | `/booking.html` | Tidak |
| Walk-in | Website realtime | Boleh datang tetapi slot tidak dijamin; sarankan booking | Mengonfirmasi walk-in | `/booking.html` | Tidak |
| OTW / terlambat | Database `bookings` | Hanya respons OTW jika booking aktif `confirmed` ditemukan | “Ditunggu” untuk customer tanpa confirmed booking | Booking URL jika tidak terverifikasi | Wajib |
| Existing booking | Database `bookings` | Tampilkan status minimal yang tersedia; perubahan diteruskan ke admin | Mengubah/cancel via chat tanpa workflow resmi | Admin escalation | Wajib |
| Home service | Knowledge + database home service | Gunakan alur home service khusus | Mengarahkan ke booking outlet | `/home-service.html` | Sesuai job |
| Wedding | Knowledge + tanggal customer | Informasikan paket; minimal H-3 | Menerima H-2 atau kurang | `/home-service.html#wedding-pricing` | Tidak sebelum booking |
| Cancel / reschedule | Sistem booking resmi atau admin | Eskalasi jika manage-booking belum tersedia | Menjanjikan perubahan | Admin escalation | Wajib |
| Complaint / refund | Admin | Empati, rangkum masalah, teruskan ke admin | Menjanjikan refund/kompensasi | Admin escalation | Jika terkait booking |
| Membership | Knowledge/database membership | Jawab aturan umum; status poin hanya dari database | Mengarang poin/tier | Membership URL atau admin | Jika status personal |
| Foreign customer | Foreign booking service + admin/Moka | Pengecualian: kumpulkan data manual dan kirim ke admin | Mencampur flow dengan customer Indonesia | Admin/Moka | Manual pending |
| Supplier / business | Admin | Tolak halus dan teruskan ke tim | Memberi kontak owner | Admin escalation | Tidak |
| Website / payment error | Sistem + admin | Troubleshoot ringan; payment/booking existing jangan booking ulang | Menyuruh mengulang pembayaran/booking | Admin escalation | Jika existing |

## Status booking

`CONFIRMED` adalah satu-satunya status yang boleh dianggap booking aman. `PENDING`, `NOT_FOUND`, `AMBIGUOUS`, `CANCELLED`, dan `DONE` tidak boleh dipakai untuk menjanjikan slot aktif.

## Handoff

`/ai_off <phone>` dan `/ai_on <phone>` adalah kontrol utama. Status `sent`, `delivered`, dan `read` dari WhatsApp Cloud API tidak otomatis mengaktifkan handoff karena status tersebut juga dapat berasal dari bot, reminder, dan scheduler.

## Regression scenarios

- OTW tanpa booking → redirect, tidak boleh “ditunggu”.
- Customer mengaku sudah booking tetapi database kosong → belum terverifikasi.
- Booking confirmed + telat → panduan keterlambatan.
- Walk-in → slot tidak dijamin.
- Form booking → website.
- “Yang anak-anak” → website, bukan konfirmasi.
- Home service → home-service URL.
- Wedding H-2 → ditolak sopan.
- Foreign customer → foreign flow manual.
- Status bot `sent` → AI tetap aktif.
- `/ai_off` / `/ai_on` → pause/resume.
- Harga CSB → harga CSB.
- Refund/payment error → admin, tanpa janji dan tanpa booking ulang otomatis.
