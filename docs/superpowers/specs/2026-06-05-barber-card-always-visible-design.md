# Design: Barber Card Selalu Visible — Off-Duty Hanya Blokir Slot

**Date:** 2026-06-05  
**Status:** Approved

---

## Problem

Ketika admin meng-OFF toggle kapster di halaman CRM Next.js (`/admin/barbers`), fungsinya memanggil `toggle-active` yang men-set `is_active = false` secara **permanen** di database. Akibatnya:
- `/api/barbers` memfilter barber dengan `is_active = false`
- Card kapster **hilang** dari halaman booking
- Customer tidak bisa memilih kapster tersebut untuk tanggal lain (misalnya besok)

**Yang diinginkan:** Card kapster tetap muncul. Saat kapster off-duty pada tanggal tertentu, hanya slot waktunya yang diblokir.

---

## Non-Goals

- Tidak mengubah `js/booking.js` — slot blocking per-tanggal sudah bekerja via `checkBarberOffDuty()`
- Tidak mengubah `/admin/schedule` page — tetap bisa blokir tanggal spesifik
- Tidak mengubah `crm.html` / `js/crm.js` — sudah pakai `today-override` dengan benar
- Kapster dengan `is_active = false` permanen (Anggi, Putra) tetap tersembunyi dari booking

---

## Architecture

**Before:**
```
Admin toggle OFF
  → POST /api/admin/barber-toggle/:id { is_active: false }
  → barbers.is_active = false (permanen)
  → GET /api/barbers filters out → card HILANG di booking
```

**After:**
```
Admin toggle OFF
  → POST /api/admin/barber-override/:id { available: false }
  → barber_date_overrides.is_off = true untuk hari ini saja
  → barbers.is_active tetap true
  → GET /api/barbers tetap return barber → card TETAP MUNCUL
  → today-status: isWorking = false
  → checkBarberOffDuty() → semua slot diblokir saat tanggal dipilih
```

---

## Data Flow: Today-Status Check

`today-status` API sudah membaca dari dua sumber (priority order):
1. `barber_date_overrides` (date-specific) — dipakai saat admin override hari ini
2. `barber_working_hours` (day-of-week) — jadwal mingguan reguler
3. `barbers.work_days` (fallback)

Saat admin toggle OFF → insert/upsert `barber_date_overrides.is_off = true` untuk tanggal hari ini. Toggle ON → upsert `is_off = false`.

---

## File Changes

### 1. `frontend/src/lib/adminCrmApi.ts`

Tambah fungsi baru:

```ts
export function toggleBarberTodayOverride(
  id: string,
  available: boolean
): Promise<{ success?: boolean }> {
  return crmFetch<{ success?: boolean }>(`/api/admin/barber-override/${id}`, {
    method: 'POST',
    body: JSON.stringify({ available }),
  });
}
```

Route `/api/admin/barber-override/:id` sudah ada di `frontend/src/app/api/admin/barber-override/[id]/route.ts` dan sudah proxy ke backend `today-override`.

---

### 2. `frontend/src/app/admin/barbers/page.tsx`

**Tambah state:**
```ts
const [offTodaySet, setOffTodaySet] = useState<Set<string>>(new Set());
```

**Ubah `loadBarbers()`:**
- Fetch `today-status` secara paralel dengan fetch barbers dari Supabase
- Populate `offTodaySet` dari response `today-status`

**Ubah `handleToggle(id, val)`:**
- Sebelum: `toggleBarberActive(id, val)` → ubah `is_active` permanen
- Sesudah: `toggleBarberTodayOverride(id, val)` → override hari ini saja
- `val = true` = barber tersedia hari ini (`available: true`); `val = false` = barber libur hari ini (`available: false`)
- Optimistic update: `val = true` → hapus id dari `offTodaySet`; `val = false` → tambah id ke `offTodaySet`
- Rollback jika API gagal: kembalikan `offTodaySet` ke state sebelumnya

**Ubah `BarberCard` props & logic:**
- Tambah prop `isOffToday: boolean`
- Toggle state = `!isOffToday` (bukan `barber.is_active`)
- Toggle handler memanggil `onToggle(id, !isOffToday)` — artinya: "jadikan tersedia = true/false hari ini"

**Barber `is_active = false` (permanen):**
- Tetap ditampilkan di admin list dengan badge "Nonaktif Permanen"
- Toggle disabled
- Tidak masuk hitungan `activeCount` / `inactiveCount`

**Visual indicator:**
- `is_active = true`, tidak off hari ini → border hijau, dot hijau, label "Aktif"
- `is_active = true`, off hari ini → border merah, dot merah, label "Libur Hari Ini"
- `is_active = false` → border abu, label "Nonaktif Permanen", toggle disabled

---

## API Routes (sudah ada, tidak perlu dibuat baru)

| Route | File | Status |
|-------|------|--------|
| `POST /api/admin/barber-override/:id` | `frontend/src/app/api/admin/barber-override/[id]/route.ts` | ✅ Sudah ada |
| `POST /api/barbers/:id/today-override` | `server/index.js` | ✅ Sudah ada |
| `GET /api/barbers/today-status` | `server/moka/routes.js` | ✅ Sudah ada |

---

## What Does NOT Change

- `js/booking.js` — tidak ada perubahan, card sudah muncul untuk `is_active = true`
- `checkBarberOffDuty()` — sudah blokir slot berdasarkan `today-status` untuk tanggal yang dipilih
- `server/` — tidak ada perubahan di backend
- `crm.html` + `js/crm.js` — sudah correct, tidak diubah
- `frontend/src/app/admin/schedule/page.tsx` — tidak diubah

---

## Edge Cases

| Kasus | Behavior |
|-------|----------|
| Admin OFF pagi, lalu ON siang | Upsert `is_off = false` → slot kembali normal |
| Customer sudah pilih kapster, lalu admin OFF | `checkBarberOffDuty()` dipanggil saat tanggal dipilih → blokir slot |
| Kapster off hari ini, customer pilih besok | `checkBarberOffDuty()` cek per-tanggal → besok slot normal |
| Kapster `is_active = false` permanen | Tidak muncul di booking, toggle disabled di admin |
| Jadwal otomatis (work_days tidak include hari ini) | `today-status` return `isWorking: false` → slot diblokir otomatis |
