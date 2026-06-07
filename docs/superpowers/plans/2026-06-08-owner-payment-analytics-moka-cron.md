# Owner Payment Analytics + Moka Transaction Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hourly auto-sync Moka transactions + interactive payment method analytics (Cash/QRIS/Transfer/Lainnya) di owner revenue page dan halaman `/owner/payment`.

**Architecture:** Server-side cron (`node-cron` in `server/moka/sync.js`) pulls current-month transactions from Moka API tiap jam dan upsert ke `moka_transactions`. Endpoint baru `GET /api/admin/crm/owner-payment-analytics` queries tabel itu dan returns bucketed stats. Frontend menambah payment cards + bottom sheet ke `/owner/revenue` dan page baru `/owner/payment` — semua mobile-first.

**Tech Stack:** Node.js/Express (server), `node-cron` v3, `MokaClient.getTransactionPage`, Supabase JS, Next.js App Router, Tailwind, framer-motion, recharts.

---

## File Map

| File | Action |
|---|---|
| `server/moka/txSync.js` | CREATE |
| `server/moka/sync.js` | MODIFY — tambah cron job hourly di `startCronJobs` |
| `server/routes/adminCrm.js` | MODIFY — tambah route `GET /owner-payment-analytics` |
| `frontend/src/lib/adminCrmTypes.ts` | MODIFY — tambah 2 interface baru |
| `frontend/src/lib/adminCrmApi.ts` | MODIFY — tambah `fetchPaymentAnalytics` |
| `frontend/src/app/owner/revenue/page.tsx` | MODIFY — payment cards + bottom sheet |
| `frontend/src/app/owner/payment/page.tsx` | CREATE |
| `frontend/src/components/OwnerNav.tsx` | MODIFY — tambah nav item Payment |

---

### Task 1: Create `server/moka/txSync.js`

**Files:**
- Create: `server/moka/txSync.js`

Fungsi `syncCurrentMonthTx(supabase, outlet)` menarik transaksi bulan berjalan dari Moka API dan upsert ke `moka_transactions` + `moka_barber_services`. Outlet shape: `{ id, slug, moka_outlet_id }`.

- [ ] **Step 1: Create the file with full implementation**

