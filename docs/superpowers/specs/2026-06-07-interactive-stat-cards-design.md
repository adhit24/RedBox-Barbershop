# Interactive Stat Cards — Design Spec

## Overview

Stat cards di admin dashboard (`/admin/dashboard`) saat ini hanya display-only. Fitur ini membuat setiap card bisa diklik sehingga memunculkan **bottom sheet** berisi data detail yang relevan, termasuk aksi langsung (konfirmasi/batalkan) untuk card Pending.

---

## Keputusan Desain

| Keputusan | Pilihan |
|---|---|
| Pola interaksi | Bottom sheet slide up dari bawah |
| Aksi di dalam sheet | Booking & Pending: konfirmasi/batalkan langsung. Sisanya read-only. |
| Visual card aktif | Border warna card + garis pendek di bawah kartu (indicator line) |
| Platform target | Mobile-first (admin dashboard diakses via HP) |
| Data refresh | Supabase Realtime WebSocket (booking INSERT/UPDATE) + polling 30 detik untuk attendance & GoShow |

---

## Behaviour

- **Toggle**: klik card yang sama → sheet tutup
- **Switch**: klik card lain saat sheet terbuka → konten sheet langsung berganti (tanpa tutup dulu)
- **Card count = 0**: tetap bisa diklik, sheet tampil empty state "Belum ada data"
- **Swipe to dismiss**: sheet bisa di-drag/swipe ke bawah untuk tutup
- **Auto-refresh angka**: setelah aksi konfirmasi/batalkan berhasil, angka card Pending dan Booking update otomatis (re-fetch CommandCenterData)
- **Tidak ada API baru**: semua data diambil dari `CommandCenterData` yang sudah ada
- **Realtime bookings**: Supabase Realtime subscribe ke tabel `bookings` (INSERT + UPDATE) per branch — saat booking baru masuk atau status berubah, `load(true)` dipanggil otomatis tanpa tunggu 30 detik
- **Indikator LIVE**: dot hijau `● LIVE` muncul di header saat Realtime channel terkoneksi (konsisten dengan halaman `/admin/bookings`)

---

## Konten Per Sheet

### 1. Hadir (hijau)
- **Sumber data**: `data.barbers.filter(b => b.attendance_status === 'hadir' || b.attendance_status === 'terlambat')`
- **Tampilan per baris**: nama kapster, jam check-in, badge (Hadir / Terlambat)
- **Aksi**: tidak ada (read-only)

### 2. Tdk Hadir (merah)
- **Sumber data**: `data.barbers.filter(b => b.attendance_status && b.attendance_status !== 'hadir' && b.attendance_status !== 'terlambat')`
- **Tampilan per baris**: nama kapster, keterangan "Tidak ada check-in hari ini", badge Absen
- **Aksi**: tidak ada (read-only)

### 3. Blm Check-in (amber)
- **Sumber data**: `data.barbers.filter(b => !b.attendance_status)`
- **Tampilan per baris**: nama kapster, keterangan "Shift hari ini, belum absen", badge Menunggu
- **Aksi**: tidak ada (read-only)

### 4. Booking (biru)
- **Sumber data**: `data.booking_feed` (semua booking hari ini)
- **Tampilan per baris**: nama customer, waktu · service · kapster, status badge
- **Aksi**: tidak ada (read-only)

### 5. Pending (oranye)
- **Sumber data**: `data.booking_feed.filter(b => b.status === 'pending')`
- **Tampilan per baris**: nama customer, waktu · service · kapster, badge Pending
- **Aksi**: tombol **Konfirmasi** (→ status `confirmed`) + **Batalkan** (→ status `cancelled`) per baris
- Setelah aksi berhasil: re-fetch data, sheet update otomatis, angka card berkurang

### 6. GoShow (teal)
- **Sumber data**: `data.moka_open_bills`
- **Tampilan per baris**: nama service, waktu · nama kapster, badge Open / Unassigned
- **Aksi**: tidak ada (read-only)

