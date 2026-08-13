# Design: Group Booking — Kapster Sama, Jam Beda + Lock Kapster (Double-Klik untuk Ganti)

**Date:** 2026-08-13
**Status:** Draft

---

## Problem

Di halaman booking customer (`public/booking.html`, logic di `public/js/booking.js`), mode **2 orang** (group booking) saat ini:

1. **Memaksa kapster berbeda.** Step 2 (`renderBarberCards` click handler, `booking.js:1288-1294`) secara eksplisit memblokir pemilihan kapster yang sama untuk kedua orang, dengan alert *"Kapster ini sudah dipilih untuk orang yang lain. Pilih kapster berbeda agar bisa paralel di waktu yang sama."*
2. **Memaksa jam yang sama.** Step 3 hanya punya satu `state.time` (scalar) yang dipakai bersama oleh kedua orang — tidak ada UI untuk memilih jam terpisah per orang.

Alasan pembatasan #1 ada karena pembatasan #2: dua orang tidak bisa dilayani satu kapster di jam yang sama secara paralel. Tapi ini terlalu ketat untuk kasus seperti **bapak & anak yang sama-sama mau kapster Onoy**, cuma beda jam (mis. jam 10 dan jam 11) — sesi berurutan, bukan paralel, jadi seharusnya boleh.

Selain itu, sekali kapster dipilih di step 2, klik satu kali pada kartu kapster lain langsung mengganti pilihan tanpa konfirmasi apa pun — rawan salah pencet (terutama saat scroll di mobile), dan pelanggan tidak punya cara yang disengaja untuk "saya berubah pikiran, ganti kapster."

---

## Goals

1. Di mode 2 orang, kedua orang boleh memilih **kapster yang sama**, selama jam mereka berbeda (tidak overlap dengan durasi service masing-masing).
2. Step 3 (Date & Time) punya pilihan jam **per orang** saat mode 2 orang — bukan lagi satu jam yang dibagi berdua.
3. Di step 2 (pilih kapster), setelah kapster terpilih untuk seseorang, mengganti ke kapster lain butuh **double-klik/double-tap** pada kartu kapster tujuan — berlaku di mode solo maupun group, sebagai pengaman terhadap salah pencet.

---

## Non-Goals

- Tidak mengubah tanggal per-orang — kedua orang tetap booking di **tanggal yang sama** (`state.date` tetap shared), cuma jam yang dipisah.
- Tidak mengubah alur mode 3+ orang (tetap redirect ke WhatsApp, tidak tersentuh).
- Tidak mengubah admin panel (`frontend/src/app/admin/bookings`) — fitur reassign kapster admin yang sudah ada (commit `e0860b5`) tidak diubah.
- Tidak mengubah struktur tabel `bookings`/`schedules` di Supabase — tiap booking (per orang) tetap 1 row dengan 1 `barber_id` + 1 `time`, seperti sekarang (group booking sudah kirim 2 row terpisah per orang, lihat `_buildPayloadFor` di `booking.js:1912`).
- Tidak menambah validasi baru untuk deteksi "kapster sama, jam sama" di sisi server — cukup dicegah di client (step 3 UI) + tetap dilindungi oleh `hasConflict()` check yang sudah ada saat submit akhir (409 dari server tetap jadi pengaman terakhir).

---

## Part A — Kapster Sama, Jam Beda

### A1. Hapus blokir "kapster harus beda" di Step 2

`booking.js:1288-1294` — hapus block ini:

```js
// Group mode: prevent picking same kapster for both persons
if (isGroup()) {
  const otherBarber = state.activePerson === 1 ? state.person2?.barber : state.barber;
  if (otherBarber && String(otherBarber.id) === String(barberData.id)) {
    alert('Kapster ini sudah dipilih untuk orang yang lain. ...');
    return;
  }
}
```

`step2Ready()` (`booking.js:207-215`) — hapus syarat `must be different kapster` (baris 210-211), tetap pertahankan syarat "harus sama branch":