```js
'use strict';
const MokaClient = require('./client');

// ── helpers (copied from server/scripts/importAllTransaksi.js) ─────────────
function extractBarberItems(itemsRaw) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of (itemsRaw || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  const items = [];
  for (const part of parts) {
    const parenIdx = part.indexOf('(');
    if (parenIdx < 0) continue;
    const name    = part.slice(0, parenIdx).trim();
    const service = part.slice(parenIdx + 1, part.lastIndexOf(')')).trim();
    if (name && service) items.push({ name, service });
  }
  return items;
}

function editDist(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i + j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function matchBarberName(rawName, barbers, preferBranch) {
  const lower = (rawName || '').toLowerCase().trim();
  for (const b of barbers) {
    if (preferBranch && b.branch !== preferBranch) continue;
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  let best = null, bestDist = 3;
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    const d  = editDist(lower, fw);
    if (d < bestDist || (d === bestDist && preferBranch && b.branch === preferBranch)) {
      bestDist = d; best = b;
    }
  }
  return best;
}

// ── main ───────────────────────────────────────────────────────────────────

/**
 * Sync all Moka transactions for the current calendar month to moka_transactions.
 * Safe to call multiple times — upserts on receipt_number.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ id: string, slug: string, moka_outlet_id: string }} outlet
 */
async function syncCurrentMonthTx(supabase, outlet) {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  // WIB is UTC+7 — subtract 7h to get UTC midnight of first day WIB
  const sinceEpochStart = Math.floor((first.getTime() - 7 * 3600 * 1000) / 1000);

  // Load active barbers once for fuzzy matching
  const { data: barbers } = await supabase
    .from('barbers').select('id, name, branch').eq('is_active', true);
  const activeBarbers = barbers || [];

  const client     = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
  let   sinceEpoch = sinceEpochStart;
  let   totalTx    = 0;
  let   totalSvc   = 0;

  while (true) {
    let json;
    try {
      json = await client.getTransactionPage({ sinceEpoch, limit: 100 });
    } catch (err) {
      if (err.status === 404 || err.status === 403) break;
      throw err;
    }

    const payments = json?.data?.payments ?? [];
    if (!payments.length) break;

    // Log first payment shape on first page to help verify field names
    if (sinceEpoch === sinceEpochStart && payments.length > 0) {
      console.log(`[TxSync] ${outlet.slug} — sample payment keys:`, Object.keys(payments[0]).join(', '));
    }

    const txRows  = [];
    const svcRows = [];

    for (const p of payments) {
      if (p.is_deleted || p.is_refunded) continue;
      const receiptNumber = p.receipt_number || p.receipt_no || p.id;
      if (!receiptNumber) continue;

      const createdAt = p.created_at || p.updated_at || '';
      const txDate    = createdAt.slice(0, 10);
      const txTime    = createdAt.slice(11, 19);

      // items_raw: probe multiple candidate field names
      const rawItems = p.item_details || p.items || p.order_items || p.line_items || '';
      const itemsRaw = Array.isArray(rawItems)
        ? rawItems.map(i => `${i.name || i.item_name || ''}(${i.variant_name || i.service || ''})`).join(', ')
        : (rawItems || '');

      txRows.push({
        receipt_number:  String(receiptNumber),
        outlet_slug:     outlet.slug,
        tx_date:         txDate,
        tx_time:         txTime,
        net_sales:       Number(p.net_sales   || 0),
        gross_sales:     Number(p.gross_sales || 0),
        total_collected: Number(p.total_collected || p.total_transaction || 0),
        payment_method:  String(p.payment_type || p.payment_method || ''),
        collected_by:    String(p.collected_by || ''),
        items_raw:       itemsRaw,
      });

      if (itemsRaw) {
        const barberItems  = extractBarberItems(itemsRaw);
        const seenBarbers  = new Map();
        for (const item of barberItems) {
          const matched = matchBarberName(item.name, activeBarbers, outlet.slug);
          if (!matched) continue;
          if (!seenBarbers.has(matched.id)) seenBarbers.set(matched.id, { csvName: item.name, services: [] });
          seenBarbers.get(matched.id).services.push(item.service);
        }
        const netSales    = Number(p.net_sales || 0);
        const revShare    = seenBarbers.size > 0 ? Math.round(netSales / seenBarbers.size) : 0;
        for (const [barberId, { csvName, services }] of seenBarbers) {
          svcRows.push({
            receipt_number:  String(receiptNumber),
            outlet_slug:     outlet.slug,
            tx_date:         txDate,
            barber_id:       barberId,
            barber_name_raw: csvName,
            service_name:    services[0] || '',
            revenue_share:   revShare,
          });
        }
      }
    }

    if (txRows.length) {
      const { error } = await supabase.from('moka_transactions')
        .upsert(txRows, { onConflict: 'receipt_number', ignoreDuplicates: false });
      if (error) console.error(`[TxSync] ${outlet.slug} tx upsert:`, error.message);
      else totalTx += txRows.length;
    }
    if (svcRows.length) {
      const { error } = await supabase.from('moka_barber_services')
        .upsert(svcRows, { onConflict: 'receipt_number,barber_id', ignoreDuplicates: false });
      if (error) console.error(`[TxSync] ${outlet.slug} svc upsert:`, error.message);
      else totalSvc += svcRows.length;
    }

    if (json?.data?.completed) break;
    const m = (json?.data?.next_url || '').match(/[?&]since=([0-9.]+)/);
    if (!m) break;
    sinceEpoch = parseFloat(m[1]);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[TxSync] ${outlet.slug} — ${totalTx} tx, ${totalSvc} svc upserted`);
  return { totalTx, totalSvc };
}

