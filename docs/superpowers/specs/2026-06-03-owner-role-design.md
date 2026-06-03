# Owner Role — Design Spec
**Date:** 2026-06-03  
**Status:** Approved

## Overview

Tambahkan role `owner` di RedBox Barbershop admin system. Owner adalah pemilik bisnis yang bisa melihat data semua cabang sekaligus — fokus pada **revenue lengkap (Moka POS + Web)** dan **overview operasional cross-branch**. Owner hanya bisa melihat (read-only), tidak bisa mengubah data.

---

## 1. Auth & Role System

### Existing
- `users` table di Supabase sudah punya kolom `role: 'owner' | 'branch_admin' | 'barber'`
- `useUser()` hook sudah return `role` dan `branch`
- Owner: `role = 'owner'`, `branch = null`

### Auth Flow
1. Login di `/login` (sama seperti admin) via Supabase auth
2. `useUser()` baca role dari tabel `users`
3. `/owner/layout.tsx` guard: redirect ke `/login` jika `role !== 'owner'`
4. Saat owner klik cabang di overview → navigate ke `/admin/dashboard?branch=bypass&readonly=true`
5. Admin layout deteksi `readonly=true` → tampilkan back button, sembunyikan aksi

---

## 2. Routes

```
/owner/dashboard          ← cross-branch overview (NEW)
/owner/revenue            ← revenue dashboard lengkap (NEW)
/owner/profile            ← profil owner (NEW, simple)
/admin/*?readonly=true    ← existing admin pages, read-only mode
```

---

## 3. Owner Dashboard (`/owner/dashboard`)

### Layout
- Header: "REDBOX OWNER" + tanggal + refresh button + link ke Revenue
- Summary bar: total semua cabang (revenue Moka + web, booking, kapster hadir, GoShow)
- 5 branch cards (satu per cabang), tap → `/admin/dashboard?branch=X&readonly=true`

### Data per Branch Card
| Field | Source |
|-------|--------|
| Revenue Moka hari ini | `schedules` source=moka, status=completed, SUM(price) |
| Revenue Web hari ini | `transactions` source=web, SUM(total_amount) |
| Jumlah tx Moka & Web | COUNT dari query di atas |
| Kapster hadir / total | `barber_attendance` + `barbers` |
| GoShow open bills | `schedules` source=moka, status=reserved |
| Booking pending | `bookings` status=pending |

### Backend Endpoint
```
GET /api/admin/crm/owner-overview
Headers: x-admin-token
Response:
{
  today: string,
  branches: [{
    slug, name,
    revenue_moka, tx_moka,
    revenue_web, tx_web,
    hadir, total_barbers,
    goshow, pending_bookings
  }],
  totals: { revenue_moka, revenue_web, tx_total, hadir, goshow, pending }
}
```
Semua 5 cabang di-query paralel (`Promise.all`).

---

## 4. Revenue Dashboard (`/owner/revenue`)

### Filter
- **Cabang:** Semua / Bypass / Samadikun / CSB / Sumber / Tegal
- **Periode:** Hari ini / 7 hari / 30 hari / Bulan ini / Custom range (date picker)

### Sections
1. **Ringkasan** — Total Moka, Total Web, Total Transaksi, Average Transaction Value
2. **Tren Harian** — Bar chart Moka vs Web per hari (Recharts `BarChart`)
3. **Perbandingan Cabang** — Horizontal bar per cabang, sort by revenue tertinggi
4. **Top Kapster** — Rank by jumlah tx + total revenue, filter per cabang
5. **Top Services** — Rank by frekuensi + total revenue dari `schedules.service_name`

### Backend Endpoint
```
GET /api/admin/crm/owner-revenue?branch=all&period=7d
Headers: x-admin-token
Response:
{
  summary: { revenue_moka, revenue_web, tx_total, avg_tx },
  daily_trend: [{ date, moka, web }],
  branch_compare: [{ slug, name, revenue_moka, revenue_web, tx_total }],
  top_barbers: [{ barber_id, name, branch, tx_count, revenue }],
  top_services: [{ service_name, count, revenue }]
}
```

### Data Sources
- Moka revenue: `schedules` WHERE source='moka' AND status='completed'
- Web revenue: `transactions` WHERE source='web' AND status='completed'
- Trend: GROUP BY DATE(start_time AT TIME ZONE 'Asia/Jakarta')
- Top services: `schedules.service_name` (source=moka)

### Chart Library
Recharts — ringan, sudah kompatibel dengan Next.js App Router via `'use client'`.

---

## 5. Owner Nav

Bottom navigation 3 tab:
| Tab | Icon | Route |
|-----|------|-------|
| Overview | `LayoutDashboard` | `/owner/dashboard` |
| Revenue | `TrendingUp` | `/owner/revenue` |
| Profil | `User` | `/owner/profile` |

Design: sama dengan AdminNav — dark OLED, `layoutId` indicator, Lucide icons.

---

## 6. Read-only Mode di Admin Pages

### Trigger
URL mengandung `?readonly=true` — admin layout pass `readonly` prop ke semua child pages.

### Admin Layout Changes
- Deteksi `searchParams.readonly`
- Tampilkan header tambahan: **"← Semua Cabang"** back button → `/owner/dashboard`
- Pass `readonly={true}` ke page via context atau search params

### Per-Page Changes
| Page | Disabled |
|------|----------|
| Dashboard | Tombol advance Home Service pipeline |
| Bookings | Walk-in button, Confirm, Cancel, Reassign, No-show |
| Absensi | Semua tombol set status |
| Jadwal | Toggle block/unblock per hari |
| Broadcast | Textarea + tombol kirim |
| Leaderboard | Tidak ada perubahan (sudah read-only) |
| Ranking | Tidak ada perubahan |

---

## 7. Implementation Order

1. **Backend** — 2 endpoint baru di `adminCrm.js`: `owner-overview` + `owner-revenue`
2. **Proxy routes** — 2 Next.js API routes: `/api/admin/crm/owner-overview` + `/api/admin/crm/owner-revenue`
3. **TypeScript types** — `OwnerOverviewData`, `OwnerRevenueData` di `adminCrmTypes.ts`
4. **OwnerNav component** — 3 tab, dark OLED
5. **Owner layout** — `/owner/layout.tsx` dengan guard + OwnerNav
6. **Owner Dashboard page** — `/owner/dashboard/page.tsx`
7. **Owner Revenue page** — `/owner/revenue/page.tsx` dengan Recharts
8. **Owner Profile page** — `/owner/profile/page.tsx` (simple)
9. **Admin layout read-only mode** — deteksi `readonly` param, back button, pass ke pages
10. **Admin pages read-only** — disable aksi di 5 pages

---

## 8. Out of Scope

- Owner tidak bisa edit data apapun
- Tidak ada notifikasi push untuk owner
- Tidak ada export PDF/Excel (bisa ditambah later)
- Tidak ada real-time live update (refresh manual, auto-refresh 60s)