```js
function step2Ready() {
  if (!isGroup()) return !!state.barber;
  if (!state.barber || !state.person2?.barber) return false;
  if (state.barber.branch !== state.person2.barber.branch) return false;
  return true;
}
```

### A2. State: jam per orang

Tambah `time` ke object `state.person2` (sudah ada `{ name, service, barber }`, tambah `time: null`). `state.time` tetap dipakai untuk orang 1 (konsisten dengan pola `state.service`/`state.barber` vs `state.person2.service`/`state.person2.barber`).

Tambah helper baru (paralel dengan `getActiveService`/`getActiveBarber`):

```js
function getActiveTime() {
  if (isGroup() && state.activePerson === 2) return state.person2?.time || null;
  return state.time;
}
function setActiveTime(t) {
  if (isGroup() && state.activePerson === 2) {
    state.person2 = state.person2 || { name: '', service: null, barber: null, time: null };
    state.person2.time = t;
  } else {
    state.time = t;
  }
}
```

### A3. Step 3 UI: person tabs untuk jam

Tambah blok `person-tabs` baru di `booking.html` step 3 (`#step3`), sebelum `.cal-wrap`, mengikuti pola persis `personTabsService` (step 1) / `personTabsBarber` (step 2):

```html
<div class="person-tabs" id="personTabsTime" style="display:none">
  <button class="person-tab active" data-person="1">
    <span class="person-tab-badge">1</span>
    <span class="person-tab-label">Jam Orang 1</span>
    <span class="person-tab-status" data-status-for="1">Pilih jam</span>
    <span class="person-tab-check" aria-hidden="true">...(svg sama seperti yang lain)...</span>
  </button>
  <button class="person-tab" data-person="2">...sama, label "Jam Orang 2"...</button>
</div>
```

Wiring di `booking.js`:
- Tambahkan `personTabsTime` ke `setGroupSize()` (toggle `display` sama seperti `personTabsService`/`personTabsBarber`).
- Tambahkan cabang `isTimeStep = tabs.id === 'personTabsTime'` di `refreshPersonTabs()` (`booking.js:162-185`), pakai `getActiveTime`-style logic untuk `filled`/`statusEl.textContent` (format jam, mis. `"10:00"`).
- Klik tab (`booking.js:301-310`) sudah generic (`document.querySelectorAll('.person-tabs')`) — otomatis menangkap tab baru ini, tinggal tambahkan pemanggilan render ulang time grid (lihat A4) di dalam handler tersebut supaya grid re-render sesuai orang yang aktif.

### A4. Time grid: render per orang aktif + validasi overlap kapster sama

Ubah rendering slot (`booking.js` sekitar baris 1600-1682):

- Ganti semua pemakaian `state.barber`/`state.service`/`state.time` di fungsi render time grid dengan `getActiveBarber()`, `getActiveService()`, `getActiveTime()`.
- **Hapus** logic lama yang cross-check kedua kapster untuk slot yang sama (`booking.js:1631-1634`, `hasConflict` untuk `person2.barber` di slot yang sama) — tidak relevan lagi karena jam tidak lagi dibagi bersama.
- **Tambah** guard baru: kalau kedua orang pakai kapster yang **sama** (`state.barber.id === state.person2.barber.id`) dan orang yang **tidak aktif** sudah punya `time` terpilih, maka slot yang overlap dengan `[waktu lawan, waktu lawan + durasi service lawan]` ditandai `unavailable` (dengan pesan singkat/tooltip "Bentrok dengan jadwal Orang X"). Overlap dihitung dengan cara yang sama seperti `hasConflict()` (start/end dalam menit, bandingkan rentang).
- Klik slot (delegated handler, `booking.js:1657-1670`): ganti `state.time = slot` menjadi `setActiveTime(slot)`; setelah set, panggil `refreshPersonTabs()`; kalau mode group dan orang aktif = 1 dan orang 2 belum punya `time`, auto-switch `state.activePerson = 2` lalu re-render grid (pola sama seperti auto-switch di step 1 baris 489-490 dan step 2 baris 1314-1317).

### A4b. Addendum: cache availability per orang (koreksi setelah baca kode lebih dalam)

