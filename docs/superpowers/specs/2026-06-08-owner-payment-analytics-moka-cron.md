# Owner Payment Analytics + Moka Transaction Cron — Design Spec

**Date:** 2026-06-08 
**Scope:** Two features for the owner role:
1. **Moka Transaction Cron** — hourly auto-sync dari Moka API ke `moka_transactions`
2. **Payment Method Analytics** — breakdown Cash/QRIS/Transfer/Lainnya, interactive di `/owner/revenue` + halaman penuh `/owner/payment`

---

## 1. Background & Context

### Existing State
- `moka_transactions` sudah ada di Supabase dengan kolom: `receipt_number` (upsert key), `outlet_slug`, `tx_date`, `tx_time`, `net_sales`, `gross_sales`, `total_collected`, `payment_method`, `collected_by`, `items_raw`
- Data diisi **manual** via script CSV import (`server/scripts/importAllTransaksi.js`)
- Server sudah punya `node-cron` (v3.0.3) dan `startCronJobs()` di `server/moka/sync.js`
- `MokaClient.getTransactionPage({ sinceEpoch, limit })` di `server/moka/client.js` memanggil `/v3/outlets/{id}/reports/get_latest_transactions`
- Pagination: `json.data.payments[]`, `json.data.completed` (boolean), `json.data.next_url` berisi `?since=<epoch>`
- Owner revenue page: `frontend/src/app/owner/revenue/page.tsx` dengan grafik bar + top barbers + top services
- `OwnerRevenueData` type di `adminCrmTypes.ts` — tidak ada field payment method

### What We're Building
Setelah ini, `moka_transactions` ter-refresh otomatis tiap jam. Owner bisa klik card metode bayar untuk melihat tren harian + breakdown per cabang — tanpa navigasi keluar dari halaman revenue.

---

## 2. Moka Transaction Cron

### Behavior
- **Jadwal:** tiap jam (`0 * * * *`)
- **Scope data:** bulan berjalan (dari tanggal 1 bulan ini hingga sekarang)
- **Per outlet:** loop semua outlet aktif yang punya token Moka OAuth
- **Upsert:** `moka_transactions` on conflict `receipt_number` + `moka_barber_services` on conflict `receipt_number, barber_id`
- **Deduplication:** upsert dengan `onConflict` — aman dijalankan berkali-kali
- **Error handling:** per-outlet try/catch, log error, lanjut ke outlet berikutnya

### Implementasi

**File baru:** `server/moka/txSync.js`

Fungsi utama: `syncCurrentMonthTx(supabase, outlet)`
- `outlet`: `{ id, slug, moka_outlet_id }`
- Hitung `sinceEpoch`: awal bulan berjalan dalam Unix epoch (WIB → UTC: kurangi 7 jam)
- Loop pagination:
 ```
 sinceEpoch = firstDayOfMonth (epoch)
 while true:
 json = client.getTransactionPage({ sinceEpoch, limit: 100 })
 payments = json.data.payments ?? []
 jika payments kosong atau json.data.completed: break
 map payments → txRows + svcRows
 upsert txRows → moka_transactions
 upsert svcRows → moka_barber_services
 nextMatch = json.data.next_url.match(/[?&]since=([0-9.]+)/)
 jika tidak ada nextMatch: break
 sinceEpoch = parseFloat(nextMatch[1])
 delay 300ms (rate limit)
 ```

**Field mapping Moka API → `moka_transactions`:**
| Moka API field | DB column |
|---|---|
| `p.receipt_number` | `receipt_number` |
| outlet.slug | `outlet_slug` |
| `p.created_at.slice(0,10)` | `tx_date` |
| `p.created_at.slice(11,19)` | `tx_time` |
| `p.net_sales` | `net_sales` |
| `p.gross_sales` | `gross_sales` |
| `p.total_collected` | `total_collected` |
| `p.payment_type` | `payment_method` |
| `p.collected_by` | `collected_by` |
| items string (lihat catatan) | `items_raw` |

> **Catatan field `items_raw`:** Field name untuk item list di API response Moka belum terverifikasi — implementer harus `console.log` satu payment object saat pertama kali run untuk melihat struktur lengkapnya. Kandidat field name: `p.item_details`, `p.items`, `p.order_items`. Jika tidak ada, set `items_raw = ''` dan skip barber service parsing untuk data dari cron (barber services tetap bisa di-backfill via CSV manual).

Rows dengan `p.is_deleted === true` atau `p.is_refunded === true` → skip.