module.exports = { syncCurrentMonthTx };
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run from project root:
```bash
node -e "require('./server/moka/txSync.js'); console.log('OK')"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/moka/txSync.js
git commit -m "feat(moka): txSync — syncCurrentMonthTx pulls bulan berjalan ke moka_transactions"
```

---

### Task 2: Wire Hourly Cron in `server/moka/sync.js`

**Files:**
- Modify: `server/moka/sync.js` — add cron job inside `startCronJobs()`, after Cron 3 (line ~1395)

- [ ] **Step 1: Find the end of `startCronJobs` to add Cron 4**

Open `server/moka/sync.js`. Search for `// Cron 3:` (around line 1352). Scroll past its closing `});` to find the end of `startCronJobs`. The function ends at the closing `}` after all cron schedules.

- [ ] **Step 2: Add Cron 4 inside `startCronJobs()`, before its closing `}`**

In `server/moka/sync.js`, find the line with the closing `}` of `startCronJobs`. Before it, add:

```js
  // Cron 4: Sync transaksi bulan berjalan ke moka_transactions tiap jam.
  // Berguna untuk payment analytics & leaderboard tanpa perlu upload CSV manual.
  cron.schedule('0 * * * *', async () => {
    try {
      const { syncCurrentMonthTx } = require('./txSync');
      const { data: outlets } = await supabase
        .from('outlets')
        .select('id, slug, moka_outlet_id')
        .eq('is_active', true)
        .not('moka_outlet_id', 'is', null);
      if (!outlets?.length) return;

      const { data: tokenRows } = await supabase
        .from('moka_tokens').select('outlet_id')
        .in('outlet_id', outlets.map(o => o.id));
      const authorizedIds = new Set((tokenRows || []).map(r => r.outlet_id));

      for (const o of outlets) {
        if (!authorizedIds.has(o.id)) continue;
        syncCurrentMonthTx(supabase, o).catch(err =>
          console.error(`[TxCron] ${o.slug}:`, err.message));
      }
    } catch (err) {
      console.error('[TxCron] error:', err.message);
    }
  });
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./server/moka/sync.js'); console.log('OK')"
```
Expected: `OK` (no crash)

- [ ] **Step 4: Commit**

```bash
git add server/moka/sync.js
git commit -m "feat(moka): cron 4 — sync moka_transactions tiap jam (bulan berjalan)"
```

---

### Task 3: Add `GET /owner-payment-analytics` to `server/routes/adminCrm.js`

**Files:**
- Modify: `server/routes/adminCrm.js` — tambah route setelah blok `// ─── OWNER REVENUE ───` (setelah owner-revenue route)

- [ ] **Step 1: Add the `normalizePayment` helper and the route**

In `server/routes/adminCrm.js`, find the line `return router;` near the end of `createAdminCrmRoutes()` (line ~1100). Add the following BEFORE `return router;`:

