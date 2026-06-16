# Spec: Flexible Barber Schedule Off/On

**Date:** 2026-06-16
**Status:** Approved

## Problem

Admin saat ini hanya bisa toggle libur kapster untuk hari ini saja (`today-override`). Kapster sering minta libur di tanggal tidak menentu setiap minggunya, dan admin tidak punya cara untuk set sekaligus — harus tunggu sampai hari H, atau lupa sama sekali.

## Goal

Admin bisa set atau batal libur kapster untuk **tanggal mana saja**, langsung dari halaman Kapster, tanpa meninggalkan halaman tersebut. Admin juga bisa melihat dan mencabut jadwal libur yang sudah terset.

## Out of Scope

- Range tanggal / multi-select tanggal (cukup satu tanggal per aksi)
- Pola berulang mingguan (recurring)
- Halaman detail kapster tersendiri
- Notifikasi ke kapster saat jadwal libur diset

---

## UI/UX Design

### Trigger: tombol ⋮ + long-press

Setiap `BarberCard` mendapat tombol **⋮** (tiga titik vertikal) di pojok kanan atas toggle. Tap tombol ⋮ **atau** long-press (≥ 500ms) pada card → buka `BarberSheet`.

### Badge "libur terjadwal"

Kapster yang punya upcoming blocks (`is_off=true`, date ≥ hari ini) mendapat badge merah kecil di avatar (angka jumlah hari) dan teks `"N hari libur terjadwal"` di bawah nama. Badge dihitung dari `upcomingBlocksMap` yang di-load saat halaman buka.

### BarberSheet (bottom sheet)

Muncul dari bawah layar dengan overlay gelap. Konten:

1. **Drag handle** di atas
2. **Header**: avatar + nama + status hari ini (Aktif / Libur)
3. **Section "Pilih Tanggal"**:
   - `<input type="date">` — default ke hari ini
   - Tombol **Set Libur** (merah) dan **Buka Lagi** (hijau outline)
   - Kedua tombol disable + spinner saat request berlangsung
4. **Section "Libur Terjadwal"**:
   - List upcoming blocks, tiap item: ikon kalender + tanggal (format "Sabtu, 20 Jun 2026") + tombol ✕
   - Tap ✕ → langsung hapus (call `available: true` ke API)
   - Kalau kosong: teks `"Tidak ada jadwal libur ke depan"`
5. Tap overlay / swipe down → tutup sheet

---

## Data Layer

### Tabel yang dipakai

`barber_date_overrides` — sudah ada, kolom: `barber_id`, `date` (DATE), `is_off` (boolean).

### API yang dipakai

**Tidak ada endpoint baru.** Semua pakai yang sudah ada:

| Aksi | Endpoint |
|---|---|
| Set libur tanggal X | `POST /api/barbers/:id/today-override?date=X` body `{ available: false }` |
| Buka lagi tanggal X | `POST /api/barbers/:id/today-override?date=X` body `{ available: true }` |
| Load upcoming blocks | Query Supabase langsung dari frontend |

### Query upcoming blocks (frontend Supabase client)

```ts
supabase
  .from('barber_date_overrides')
  .select('barber_id, date')
  .in('barber_id', barberIds)
  .gte('date', todayStr())
  .eq('is_off', true)
  .order('date', { ascending: true })
```

Dijalankan **parallel dengan `bookingData` query** (keduanya butuh `ids` dari barbers yang sudah di-fetch sebelumnya). Bukan parallel dengan query barbers pertama.

---

## Frontend Changes

### File yang diubah

**Hanya 1 file:** `frontend/src/app/admin/barbers/page.tsx`

### State baru di `BarbersPageInner`

```ts
const [upcomingBlocksMap, setUpcomingBlocksMap] = useState<Record<string, string[]>>({});
const [activeSheet, setActiveSheet] = useState<{ id: string; name: string } | null>(null);
const [sheetDate, setSheetDate] = useState(todayStr());
const [sheetActionLoading, setSheetActionLoading] = useState(false);
```

### Perubahan `loadBarbers()`

Tambah satu promise parallel:

```ts
supabase
  .from('barber_date_overrides')
  .select('barber_id, date')
  .in('barber_id', ids)
  .gte('date', todayStr())
  .eq('is_off', true)
  .order('date', { ascending: true })
```

Hasil di-group ke `upcomingBlocksMap: Record<barberId, string[]>`.

### Handler baru

```ts
async function handleBlockAction(barberId: string, date: string, available: boolean) {
  setSheetActionLoading(true);
  const res = await toggleBarberTodayOverride(barberId, available, date).catch(() => null);
  if (res?.success) {
    setUpcomingBlocksMap(prev => {
      const dates = prev[barberId] ?? [];
      const next = available
        ? dates.filter(d => d !== date)          // buka lagi: hapus dari list
        : [...dates, date].sort();               // set libur: tambah ke list
      return { ...prev, [barberId]: next };
    });
    // Juga sync offTodaySet kalau tanggal = hari ini
    if (date === todayStr()) {
      setOffTodaySet(prev => {
        const next = new Set(prev);
        available ? next.delete(barberId) : next.add(barberId);
        return next;
      });
    }
  }
  setSheetActionLoading(false);
}
```

### Komponen baru: `BarberSheet`

Bottom sheet standalone (tidak butuh library eksternal — pakai `motion.div` dari framer-motion yang sudah ada):

- Props: `barber`, `isOffToday`, `upcomingBlocks: string[]`, `onAction`, `onClose`
- Render via `AnimatePresence` + `motion.div` dengan `initial={{ y: '100%' }}` → `animate={{ y: 0 }}`
- Overlay: `motion.div` dengan `initial={{ opacity: 0 }}` → `animate={{ opacity: 0.6 }}`

### Perubahan `BarberCard`

- Tambah prop `onOpenSheet: () => void`
- Tambah tombol ⋮ di sebelah toggle (bukan menggantikan)
- Tambah long-press detection via `onPointerDown` + `clearTimeout` on `onPointerUp`
- Tambah badge di avatar jika `upcomingCount > 0`

### Perubahan `toggleBarberTodayOverride` di `adminCrmApi.ts`

Tambah parameter `date?: string` dan pass ke query param:

```ts
export async function toggleBarberTodayOverride(id: string, available: boolean, date?: string) {
  const url = date
    ? `/api/admin/barber-override/${id}?date=${date}`
    : `/api/admin/barber-override/${id}`;
  const res = await fetch(url, { method: 'POST', ... body: { available } });
  return res.json();
}
```

### Perubahan Next.js API route `/api/admin/barber-override/[id]/route.ts`

Forward `date` query param dari request ke upstream server:

```ts
const date = req.nextUrl.searchParams.get('date');
const upstream = date
  ? `${API_URL}/api/barbers/${id}/today-override?date=${date}`
  : `${API_URL}/api/barbers/${id}/today-override`;
```

---

## Behaviour Edge Cases

| Skenario | Behaviour |
|---|---|
| Admin set libur untuk tanggal yang sudah lewat | Date picker bisa pilih tanggal lampau — server terima, tapi tidak ada efek visible karena slot engine hanya cek hari ini ke depan |
| Set libur tanggal yang sama dua kali | Upsert di DB — tidak error, idempoten |
| Buka lagi tanggal yang tidak pernah diblock | Server tetap return success (upsert `is_off=false`) — tidak ada efek negatif |
| Kapster sudah ada booking di tanggal yang diblokir | Block tetap disimpan, slot baru tidak bisa dipesan — booking existing tidak dibatalkan otomatis (sesuai behavior saat ini) |
| Sheet dibuka saat offline | Tombol action loading → error state, sheet tetap terbuka, tidak ada perubahan state |
| Sheet dibuka untuk kapster berbeda | `sheetDate` reset ke `todayStr()` setiap kali `activeSheet` berubah |

---

## Files Changed Summary

| File | Perubahan |
|---|---|
| `frontend/src/app/admin/barbers/page.tsx` | State baru, BarberCard + BarberSheet, loadBarbers, handlers |
| `frontend/src/app/api/admin/barber-override/[id]/route.ts` | Forward `date` query param |
| `frontend/src/lib/adminCrmApi.ts` | Tambah param `date?` ke `toggleBarberTodayOverride` |