Ternyata `mokaAvailableSlots`, `fallbackBusyRanges`, `mokaAvailabilityActive` (`booking.js:14-16`) dan `state.barberOffOnDate` bukan per-orang — semua module-scope/global, diisi oleh `loadAndRenderDate(dateStr, dayEl)` (`booking.js:782-951`) yang fetch berdasar `state.barber?.id` tunggal, termasuk sebuah polling loop (`pollOnce`, baris 885-932) yang terus refresh `fallbackBusyRanges` untuk barber itu selama tanggal hari-ini dipilih. `buildTimeGrid()` (baris 1550) juga baca langsung dari variabel-variabel global ini, bukan dari state per-orang.

Supaya pindah tab Orang 1 ↔ Orang 2 di step 3 tidak saling menimpa data availability, dan supaya waktu yang sudah dipilih salah satu orang tidak ke-reset saat pindah tab:

- Tambah cache `let personAvailabilityCache = { 1: null, 2: null };` (module scope, sejajar dengan `mokaAvailableSlots` dkk). Tiap entri: `{ mokaAvailableSlots, mokaAvailabilityActive, fallbackBusyRanges, barberOffOnDate }`.
- `loadAndRenderDate(dateStr, dayEl, forPerson = state.activePerson)`: dapat parameter baru `forPerson`. **Tidak lagi** unconditionally `state.time = null` (baris 786) — reset time HANYA saat dipanggil dari klik kalender (tanggal berubah beneran), reset KEDUA orang (`state.time = null; if (state.person2) state.person2.time = null;`), bukan saat dipanggil akibat pindah tab.
- Di akhir `loadAndRenderDate`, simpan hasil fetch ke `personAvailabilityCache[forPerson] = {...}`, lalu HANYA salin ke variabel global + panggil `buildTimeGrid()` kalau `state.activePerson === forPerson` masih benar saat itu (mencegah race: user sempat pindah tab sebelum fetch selesai). Mekanisme `activeLoadSeq`/`seq` yang sudah ada (baris 783, 889, 911) dipakai lagi buat guard yang sama di jalur poll.
- Tab-switch handler (di dalam `.person-tabs` click listener, `booking.js:301-310`, untuk `personTabsTime` khususnya): kalau `personAvailabilityCache[newPerson]` sudah ada (untuk `state.date` yang sama) → langsung restore ke variabel global + `buildTimeGrid()`, tanpa fetch ulang. Kalau belum ada → panggil `loadAndRenderDate(state.date, null, newPerson)`.
- Ganti kondisi highlight slot terpilih di `buildTimeGrid()` (baris 1641, `if (state.time === slot)`) jadi `if (getActiveTime() === slot)`.
- `personAvailabilityCache` di-clear (`{1: null, 2: null}`) tiap kali: tanggal kalender berganti (klik hari baru), atau kapster salah satu orang berubah (di handler klik kartu kapster step 2, baris 1298-1300 yang sudah reset `mokaAvailableSlots`/`fallbackBusyRanges` — tambahkan clear cache di situ juga).

### A4c. Addendum: sidebar ringkasan (`updateSidebar()`)

`updateSidebar()` (`booking.js:1021-1120`) baris 1082-1084 (`sumDatetime`) pakai `state.date` + `state.time` global. Saat group, ubah supaya menampilkan jam kedua orang, mengikuti pola `sumBarber` yang sudah menangani group di baris 1059-1061 (`name + ' + ' + name`) — format: `formatDate(state.date) + ', ' + state.time + ' & ' + state.person2.time` (fallback `'-'` per bagian yang belum dipilih).

### A5. `step3Ready()` + tombol Continue

Ganti pengecekan di `step3Next` click handler (`booking.js:1694-1696`) dan tempat lain yang menge-disable tombol, dengan fungsi baru:

```js
function step3Ready() {
  if (!state.date) return false;
  if (!isGroup()) return !!state.time;
  return !!state.time && !!state.person2?.time;
}
```