```js
  // ─── OWNER PAYMENT ANALYTICS ──────────────────────────────────────────
  const PAYMENT_COLORS = { cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b' };
  const PAYMENT_NAMES  = { cash: 'Cash', qris: 'QRIS', transfer: 'Transfer', other: 'Lainnya' };

  function normalizePayment(raw) {
    const s = (raw || '').toLowerCase();
    if (s === 'cash' || s === 'tunai') return 'cash';
    if (s === 'qris' || s.includes('qris')) return 'qris';
    if (s.includes('transfer') || s.includes('mandiri') || s.includes('bni') ||
        s.includes('bca') || s.includes('ovo') || s.includes('dana') ||
        s.includes('gopay') || s.includes('shopeepay')) return 'transfer';
    return 'other';
  }

  router.get('/owner-payment-analytics', adminAuth, async (req, res) => {
    try {
      const { branch = 'all', period = '30d' } = req.query;

      const now = new Date();
      let startDate;
      if (period === 'today') {
        startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
      } else if (period === '7d') {
        startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0, 0, 0, 0);
      } else if (period === '30d') {
        startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0, 0, 0, 0);
      } else if (period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else {
        startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0, 0, 0, 0);
      }
      const startDateStr = startDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

      let q = supabase.from('moka_transactions')
        .select('outlet_slug, tx_date, net_sales, payment_method')
        .gte('tx_date', startDateStr);
      if (branch !== 'all') q = q.eq('outlet_slug', branch);

      const { data: rows, error } = await q;
      if (error) return res.status(500).json({ error: error.message });

      const allRows = rows || [];

      // Methods totals
      const methodTotals = { cash: 0, qris: 0, transfer: 0, other: 0 };
      const methodCounts = { cash: 0, qris: 0, transfer: 0, other: 0 };
      for (const r of allRows) {
        const key = normalizePayment(r.payment_method);
        methodTotals[key] += r.net_sales || 0;
        methodCounts[key]++;
      }
      const grandTotal = Object.values(methodTotals).reduce((s, v) => s + v, 0);
      const methods = Object.keys(methodTotals).map(key => ({
        name:     PAYMENT_NAMES[key],
        key,
        total:    Math.round(methodTotals[key]),
        tx_count: methodCounts[key],
        pct:      grandTotal > 0 ? Math.round((methodTotals[key] / grandTotal) * 100) : 0,
        color:    PAYMENT_COLORS[key],
      }));

      // Daily trend
      const dailyMap = {};
      for (const r of allRows) {
        const d = r.tx_date;
        if (!dailyMap[d]) dailyMap[d] = { date: d, cash: 0, qris: 0, transfer: 0, other: 0 };
        const key = normalizePayment(r.payment_method);
        dailyMap[d][key] += r.net_sales || 0;
      }
      const daily_trend = Object.values(dailyMap)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => ({ ...d, cash: Math.round(d.cash), qris: Math.round(d.qris), transfer: Math.round(d.transfer), other: Math.round(d.other) }));

      // By branch
      const branchMap = {};
      for (const r of allRows) {
        const sl = r.outlet_slug;
        if (!branchMap[sl]) branchMap[sl] = { slug: sl, name: sl, cash: 0, qris: 0, transfer: 0, other: 0, total: 0 };
        const key = normalizePayment(r.payment_method);
        branchMap[sl][key] += r.net_sales || 0;
        branchMap[sl].total += r.net_sales || 0;
      }

      // Enrich with outlet names
      const { data: outlets } = await supabase.from('outlets').select('slug, name');
      for (const o of (outlets || [])) {
        if (branchMap[o.slug]) branchMap[o.slug].name = o.name;
      }

      const by_branch = Object.values(branchMap)
        .sort((a, b) => b.total - a.total)
        .map(b => ({ ...b, cash: Math.round(b.cash), qris: Math.round(b.qris), transfer: Math.round(b.transfer), other: Math.round(b.other), total: Math.round(b.total) }));

      return res.json({ methods, daily_trend, by_branch });
    } catch (err) {
      console.error('[PaymentAnalytics]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./server/routes/adminCrm.js'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Smoke test the endpoint**

Start the server (or if already running), then:
```bash
curl "http://localhost:3001/api/admin/crm/owner-payment-analytics?branch=all&period=30d" \
  -H "Authorization: Bearer <ADMIN_PASSWORD>"