**Barber service mapping:** sama dengan logika di `importAllTransaksi.js`:
- Parse `items_raw` menggunakan `extractBarberItems()` — fungsi ini ada di `server/scripts/importAllTransaksi.js` baris ~52 dan `server/routes/adminCrm.js`; copy ke `txSync.js` (tidak perlu extract ke shared util — fungsi kecil, tidak ada overhead duplikasi)
- Match nama barber dengan logika edit-distance dari `importAllTransaksi.js` (baris ~73-100) — sama persis, copy ke `txSync.js`
- Perlu fetch daftar barbers aktif dari Supabase sekali per cron run, bukan per payment
- `revenue_share = Math.round(net_sales / seenBarbers.size)`

**Modifikasi:** `server/moka/sync.js` — tambah cron job di `startCronJobs()`:
```js
cron.schedule('0 * * * *', async () => {
 const { syncCurrentMonthTx } = require('./txSync');
 // load authorized outlets (sama dengan cron existing)
 for (const o of authorizedOutlets) {
 syncCurrentMonthTx(supabase, o).catch(err =>
 console.error(`[TxCron] ${o.slug}:`, err.message));
 }
});
```

---

## 3. Payment Analytics API

### Endpoint
`GET /api/admin/crm/owner-payment-analytics`

**Query params:**
- `branch` (string, default: `'all'`) — outlet slug atau `'all'`
- `period` (string, default: `'30d'`) — `'today'` | `'7d'` | `'30d'` | `'month'`

**Auth:** `adminAuth` middleware (sama dengan endpoint lain di adminCrm.js)

### Response Shape
```ts
{
 methods: Array<{
 name: string; // 'Cash' | 'QRIS' | 'Transfer' | 'Lainnya'
 key: string; // 'cash' | 'qris' | 'transfer' | 'other'
 total: number; // sum net_sales
 tx_count: number; // jumlah transaksi
 pct: number; // persentase dari total (0-100, integer)
 color: string; // hex warna untuk UI
 }>;
 daily_trend: Array<{
 date: string; // 'YYYY-MM-DD'
 cash: number;
 qris: number;
 transfer: number;
 other: number;
 }>;
 by_branch: Array<{
 slug: string;
 name: string;
 cash: number;
 qris: number;
 transfer: number;
 other: number;
 total: number;
 }>;
}
```

### Payment Method Normalization
`payment_method` di DB adalah raw string dari Moka/CSV (e.g., `'Cash'`, `'QRIS'`, `'Mandiri'`, `'BNI'`, `'Transfer Bank'`). Normalisasi ke 4 bucket:
```js
function normalizePayment(raw) {
 const s = (raw || '').toLowerCase();
 if (s === 'cash' || s === 'tunai') return 'cash';
 if (s === 'qris' || s.includes('qris')) return 'qris';
 if (s.includes('transfer') || s.includes('mandiri') || s.includes('bni') ||
 s.includes('bca') || s.includes('ovo') || s.includes('dana') ||
 s.includes('gopay') || s.includes('shopeepay')) return 'transfer';
 return 'other';
}
```

**Warna per bucket:**
| Bucket | Warna |
|---|---|
| cash | `#3b82f6` (biru) |
| qris | `#8b5cf6` (ungu) |
| transfer | `#14b8a6` (teal) |
| other | `#f59e0b` (amber) |

### Implementasi
Tambah di `server/routes/adminCrm.js` dalam `createAdminCrmRoutes()`:
```js
router.get('/owner-payment-analytics', adminAuth, async (req, res) => {
 const { branch = 'all', period = '30d' } = req.query;
 // Resolve date range (sama dengan owner-revenue)
 // Build moka_transactions query dengan filter branch + date
 // Group by payment_method (JS-side, bukan SQL GROUP BY)
 // Hitung methods[], daily_trend[], by_branch[]
 // Return JSON
});
```

---

## 4. Frontend

### Types — `frontend/src/lib/adminCrmTypes.ts`

Tambah di akhir file:
```ts
export interface PaymentMethodStat {
 name: string;
 key: string;
 total: number;
 tx_count: number;
 pct: number;
 color: string;
}

export interface PaymentAnalyticsData {
 methods: PaymentMethodStat[];
 daily_trend: { date: string; cash: number; qris: number; transfer: number; other: number }[];
 by_branch: { slug: string; name: string; cash: number; qris: number; transfer: number; other: number; total: number }[];
}
```

### API Function — `frontend/src/lib/adminCrmApi.ts`

Tambah:
```ts
export function fetchPaymentAnalytics(branch: string, period: string): Promise<PaymentAnalyticsData> {
 return crmFetch<PaymentAnalyticsData>(`/api/admin/crm/owner-payment-analytics?branch=${branch}&period=${period}`);
}
```

### Halaman `/owner/revenue` — Perubahan

**State tambahan:**
```ts
const [paymentData, setPaymentData] = useState<PaymentAnalyticsData | null>(null);
const [activePayment, setActivePayment] = useState<string | null>(null); // 'cash'|'qris'|'transfer'|'other'
```

