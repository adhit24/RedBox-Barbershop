# Paid Tier Membership Registration and Activation

## Tujuan

Mengubah pendaftaran membership RedBox menjadi pembelian tier berbayar selama satu tahun, dengan pembayaran dilakukan di outlet dan aktivasi dilakukan staff melalui CRM.

## Keputusan bisnis

- Tier berbayar sejak pendaftaran: Silver Rp100.000, Gold Rp250.000, Platinum Rp1.500.000.
- Masa berlaku setiap membership adalah satu tahun sejak aktivasi.
- Pembayaran dilakukan di kasir, bukan payment gateway.
- Customer mendaftar dan memilih tier secara online.
- Staff mengonfirmasi pembayaran dan mengaktifkan membership melalui `crm.html`.
- Member lama tetap menggunakan masa berlaku lama sampai selesai; renewal berikutnya mengikuti tier berbayar.
- Upgrade saat membership masih aktif dilakukan dengan pembayaran penuh dan memulai masa berlaku baru satu tahun.
- Pembayaran wajib mencatat metode pembayaran, nomor referensi/bukti transaksi, cabang, dan staff.
- Harga yang dipilih disimpan sebagai snapshot transaksi agar histori tidak berubah ketika harga masa depan berubah.

## Arsitektur data

### `membership_registrations`

Mencatat niat pendaftaran sebelum pembayaran.

Kolom utama:

- `id`
- `customer_id` atau `user_key`
- `tier`: `silver`, `gold`, atau `platinum`
- `price_snapshot`
- `status`: `PENDING`, `PAID`, `ACTIVATED`, `CANCELLED`, atau `EXPIRED`
- `expires_at`
- `created_at`
- `updated_at`

Pendaftaran Pending tidak mengaktifkan hak member.

### `member_profiles`

Tetap menjadi sumber profil member aktif. Status profil tetap `INACTIVE` sampai aktivasi berhasil, lalu menjadi `ACTIVE`.

Kolom membership yang digunakan atau ditambahkan:

- `membership_status`
- `current_tier`
- `membership_started_at`
- `membership_expires_at`
- `membership_activated_at`
- `total_points`
- `total_visits`

### `member_activations`

Menjadi ledger/audit setiap aktivasi, renewal, dan upgrade.

Record menyimpan user, tier, nominal, metode pembayaran, referensi transaksi, cabang, staff, waktu aktivasi, dan periode berlaku. Satu tindakan aktivasi selalu menghasilkan satu record histori.

### `customers`

Tetap menjadi tabel customer CRM. Status membership di sini adalah data sinkronisasi/cross-reference dari `member_profiles`, bukan sumber utama proses aktivasi.

## Alur customer

1. Customer membuka halaman membership.
2. Customer memilih Silver, Gold, atau Platinum.
3. Customer mengisi data dan mengirim pendaftaran.
4. Sistem membuat record `membership_registrations` dengan status `PENDING` dan menyimpan tier serta harga snapshot.
5. Sistem menampilkan nomor registrasi/kode yang dibawa customer ke outlet.
6. Customer membayar di kasir.
7. Customer menunjukkan nomor HP atau kode registrasi kepada staff.

Sebelum pembayaran dikonfirmasi, customer tetap bukan member aktif dan tidak mendapatkan kartu/benefit membership.

## Alur staff di CRM

Menu Membership di `crm.html` menampilkan tiga kelompok:

- **Pending**: pendaftaran online yang belum diaktifkan.
- **Active**: membership yang sedang berlaku.
- **Expired**: membership yang masa berlakunya selesai.

Pada detail Pending, staff melihat nama, nomor HP, tier, harga snapshot, dan waktu pendaftaran. Staff wajib mengisi metode pembayaran, nomor referensi/bukti transaksi, cabang, dan identitas staff sebelum menekan **Aktifkan Membership**.

Server kemudian memvalidasi status pendaftaran, nominal, tier, dan duplikasi membership aktif. Jika valid, server melakukan satu rangkaian perubahan:

1. Membuat record `member_activations`.
2. Mengubah `member_profiles.membership_status` menjadi `ACTIVE`.
3. Menetapkan `current_tier`.
4. Menetapkan tanggal mulai dan tanggal berakhir satu tahun kemudian.
5. Mengubah registrasi menjadi `ACTIVATED`.
6. Menyinkronkan status membership ke `customers`.

## Aturan validasi

- Pendaftaran yang sudah `ACTIVATED` tidak dapat diaktifkan ulang.
- Satu nomor HP tidak boleh memiliki lebih dari satu membership aktif.
- Nominal pembayaran harus sama dengan `price_snapshot`.
- Tier tidak boleh diubah diam-diam setelah pendaftaran dibuat.
- Jika pembayaran batal atau nominal salah, registrasi tetap `PENDING`.
- Registrasi Pending otomatis menjadi `EXPIRED` setelah tujuh hari tanpa aktivasi.
- Membership expired tidak dihapus.
- Renewal dan upgrade selalu membuat histori aktivasi baru.
- Semua waktu dan perubahan status harus dapat diaudit dari CRM.

## Renewal dan upgrade

- Member lama tidak dimigrasikan paksa ke paket baru.
- Renewal dilakukan setelah membership lama berakhir dan memilih tier berbayar baru.
- Upgrade saat membership masih aktif membayar harga tier tujuan secara penuh.
- Upgrade memulai periode baru satu tahun dari tanggal upgrade.
- Histori periode sebelumnya tetap tersimpan.

## Error handling

- Jika customer tidak ditemukan, CRM menolak aktivasi dan meminta staff memeriksa nomor HP/kode registrasi.
- Jika sudah ada membership aktif, CRM menampilkan status dan tanggal berakhirnya.
- Jika penyimpanan audit gagal, perubahan status aktif tidak boleh dianggap berhasil.
- Tombol aktivasi harus mencegah submit ganda.
- Setelah berhasil, CRM menampilkan nomor aktivasi, tier, nominal, staff, dan masa berlaku.

## Pengujian penerimaan

- Pendaftaran online menghasilkan `PENDING`, bukan `ACTIVE`.
- Silver, Gold, dan Platinum menyimpan nominal yang benar.
- Aktivasi kasir mencatat payment method, reference, branch, dan staff.
- Aktivasi berhasil menetapkan periode satu tahun.
- Aktivasi kedua untuk nomor HP yang sama ditolak.
- Registrasi Pending kedaluwarsa setelah tujuh hari.
- Pembayaran salah nominal tidak mengaktifkan member.
- Renewal dan upgrade membuat histori baru tanpa menghapus histori lama.
- Member lama tetap aktif sampai tanggal berakhir lamanya.
- CRM menampilkan Pending, Active, dan Expired secara konsisten.