```
Expected: JSON with `methods`, `daily_trend`, `by_branch` arrays. No 500 errors.

(Replace `<ADMIN_PASSWORD>` with the value from `server/.env` — `ADMIN_PASSWORD=...`)

- [ ] **Step 4: Commit**

```bash
git add server/routes/adminCrm.js
git commit -m "feat(api): GET /owner-payment-analytics — breakdown Cash/QRIS/Transfer/Lainnya"
```

---

### Task 4: Frontend Types + API Function

**Files:**
- Modify: `frontend/src/lib/adminCrmTypes.ts` — append 2 interfaces
- Modify: `frontend/src/lib/adminCrmApi.ts` — append 1 function

- [ ] **Step 1: Add types to `adminCrmTypes.ts`**

Open `frontend/src/lib/adminCrmTypes.ts`. At the very end (after the closing `}` of `OwnerRevenueData`), append:

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

- [ ] **Step 2: Add API function to `adminCrmApi.ts`**

Open `frontend/src/lib/adminCrmApi.ts`. After `fetchOwnerRevenue`, append:

```ts
export function fetchPaymentAnalytics(branch: string, period: string): Promise<PaymentAnalyticsData> {
  return crmFetch<PaymentAnalyticsData>(`/api/admin/crm/owner-payment-analytics?branch=${branch}&period=${period}`);
}
```

Also add `PaymentAnalyticsData` to the import from `'./adminCrmTypes'` at the top of the file.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors related to `PaymentAnalyticsData` or `PaymentMethodStat`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/adminCrmTypes.ts frontend/src/lib/adminCrmApi.ts
git commit -m "feat(types): PaymentMethodStat + PaymentAnalyticsData + fetchPaymentAnalytics"
```

---

### Task 5: Payment Cards + Bottom Sheet on `/owner/revenue`

**Files:**
- Modify: `frontend/src/app/owner/revenue/page.tsx`

This is the largest task. Adding:
1. State for payment data + active card
2. Parallel load of payment analytics
3. `PaymentCard` component (inline, after `fmt` helper)
4. `PaymentMethodSheet` component (inline, bottom sheet)
5. Payment cards section in the main JSX
6. `AnimatePresence` wrapper for sheet
7. "Lihat analitik lengkap →" link

- [ ] **Step 1: Add imports**

At the top of the file, add to the existing import from `@/lib/adminCrmApi`:
```ts
import { fetchOwnerRevenue, fetchPaymentAnalytics } from '@/lib/adminCrmApi';
```

Add to the import from `@/lib/adminCrmTypes`:
```ts
import type { OwnerRevenueData, PaymentAnalyticsData, PaymentMethodStat } from '@/lib/adminCrmTypes';
```

Add `Link` to the next/navigation import (or add separately):
```ts
import Link from 'next/link';
```