**Load:** `fetchPaymentAnalytics(branch, period)` dijalankan bersamaan dengan `fetchOwnerRevenue()` yang sudah ada.

**UI tambahan** (di bawah grafik bar omzet, sebelum Top Barbers):
- Section header: "Metode Pembayaran" (uppercase, 10px, tracking lebar)
- Grid 2×2: 4 `PaymentCard` component
- `PaymentCard` props: `method: PaymentMethodStat`, `isActive: boolean`, `onClick: () => void`
- Card design (mobile-first, `min-h-[72px]`, `rounded-2xl`, `px-4 py-3`):
 - Accent bar 2px di atas card (`borderTop: 2px solid <color>`)
 - Label metode (9px, uppercase, slate-500)
 - Nilai (16px, bold, warna sesuai bucket)
 - Jumlah tx + persentase (10px, slate-400)
 - `active:scale-[0.97]` saat tap
 - Ketika `isActive`: background sedikit lebih terang, border-color sesuai bucket

**Bottom Sheet** — `PaymentMethodSheet` component (dalam file yang sama):
- Identik dengan `StatDetailSheet` di admin dashboard: `framer-motion` slide-up, `AnimatePresence`, backdrop overlay
- Judul: "Detail: {method.name} · {periodLabel}"
- Konten:
 1. **Tren Harian** — `BarChart` dari recharts (compact, height 80px, hanya bar warna bucket)
 2. **Per Cabang** — list rows: nama cabang, total (warna bucket), jumlah tx
- Tombol close: `×` di kanan atas, atau tap backdrop
- Mobile-first: `max-w-lg mx-auto`, `rounded-t-3xl`, `px-4 py-5`, `pb-safe` (padding bottom aman untuk notch)

**AnimatePresence** di return JSX:
```tsx
<AnimatePresence>
 {activePayment && paymentData && (
 <PaymentMethodSheet
 method={paymentData.methods.find(m => m.key === activePayment)!}
 data={paymentData}
 periodLabel={PERIODS.find(p => p.key === period)?.label ?? period}
 onClose={() => setActivePayment(null)}
 />
 )}
</AnimatePresence>
```

### Halaman Baru `/owner/payment`

**File:** `frontend/src/app/owner/payment/page.tsx`

**Layout (mobile-first):**
- Header: "Payment Analytics" + tombol back ke `/owner/revenue`
- Filter bar (horizontal scroll): Branch pills + Period pills (sama dengan revenue page)
- Summary cards: 4 kartu besar (full-width pada mobile, 2 kolom pada ≥640px) dengan nilai + persentase + progress bar visual
- Grafik tren: `BarChart` stacked (4 warna, height 160px) dengan axis X = tanggal (format DD/MM)
- Tabel Per Cabang: setiap row = cabang, kolom = Cash / QRIS / Transfer / Lainnya / Total (horizontal scroll pada mobile)
- Link: "← Kembali ke Revenue"

**Data:** gunakan `fetchPaymentAnalytics(branch, period)` yang sama.

---

## 5. Navigation

Tambah link ke `/owner/payment` di `/owner/revenue/page.tsx`:
```tsx
<Link href="/owner/payment" className="text-[11px] text-slate-500 underline">
 Lihat analitik lengkap →
</Link>
```

Tambah `/owner/payment` ke layout owner jika ada nav menu (cek `frontend/src/app/owner/layout.tsx`).

---

## 6. Mobile-First Constraints

Semua komponen UI:
- Max width: `max-w-[430px]` atau `w-full` — tidak ada fixed width yang bisa overflow
- Touch targets: minimum `44px` height untuk semua elemen tappable
- Font sizes: tidak ada teks di bawah 10px
- Scroll: horizontal scroll untuk tabel per cabang (wrapper `overflow-x-auto`)
- Safe area: `pb-[env(safe-area-inset-bottom)]` pada bottom sheet

---

## 7. File Summary

| File | Action |
|---|---|
| `server/moka/txSync.js` | CREATE — fungsi `syncCurrentMonthTx` |
| `server/moka/sync.js` | MODIFY — tambah cron job hourly di `startCronJobs` |
| `server/routes/adminCrm.js` | MODIFY — tambah route `GET /owner-payment-analytics` |
| `frontend/src/lib/adminCrmTypes.ts` | MODIFY — tambah `PaymentMethodStat`, `PaymentAnalyticsData` |
| `frontend/src/lib/adminCrmApi.ts` | MODIFY — tambah `fetchPaymentAnalytics` |
| `frontend/src/app/owner/revenue/page.tsx` | MODIFY — payment cards + `PaymentMethodSheet` + state |
| `frontend/src/app/owner/payment/page.tsx` | CREATE — halaman analytics penuh |
| `frontend/src/app/owner/layout.tsx` | MODIFY (jika perlu) — tambah nav link ke /owner/payment |