---

## Komponen yang Diubah

### `frontend/src/app/admin/dashboard/page.tsx`

**`StatCard` component** — tambah props:
```tsx
function StatCard({
  label, value, color, index,
  onClick,       // () => void
  isActive,      // boolean
  accentColor,   // CSS color string untuk border & indicator line
}: ...)
```

Visual active state:
```css
/* border warna card */
border-color: accentColor;
/* garis bawah indicator */
::after { width: 22px; height: 3px; background: accentColor; bottom: -2px; }
```

**Supabase Realtime subscription** — ditambahkan di `CommandCenterPageInner`:
```tsx
useEffect(() => {
  if (!branch) return;
  const channel = supabase
    .channel(`dashboard-bookings-${branch}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'bookings',
      filter: `location=eq.${branch}`,
    }, () => load(true))
    .subscribe(status => setLive(status === 'SUBSCRIBED'));
  return () => { supabase.removeChannel(channel); };
}, [branch, load]);

const [live, setLive] = useState(false);
```

Indikator di header:
```tsx
{live && <span className="flex items-center gap-1 text-[10px] text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />LIVE</span>}
```

**`StatDetailSheet` component** — baru, menangani semua 6 jenis konten:
```tsx
function StatDetailSheet({
  type: 'hadir' | 'tidak_hadir' | 'belum_checkin' | 'booking' | 'pending' | 'goshow',
  data: CommandCenterData,
  onAction: (id: string, status: string) => Promise<void>,
  onClose: () => void,
})
```

Sheet di-render sebagai overlay di dalam `CommandCenterPageInner`, muncul di bawah layar dengan animasi `y: "100%" → y: 0` via `framer-motion`.

**State baru di `CommandCenterPageInner`**:
```tsx
const [activeCard, setActiveCard] = useState<string | null>(null);
// null = sheet tertutup
// 'hadir' | 'tidak_hadir' | 'belum_checkin' | 'booking' | 'pending' | 'goshow'
```

Handle click:
```tsx
function handleCardClick(type: string) {
  setActiveCard(prev => prev === type ? null : type);
}
```

---

## Animasi

| Elemen | Animasi |
|---|---|
| Sheet masuk | `y: "100%" → y: 0`, duration 0.32s, ease `[0.32, 0.72, 0, 1]` |
| Sheet keluar | `y: 0 → y: "100%"`, duration 0.28s |
| Card active | `border-color` transition 0.2s |
| Backdrop overlay | `opacity: 0 → 0.5`, duration 0.25s |

---

## Layout Sheet (mobile)

```
┌─────────────────────────────────┐  ← backdrop gelap (tap untuk tutup)
│                                 │
│  [stats grid tetap kelihatan]  │
│                                 │
├────────────── ▬ ────────────────┤  ← drag handle (swipe turun = tutup)
│  JUDUL SHEET          (count)  │
│ ─────────────────────────────  │
│  Nama       Waktu · Info   🏷  │
│  Nama       Waktu · Info   🏷  │
│  [✓ Konfirmasi] [✕ Batalkan]  │  ← hanya di Pending
│  ...                           │
└─────────────────────────────────┘
```

Sheet height: `max-h-[70vh]`, scroll jika konten melebihi.

---

## File yang Diubah

| File | Perubahan |
|---|---|
| `frontend/src/app/admin/dashboard/page.tsx` | Ubah `StatCard`, tambah `StatDetailSheet`, tambah state `activeCard` + `live`, wiring onClick + Realtime subscription |

Tidak ada file baru, tidak ada API baru.

---

## Out of Scope

- Swipe gesture yang sophisticated (drag physics) — cukup tap backdrop atau swipe sederhana
- Reschedule dari dalam sheet
- Filter / search di dalam sheet
- Swipe gesture drag physics (cukup tap backdrop)
- Attendance realtime (check-in masih polling 30 detik — Supabase Realtime hanya untuk `bookings`)