Add `BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer` — these are already imported from recharts. Add `Cell` if not present (not needed since we'll use named bars).

Also add `CreditCard` from lucide-react to the existing lucide import.

- [ ] **Step 2: Add `PaymentCard` component after the `Skeleton` component**

Find the `function Skeleton` in the file. After its closing `}`, add:

```tsx
const PAYMENT_COLORS: Record<string, string> = {
  cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b',
};

function PaymentCard({
  method, isActive, onClick,
}: {
  method: PaymentMethodStat;
  isActive: boolean;
  onClick: () => void;
}) {
  const color = PAYMENT_COLORS[method.key] ?? '#64748b';
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="relative w-full text-left rounded-2xl px-4 py-3 overflow-hidden cursor-pointer min-h-[72px]"
      style={{
        background: isActive ? 'rgba(255,255,255,0.06)' : '#0F172A',
        border: `1px solid ${isActive ? color + '55' : '#1e293b'}`,
        borderTop: `2px solid ${color}`,
      }}
    >
      <p className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#64748b' }}>
        {method.name}
      </p>
      <p className="text-base font-bold tabular-nums" style={{ color }}>
        Rp {method.total >= 1_000_000
          ? `${(method.total / 1_000_000).toFixed(1)}jt`
          : method.total >= 1_000
          ? `${(method.total / 1_000).toFixed(0)}rb`
          : String(method.total)}
      </p>
      <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
        {method.tx_count} tx · {method.pct}%
      </p>
    </motion.button>
  );
}
```

- [ ] **Step 3: Add `PaymentMethodSheet` component after `PaymentCard`**

```tsx
function PaymentMethodSheet({
  method, data, periodLabel, onClose,
}: {
  method: PaymentMethodStat;
  data: PaymentAnalyticsData;
  periodLabel: string;
  onClose: () => void;
}) {
  const color  = PAYMENT_COLORS[method.key] ?? '#64748b';
  const key    = method.key as 'cash' | 'qris' | 'transfer' | 'other';
  const trend  = data.daily_trend.map(d => ({ date: d.date.slice(5), value: d[key] }));

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40 bg-black/60"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      {/* Sheet */}
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl px-4 py-5 max-w-lg mx-auto"
        style={{ background: '#0d1117', borderTop: `2px solid ${color}33` }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ ease: [0.32, 0.72, 0, 1], duration: 0.35 }}
      >
        {/* Handle */}
        <div className="w-8 h-1 rounded-full bg-slate-700 mx-auto mb-4" />

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Detail Pembayaran</p>
            <p className="text-sm font-bold text-white">{method.name} · {periodLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 text-xl leading-none px-2 cursor-pointer">×</button>
        </div>

        {/* Trend chart */}
        {trend.length > 1 && (
          <div className="mb-5">
            <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-2">Tren Harian</p>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={trend} barSize={6}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#475569' }} />
                <YAxis hide />
                <Tooltip
                  formatter={(v: number) => [`Rp ${Math.round(v / 1000)}rb`, method.name]}
                  contentStyle={{ background: '#0F172A', border: `1px solid ${color}44`, borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per branch */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-slate-600 mb-2">Per Cabang</p>
          <div className="space-y-2">
            {data.by_branch
              .filter(b => b[key] > 0)
              .sort((a, b) => b[key] - a[key])
              .map(b => (
                <div key={b.slug} className="flex justify-between items-center bg-[#0a0f1a] rounded-xl px-3 py-2.5">
                  <span className="text-[12px] text-slate-300 capitalize">
                    {b.name.replace('RedBox ', '').replace('Redbox ', '')}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
                    Rp {b[key] >= 1_000_000
                      ? `${(b[key] / 1_000_000).toFixed(1)}jt`
                      : `${Math.round(b[key] / 1_000)}rb`}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Safe area bottom */}
        <div className="h-[env(safe-area-inset-bottom,16px)]" />
      </motion.div>
    </>
  );
}
```

- [ ] **Step 4: Add state and load logic to `OwnerRevenuePage`**

Find `const [loading, setLoading] = useState(true);` in `OwnerRevenuePage`. After it, add:

```tsx
const [paymentData, setPaymentData]   = useState<PaymentAnalyticsData | null>(null);
const [activePayment, setActivePayment] = useState<string | null>(null);
```

Replace the existing `load` callback:
```tsx
const load = useCallback(async () => {
  setLoading(true);
  const [d, p] = await Promise.all([
    fetchOwnerRevenue(branch, period).catch(() => null),
    fetchPaymentAnalytics(branch, period).catch(() => null),
  ]);
  if (d) setData(d);
  if (p) setPaymentData(p);
  setLoading(false);
}, [branch, period]);
```

- [ ] **Step 5: Add payment cards section to the JSX**

In the `motion.div` that wraps the revenue content (the one with `key={${branch}-${period}}`), find the `{/* Daily trend chart */}` block. After its closing `)}`, add the payment cards section:

```tsx
{/* Payment Methods */}
{paymentData && (
  <div>
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5">
        <CreditCard size={12} className="text-slate-500" />
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Metode Pembayaran</p>
      </div>
      <Link href="/owner/payment" className="text-[10px] text-slate-600 underline">
        Lengkap →
      </Link>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {paymentData.methods.map(m => (
        <PaymentCard
          key={m.key}
          method={m}
          isActive={activePayment === m.key}
          onClick={() => setActivePayment(prev => prev === m.key ? null : m.key)}
        />
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 6: Add `AnimatePresence` for the bottom sheet**

At the very end of the `return (...)`, just before the closing `</div>` of the outer wrapper, add:

```tsx
<AnimatePresence>
  {activePayment && paymentData && (() => {
    const method = paymentData.methods.find(m => m.key === activePayment);
    if (!method) return null;
    const periodLabel = PERIODS.find(p => p.key === period)?.label ?? period;
    return (
      <PaymentMethodSheet
        method={method}
        data={paymentData}
        periodLabel={periodLabel}
        onClose={() => setActivePayment(null)}
      />
    );
  })()}
</AnimatePresence>
```

- [ ] **Step 7: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: build succeeds. Fix any TypeScript errors before proceeding.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/owner/revenue/page.tsx
git commit -m "feat(owner): payment method cards + bottom sheet di halaman revenue"
```

---

### Task 6: Create `/owner/payment` Page

**Files:**
- Create: `frontend/src/app/owner/payment/page.tsx`

Full analytics page: filter bar, 4 summary cards, stacked bar chart, per-branch table.

- [ ] **Step 1: Create the file**

```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchPaymentAnalytics } from '@/lib/adminCrmApi';
import type { PaymentAnalyticsData, PaymentMethodStat } from '@/lib/adminCrmTypes';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CreditCard, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const BRANCHES = [
  { key: 'all',       label: 'Semua' },
  { key: 'bypass',    label: 'Bypass' },
  { key: 'samadikun', label: 'Samadikun' },
  { key: 'csb',       label: 'CSB' },
  { key: 'sumber',    label: 'Sumber' },
  { key: 'tegal',     label: 'Tegal' },
];

const PERIODS = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d',    label: '7 Hari' },
  { key: '30d',   label: '30 Hari' },
  { key: 'month', label: 'Bulan ini' },
];

const COLORS: Record<string, string> = {
  cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b',
};

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
}

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`} />
  );
}

