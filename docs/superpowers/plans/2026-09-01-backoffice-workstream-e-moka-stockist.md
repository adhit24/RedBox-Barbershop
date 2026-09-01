# Backoffice Workstream E — Moka / Stockist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Moka POS Integration (real) and Stockist Inventory Dashboard
(honest UNAVAILABLE, per the already-approved §8a decision).

**Architecture:** No new backend endpoints this workstream — both existing
Moka routes (`/api/moka/status`, already consumed since B1; `/api/moka/sync-logs`,
newly consumed) are reused unmodified. Stockist needs no data fetching at
all — it's an honest UNAVAILABLE state with a real external link to the
operational Stockist app.

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 12/21, §8a Stockist auth blocker, §8 workstream E)

## Data audit findings (this session)

- `/api/moka/status` (already shipped in B1) — `{oauthConfigured, outlets:
  [{id,name,slug,mokaOutletId,hasToken,tokenExpiry,tokenExpired}],
  recentLogs: [{direction,status,created_at,error_message}]}`. Real,
  already integrated.
- `/api/moka/sync-logs?direction=&status=&limit=` — real, not previously
  consumed by Backoffice. Returns `{logs: [{id,direction,entity_type,
  entity_id,status,error_message,retry_count,created_at}]}`. No `adminAuth`
  gate (pre-existing, unrelated finding, same as `/moka/status`).