`document.getElementById('step3Next').disabled` di-update dari fungsi ini setiap kali `setActiveTime()` dipanggil dan setiap kali tanggal berubah.

### A6. Confirm summary, pesan WhatsApp, payload — pakai jam per orang

- `buildConfirmSummary()` (`booking.js:1739-1804`): baris "Time" (1796) saat ini satu baris `state.time` — ubah jadi per-orang saat group (tampil di dalam `personRows()` masing-masing, sejajar dengan Service/Duration, bukan baris global lagi). Saat solo, tetap satu baris global seperti sekarang.
- `_buildWaMessage()` (`booking.js:1877-1896`): baris `*Jadwal:* ... at ' + state.time` — saat group, pindahkan info jam ke dalam masing-masing blok `_waBlockFor('ORANG 1'/'ORANG 2', ...)` (tambah param `time` ke fungsi tsb), bukan satu baris jadwal global.
- `_buildPayloadFor()` (`booking.js:1912-1942`): parameter `time` saat ini selalu `state.time` untuk kedua orang (`payloads` di baris 1944-1949) — ubah supaya orang 1 kirim `state.time`, orang 2 kirim `state.person2.time`.

### A7. Final-submit conflict re-check

`finalBookBtn` handler (`booking.js:1837-1847`) — saat ini cek `hasConflict(state.barber?.id, state.date, state.time, ...)` untuk orang 1, lalu `hasConflict(state.person2.barber.id, state.date, state.time, ...)` untuk orang 2 (**pakai `state.time` yang sama untuk keduanya** — bug laten begitu Part A jalan). Ubah baris kedua supaya pakai `state.person2.time`, bukan `state.time`.

---

## Part B — Lock Kapster: Double-Klik untuk Ganti

Berlaku di **semua mode** (solo & group), di step 2 (`#proPickGrid`).

### B1. Aturan interaksi

- **Belum ada kapster terpilih untuk orang aktif** → klik satu kali pada kartu manapun langsung memilih (perilaku sekarang, tidak berubah).
- **Sudah ada kapster terpilih untuk orang aktif** → grid masuk mode "locked" untuk orang itu:
  - Klik satu kali pada kartu **berbeda** dari yang sedang terpilih → tidak langsung ganti. Tampilkan hint singkat (mis. kartu tersebut kedip/pulse sebentar + microcopy "Ketuk 2x untuk ganti kapster" muncul sesaat, auto-hide ~1.5 detik).
  - **Klik/tap dua kali** (dalam window waktu tertentu) pada kartu berbeda → kartu tsb menjadi pilihan baru (jalankan logic `setActiveBarber` + refresh yang sudah ada).
  - Klik pada kartu yang **sedang** terpilih (single atau double) → no-op.

### B2. Deteksi double-click/tap lintas device

Meta viewport halaman (`booking.html:12`) **tidak** menonaktifkan pinch/double-tap zoom (`user-scalable`/`maximum-scale` tidak di-set), jadi mengandalkan native `dblclick` event saja berisiko: di mobile, double-tap cepat bisa memicu zoom browser dan/atau tidak konsisten memicu `dblclick`.

Solusi:
1. Tambah CSS `touch-action: manipulation;` pada `.pro-pick-card` — menonaktifkan double-tap-to-zoom khusus di elemen ini saja (idiom standar), tanpa mengubah perilaku pinch-zoom di bagian lain halaman.
2. Deteksi double-klik secara manual lewat `click` handler (bukan `dblclick`), dengan menyimpan timestamp klik terakhir per kartu (mis. `card.dataset.lastTap`), anggap "double" kalau selisih dua klik berturut-turut pada kartu yang sama ≤ 400ms. Ini konsisten untuk mouse maupun touch, dan tidak bergantung pada threshold timing native browser yang bisa beda-beda.

### B3. Perubahan di click handler kartu kapster

`booking.js:1281-1322` (`proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => card.addEventListener('click', ...))`) — restrukturisasi jadi:

```js
card.addEventListener('click', () => {
  if (card.dataset.barber === 'none') return;
  const barberData = { id: card.dataset.barber, name: card.dataset.barberName, branch: card.dataset.branch };
  const currentActive = getActiveBarber();
  const isSameCard = currentActive && String(currentActive.id) === String(barberData.id);

  if (currentActive && !isSameCard) {
    // locked mode: butuh 2 klik beruntun dalam 400ms
    const now = Date.now();
    const last = Number(card.dataset.lastTap || 0);
    card.dataset.lastTap = String(now);
    if (now - last > 400) {
      showChangeHint(card); // pulse + microcopy, auto-hide
      return;
    }
    // double-klik terverifikasi → lanjut proses ganti di bawah
    card.dataset.lastTap = '0';
  }

  // ...logic pemilihan kapster yang sudah ada (setActiveBarber, dst)...
});
```

(Guard "kapster sudah dipilih untuk orang lain" dari Part A1 dihapus dari sini seperti dijelaskan di atas.)

### B4. Fix bug laten: `refreshBarberCardSelection()` salah selector

`refreshBarberCardSelection()` (`booking.js:194-200`) query `.barber-card`, padahal kartu yang di-render pakai class `.pro-pick-card` (`booking.js:1254`) — akibatnya fungsi ini no-op, dan highlight "selected" cuma benar saat grid pertama kali di-render (`renderBarberCards()`), tidak ter-update saat pindah tab orang tanpa render ulang. Perbaiki selector jadi `.pro-pick-card`. Ini perlu dibenerin supaya highlight "locked" (siapa yang lagi kepilih untuk orang aktif) selalu akurat saat pindah tab — dependency langsung untuk Part B1.

---

## File Changes Summary

| File | Perubahan |
|---|---|
| `public/booking.html` | Tambah blok `#personTabsTime` di step 3 |
| `public/css/booking.css` (atau file CSS terkait) | Tambah `touch-action: manipulation` pada `.pro-pick-card`; style hint "ketuk 2x" |
| `public/js/booking.js` | State (`person2.time`), helper `getActiveTime`/`setActiveTime`, render time grid per-orang + overlap guard, `step3Ready()`, hapus blokir kapster-beda di step 2, restrukturisasi click handler kartu kapster (lock + double-tap), fix `refreshBarberCardSelection()`, update `buildConfirmSummary()`/`_buildWaMessage()`/`_buildPayloadFor()`/`finalBookBtn` handler untuk jam per orang |

Tidak ada perubahan di `server/`, `frontend/` (Next.js admin), atau schema Supabase.

---

## Edge Cases

| Kasus | Behavior |
|---|---|
| Kapster sama, jam sama persis dipilih 2 orang | Dicegah di step 3 (slot ditandai unavailable begitu salah satu sudah pilih jam itu) |
| Kapster sama, durasi service beda, jam mepet (mis. Orang 1 jam 10 durasi 45mnt, Orang 2 coba jam 10:30) | Overlap guard di A4 menghitung berdasar durasi masing-masing, slot 10:30 tetap diblokir sampai 10:45 |
| Orang 1 pilih kapster A, lalu ganti ke kapster B (double-klik) setelah Orang 2 sudah pilih jam berdasarkan kapster A | Time grid untuk kedua orang perlu re-render saat kapster berubah (perilaku reset `mokaAvailabilityActive`/`mokaAvailableSlots` yang sudah ada di handler tetap jalan) — jam yang sudah dipilih Orang 2 tidak otomatis dihapus, tapi availability dihitung ulang berdasar kapster baru |
| Ganti kapster balik lagi ke kapster semula (locked, double-klik pada kartu yang sedang tidak aktif tapi identik dengan kapster orang lain) | Sama seperti pemilihan kapster biasa — diperbolehkan (Part A sudah menghapus larangan kapster sama) |
| Klik cepat berkali-kali (>2x) pada kartu locked | Klik ke-2 dalam window 400ms trigger ganti, klik-klik berikutnya diperlakukan sebagai siklus baru (klik tunggal dulu → perlu 2x lagi) |
| Mode 3+ orang | Tidak tersentuh, tetap redirect WhatsApp seperti sekarang |