export default function OwnerPaymentPage() {
  const [branch, setBranch] = useState('all');
  const [period, setPeriod] = useState('30d');
  const [data, setData]     = useState<PaymentAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPaymentAnalytics(branch, period).catch(() => null);
    if (d) setData(d);
    setLoading(false);
  }, [branch, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/owner/revenue" className="text-slate-500 active:scale-95 transition-transform">
          <ArrowLeft size={18} />
        </Link>
        <CreditCard size={15} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Payment Analytics</h2>
      </div>

      {/* Branch filter */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        {BRANCHES.map(b => (
          <button key={b.key} onClick={() => setBranch(b.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              branch === b.key ? 'bg-slate-700 text-white border-slate-600' : 'bg-transparent text-slate-500 border-slate-800'
            }`}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Period filter */}
      <div className="flex gap-1.5 bg-slate-900 p-1 rounded-2xl">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`flex-1 py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
              period === p.key ? 'bg-slate-700 text-white' : 'text-slate-500'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
      ) : !data ? (
        <p className="text-center text-slate-500 text-sm py-12">Gagal memuat data</p>
      ) : (
        <motion.div
          key={`${branch}-${period}`}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2">
            {data.methods.map((m, i) => {
              const color = COLORS[m.key] ?? '#64748b';
              const grandTotal = data.methods.reduce((s, x) => s + x.total, 0);
              const barPct = grandTotal > 0 ? (m.total / grandTotal) * 100 : 0;
              return (
                <motion.div key={m.key}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 relative overflow-hidden"
                  style={{ borderTop: `2px solid ${color}` }}
                >
                  <p className="text-[9px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#64748b' }}>{m.name}</p>
                  <p className="text-base font-bold tabular-nums" style={{ color }}>Rp {fmt(m.total)}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>{m.tx_count} tx · {m.pct}%</p>
                  {/* Progress bar */}
                  <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${barPct}%` }}
                      transition={{ delay: i * 0.05 + 0.1, duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ background: color }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Stacked trend chart */}
          {data.daily_trend.length > 1 && (
            <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Tren Harian</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.daily_trend.map(d => ({ ...d, date: d.date.slice(5) }))} barSize={6} barGap={1}>
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#64748b' }} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v: number, name: string) => [`Rp ${fmt(v)}`, name.charAt(0).toUpperCase() + name.slice(1)]}
                    contentStyle={{ background: '#0F172A', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                  />
                  <Bar dataKey="cash"     stackId="a" fill={COLORS.cash}     radius={[0,0,0,0]} />
                  <Bar dataKey="qris"     stackId="a" fill={COLORS.qris}     radius={[0,0,0,0]} />
                  <Bar dataKey="transfer" stackId="a" fill={COLORS.transfer} radius={[0,0,0,0]} />
                  <Bar dataKey="other"    stackId="a" fill={COLORS.other}    radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2">
                {(['cash','qris','transfer','other'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLORS[k] }} />
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Per branch table */}
          {data.by_branch.length > 0 && (
            <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Per Cabang</p>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[400px]">
                  <thead>
                    <tr className="text-slate-500 text-[9px] uppercase tracking-wider">
                      <th className="text-left pb-2 px-1">Cabang</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.cash }}>Cash</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.qris }}>QRIS</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.transfer }}>Transfer</th>
                      <th className="text-right pb-2 px-1" style={{ color: COLORS.other }}>Lainnya</th>
                      <th className="text-right pb-2 px-1 text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {data.by_branch.map(b => (
                      <tr key={b.slug}>
                        <td className="py-2 px-1 text-slate-300 capitalize">{b.name.replace('RedBox ','').replace('Redbox ','')}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.cash }}>{fmt(b.cash)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.qris }}>{fmt(b.qris)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.transfer }}>{fmt(b.transfer)}</td>
                        <td className="py-2 px-1 text-right tabular-nums" style={{ color: COLORS.other }}>{fmt(b.other)}</td>
                        <td className="py-2 px-1 text-right tabular-nums text-slate-300 font-semibold">{fmt(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/owner/payment/page.tsx
git commit -m "feat(owner): halaman /owner/payment — full payment analytics"
```

---

### Task 7: Add "Payment" to OwnerNav

**Files:**
- Modify: `frontend/src/components/OwnerNav.tsx`

- [ ] **Step 1: Add nav item**

In `frontend/src/components/OwnerNav.tsx`, add `CreditCard` to the lucide-react import:
```ts
import { LayoutDashboard, TrendingUp, User, CreditCard } from 'lucide-react';
```

In the `NAV_ITEMS` array, add after the Revenue entry:
```ts
{ href: '/owner/payment',   label: 'Payment',  Icon: CreditCard },
```

So the full array becomes:
```ts
const NAV_ITEMS = [
  { href: '/owner/dashboard', label: 'Overview', Icon: LayoutDashboard },
  { href: '/owner/revenue',   label: 'Revenue',  Icon: TrendingUp },
  { href: '/owner/payment',   label: 'Payment',  Icon: CreditCard },
  { href: '/owner/profile',   label: 'Profil',   Icon: User },
];
```

- [ ] **Step 2: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/OwnerNav.tsx
git commit -m "feat(nav): tambah Payment ke OwnerNav"
```

---

### Task 8: Deploy

- [ ] **Step 1: Push to main (triggers Vercel deploy)**

```bash
git push origin main
```

- [ ] **Step 2: Monitor Vercel deployment**

Check https://vercel.com/adhit24 — confirm deployment succeeds.

- [ ] **Step 3: Smoke test production**

1. Login sebagai owner di https://redboxbarbershop.com
2. Buka `/owner/revenue` — pastikan 4 payment cards muncul di bawah grafik
3. Klik salah satu card — pastikan bottom sheet slide-up dengan tren + per cabang
4. Klik "Lengkap →" — buka `/owner/payment`, pastikan semua section muncul
5. Ganti branch dan period — pastikan data berubah
6. Cek OwnerNav — pastikan tab "Payment" ada
7. (Hourly cron) Tunggu sampai jam berikutnya atau lihat server logs — confirm `[TxSync] bypass — N tx` muncul