- `/api/moka/items` exists but makes a **live external call to the Moka
  API** (`client.getItems()`) — not a DB read. The design's per-category
  sync cards ("Transaction Sync: Aktif · 5/5 outlet", "Customer Sync: 1,284
  pelanggan tersinkron", "Item Mapping: 3 item belum dipetakan", "Barber
  Mapping: 2 barber baru belum dipetakan") have no lightweight, DB-only
  source. Triggering a live Moka API call on every dashboard page load is
  inappropriate for a monitoring page (slow, can fail unpredictably, not
  what `/moka/items` is for). **These four summary cards are omitted, not
  built** — the connection status card and Sync Logs table (both DB-only,
  real) replace them.
- Stockist: **confirmed architectural blocker, already decided in §8a** —
  `getVerifiedStockistAccess` requires `sessionVerified === true` + a role
  Backoffice's TEMPORARY COMPATIBILITY AUTH never sets. Not revisited here.
  The page shows UNAVAILABLE with a real link to
  `https://stockist.redboxbarbershop.com`.

## Global Constraints

- No live external Moka API calls triggered by page load — DB-only reads.
- No fabricated sync-category status ("Aktif"/"Perlu Perhatian") without a
  real backing field.
- Stockist stays read-only/monitor-only in concept even though no data is
  shown — no stock-opname/adjustment/receiving/transfer actions are ever
  implemented here (§11 do-not-touch).
- `npm --workspace=backoffice run build` / `test` succeed after every task.

---

### Task 1: `getMokaSyncLogs` in `services/moka.ts`

**Files:**
- Modify: `backoffice/src/services/moka.ts`
- Create: `backoffice/src/services/__tests__/moka.test.ts` additions (file
  already exists from Phase 1A with 1 test for `getMokaStatus`)

**Interfaces:**
- Produces: `getMokaSyncLogs(params)`, type `MokaSyncLogEntry` — Task 2
  (Moka POS Integration page) imports these.

- [ ] **Step 1: Write the failing test**

Add to `backoffice/src/services/__tests__/moka.test.ts`:

```ts
  it('getMokaSyncLogs calls GET /api/moka/sync-logs with no params by default', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ logs: [] }), { status: 200 })
    );
    await getMokaSyncLogs({});
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/sync-logs');
  });

  it('getMokaSyncLogs passes through limit', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ logs: [] }), { status: 200 })
    );
    await getMokaSyncLogs({ limit: 20 });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/sync-logs?limit=20');
  });
```

Add `getMokaSyncLogs` to the import list.

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- moka.test.ts`
Expected: FAIL — not exported yet.

- [ ] **Step 3: Implement it**

Append to `backoffice/src/services/moka.ts`:

```ts
export interface MokaSyncLogEntry {
  id: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  status: string;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}

export function getMokaSyncLogs(params: { limit?: number; direction?: string; status?: string }): Promise<{ logs: MokaSyncLogEntry[] }> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.direction) query.set('direction', params.direction);
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return apiClient.get<{ logs: MokaSyncLogEntry[] }>(`/api/moka/sync-logs${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- moka.test.ts`
Expected: 3 tests pass (1 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/moka.ts backoffice/src/services/__tests__/moka.test.ts
git commit -m "feat(backoffice): add getMokaSyncLogs to moka service"
```

---

### Task 2: Moka POS Integration page

**Files:**
- Create: `backoffice/src/pages/MokaIntegration.tsx`
- Create: `backoffice/src/pages/__tests__/MokaIntegration.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/moka`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getMokaStatus` (B1), `getMokaSyncLogs` (Task 1).
- Produces: the `MokaIntegration` page, routed at `/moka`.

- [ ] **Step 1: Update route table** (14 → 13 remaining placeholders).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/MokaIntegration.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MokaIntegration } from '../MokaIntegration';

const STATUS = {
  oauthConfigured: true,
  outlets: [
    { id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false },
    { id: 'o2', name: 'Bypass', slug: 'bypass', mokaOutletId: 'm2', hasToken: false, tokenExpiry: null, tokenExpired: null },
  ],
  recentLogs: [],
};

const LOGS = {
  logs: [
    { id: 'l1', direction: 'pull', entity_type: 'transaction', entity_id: 'tx1', status: 'ok', error_message: null, retry_count: 0, created_at: '2026-09-01T08:46:00.000Z' },
    { id: 'l2', direction: 'push', entity_type: 'item_mapping', entity_id: null, status: 'error', error_message: 'SKU tidak ditemukan', retry_count: 1, created_at: '2026-09-01T08:30:00.000Z' },
  ],
};

function mockFetch() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('sync-logs')) return Promise.resolve(new Response(JSON.stringify(LOGS), { status: 200 }));
    if (url.includes('status')) return Promise.resolve(new Response(JSON.stringify(STATUS), { status: 200 }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('MokaIntegration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders per-outlet connection status', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => {
      expect(screen.getByText('CSB')).toBeInTheDocument();
    });
    expect(screen.getByText('Bypass')).toBeInTheDocument();
  });

  it('renders real sync log entries', async () => {
    mockFetch();
    render(<MokaIntegration />);
    await waitFor(() => {
      expect(screen.getByText(/SKU tidak ditemukan/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/MokaIntegration.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getMokaStatus, getMokaSyncLogs, type MokaStatus, type MokaSyncLogEntry } from '../services/moka';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

const ENTITY_LABEL: Record<string, string> = {
  transaction: 'Transaction sync',
  item_mapping: 'Item mapping',
  customer: 'Customer sync',
  open_bill: 'Open bill sync',
};

export function MokaIntegration() {
  const [status, setStatus] = useState<LoadState<MokaStatus>>({ status: 'loading' });
  const [logs, setLogs] = useState<LoadState<MokaSyncLogEntry[]>>({ status: 'loading' });

  useEffect(() => {
    getMokaStatus()
      .then((data) => setStatus({ status: 'ready', data }))
      .catch(() => setStatus({ status: 'error', message: 'Terjadi kesalahan memuat status Moka.' }));
  }, []);

  useEffect(() => {
    getMokaSyncLogs({ limit: 20 })
      .then((data) => setLogs({ status: 'ready', data: data.logs }))
      .catch(() => setLogs({ status: 'error', message: 'Terjadi kesalahan memuat sync logs.' }));
  }, []);

  const connectedCount = status.status === 'ready' ? status.data.outlets.filter((o) => o.hasToken && !o.tokenExpired).length : 0;

  return (
    <>
      <PageHeader title="Moka POS Integration" subtitle="Status koneksi & sinkronisasi — Moka tetap menjadi sumber kebenaran transaksi" />

      {status.status === 'loading' && <LoadingState label="Memuat status Moka..." />}
      {status.status === 'error' && <ErrorState message={status.message} />}

      {status.status === 'ready' && (
        <>
          <div className="mb-5 flex items-center justify-between rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${status.data.oauthConfigured ? 'bg-rb-green-tint-fg' : 'bg-rb-red-tint-fg'}`} />
              <div>
                <div className="text-[15px] font-semibold text-rb-text">{status.data.oauthConfigured ? 'Connected' : 'Not Configured'}</div>
                <div className="text-xs text-rb-text-muted">OAuth {status.data.oauthConfigured ? 'aktif' : 'belum dikonfigurasi'} · terhubung ke {connectedCount}/{status.data.outlets.length} outlet Moka</div>
              </div>
            </div>
          </div>

          <div className="mb-5 rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
              Status Outlet
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {status.data.outlets.map((o) => (
                <div key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="font-medium text-rb-text-secondary">{o.name}</span>
                  <span className={o.tokenExpired ? 'text-rb-red-tint-fg' : o.hasToken ? 'text-rb-green-tint-fg' : 'text-rb-text-muted'}>
                    {o.hasToken ? (o.tokenExpired ? 'Token kedaluwarsa' : 'Terhubung') : 'Belum terhubung'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Sync Logs
        </div>
        {logs.status === 'loading' && <LoadingState label="Memuat sync logs..." />}
        {logs.status === 'error' && <ErrorState message={logs.message} />}
        {logs.status === 'ready' && (
          <div className="flex flex-col divide-y divide-rb-divider">
            {logs.data.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.status === 'ok' ? 'bg-rb-green-tint-fg' : 'bg-rb-red-tint-fg'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-rb-text-secondary">
                    {ENTITY_LABEL[l.entity_type] ?? l.entity_type} — {l.direction} {l.status === 'ok' ? 'berhasil' : 'gagal'}
                  </div>
                  {l.error_message && <div className="truncate text-xs text-rb-text-muted">{l.error_message}</div>}
                </div>
                <span className="shrink-0 text-xs text-rb-text-muted">{new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- MokaIntegration.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/MokaIntegration.tsx backoffice/src/pages/__tests__/MokaIntegration.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Moka POS Integration to real status and sync-logs data"
```

---

### Task 3: Stockist Inventory Dashboard page (honest UNAVAILABLE)

**Files:**
- Create: `backoffice/src/pages/StockistDashboard.tsx`
- Create: `backoffice/src/pages/__tests__/StockistDashboard.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/stockist`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: nothing (no data fetching — the architectural blocker is
  already established in §8a).
- Produces: the `StockistDashboard` page, routed at `/stockist`.

- [ ] **Step 1: Update route table** (13 → 12).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/StockistDashboard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockistDashboard } from '../StockistDashboard';

describe('StockistDashboard', () => {
  it('shows an honest UNAVAILABLE state, not fabricated inventory numbers', () => {
    render(<StockistDashboard />);
    expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('links to the real Stockist application', () => {
    render(<StockistDashboard />);
    const link = screen.getByRole('link', { name: /Open Stockist Application/i });
    expect(link.getAttribute('href')).toBe('https://stockist.redboxbarbershop.com');
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/StockistDashboard.tsx`:

```tsx
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

export function StockistDashboard() {
  return (
    <>
      <PageHeader
        title="Stockist & Inventory"
        subtitle="Monitoring & analitik — pekerjaan operasional detail ada di aplikasi Stockist"
        actions={
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-sm font-semibold text-rb-text-secondary"
          >
            Open Stockist Application ↗
          </a>
        }
      />
      <EmptyState
        title="UNAVAILABLE"
        description="Data Stockist belum bisa diakses dari Backoffice — kendala akses backend (auth), bukan data kosong. stockist.redboxbarbershop.com tetap menjadi sumber kebenaran operasional inventory."
      />
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- StockistDashboard.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/StockistDashboard.tsx backoffice/src/pages/__tests__/StockistDashboard.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add honest UNAVAILABLE Stockist Inventory Dashboard, link to real app"
```

---

### Task 4: Full verification and design-fidelity review

**Files:** none.

- [ ] **Step 1:** Run the full backoffice test suite; expect all pass.
- [ ] **Step 2:** Build; expect success.
- [ ] **Step 3:** Run the full root server suite; expect the same 24
      pre-existing/unrelated failures (this workstream touches no backend
      files at all, so this is guaranteed by construction — still verify).
- [ ] **Step 4:** Verify `vercel.json`'s `functions` map still has exactly
      12 entries (guaranteed — no `api/` files touched).
- [ ] **Step 5:** Design-fidelity review against both `.dc.html` files;
      document deviations (expected: Moka's 6-card sync-status grid reduced
      to a connection card + per-outlet status list + real Sync Logs;
      Stockist's stat cards/branch bars/transfers/low-stock table all
      replaced by one honest UNAVAILABLE panel, per the already-approved
      §8a decision).
- [ ] **Step 6:** Commit the plan with review notes appended.

## Definition of done for this workstream

- [ ] Full backoffice test suite passes
- [ ] `npm --workspace=backoffice run build` succeeds
- [ ] Root server suite unaffected (no backend files touched)
- [ ] Serverless function count unchanged at 12
- [ ] No live external Moka API call triggered by page load
- [ ] Stockist shows honest UNAVAILABLE, no fabricated inventory numbers
- [ ] Design-fidelity review written into the plan/completion report
- [ ] No stop condition was hit — proceed directly into Workstream F per
      standing instruction
