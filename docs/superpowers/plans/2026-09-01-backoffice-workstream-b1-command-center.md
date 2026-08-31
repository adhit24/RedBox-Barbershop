# Backoffice Workstream B1 — Command Center Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Command Center's `Data KPI belum terhubung` placeholder with
the real, design-faithful Command Center composition, wired to genuinely
cross-branch endpoints only (no guessed fields, no N+1 branch loops — those are
Workstream B2/Operations concerns).

**Architecture:** A thin `services/crm.ts` + `services/moka.ts` layer wraps
`apiClient` with typed functions for the four endpoints audited in spec §8a
(`owner-overview`, `owner-revenue`, `moka/status`, `membership`). `CommandCenter.tsx`
fetches all four on mount (and re-fetches `owner-revenue` when the period/branch
selector changes), renders each section independently so one failed request
never blanks the whole page, and derives every displayed number from real
response fields — nothing fabricated.

**Tech Stack:** Same as Workstream A (Vite/React/TS/Tailwind, Vitest + RTL) —
no new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 row 2, §8a data audit, §9 components, §12 design fidelity, §14 production
safety)

## Global Constraints

- No fabricated numbers. A KPI cell with no real cross-branch source this
  workstream (Completed Services, Repeat Customers, Attendance Alerts, Payroll
  Pending, Low Stock Alerts) is **omitted from this increment**, not
  approximated — see Task 4's design-fidelity note for the exact list and why.
- Stockist/Inventory data is UNAVAILABLE (spec §8a, owner decision) — the
  Inventory Snapshot section renders an explicit unavailable state, never a
  403 error surfaced raw to the user, never silent omission that looks like a
  bug.
- `/api/moka/status` is unauthenticated at the router level (pre-existing,
  documented finding) — call it exactly as-is, do not add auth headers beyond
  what `apiClient` already sends.
- One failed fetch must not blank the whole page — each section has its own
  loading/error/empty state (spec's "Loading / Error / Empty States"
  requirement).
- No polling, no duplicate calls — `owner-overview`, `moka/status`, and
  `membership` fetch once on mount; `owner-revenue` re-fetches only when the
  period or branch selector actually changes.
- Serverless function count stays at 12 — this workstream touches only
  `backoffice/` files.
- `npm --workspace=backoffice run build` and `npm --workspace=backoffice run test`
  must succeed after every task.

---

### Task 1: `services/crm.ts` — typed wrappers for `owner-overview`, `owner-revenue`, `membership`

**Files:**
- Create: `backoffice/src/services/crm.ts`
- Create: `backoffice/src/services/__tests__/crm.test.ts`

**Interfaces:**
- Consumes: `apiClient` from `backoffice/src/lib/apiClient.ts` (Phase 1A,
  unchanged).
- Produces:
  - `getOwnerOverview(): Promise<OwnerOverview>`
  - `getOwnerRevenue(params: { branch?: string; period?: RevenuePeriod }): Promise<OwnerRevenue>`
  - `getMembership(): Promise<MemberProfile[]>`
  - Types `OwnerOverview`, `OwnerRevenue`, `MemberProfile`, `RevenuePeriod`
    (`'today' | '7d' | '30d' | 'month'`) — Task 4 imports these directly, do
    not redefine them elsewhere.

- [ ] **Step 1: Write the failing tests**

Create `backoffice/src/services/__tests__/crm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOwnerOverview, getOwnerRevenue, getMembership } from '../crm';

describe('crm service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getOwnerOverview calls GET /api/admin/crm/owner-overview with no params', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ today: '2026-09-01', branches: [], totals: {} }), { status: 200 })
    );

    await getOwnerOverview();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-overview');
  });

  it('getOwnerRevenue defaults to branch=all and period=month when no params given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ summary: {}, daily_trend: [], branch_compare: [], top_barbers: [], top_services: [] }), { status: 200 })
    );

    await getOwnerRevenue({});

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-revenue?branch=all&period=month');
  });

  it('getOwnerRevenue passes through an explicit branch and period', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ summary: {}, daily_trend: [], branch_compare: [], top_barbers: [], top_services: [] }), { status: 200 })
    );

    await getOwnerRevenue({ branch: 'csb', period: 'today' });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/owner-revenue?branch=csb&period=today');
  });

  it('getMembership calls GET /api/admin/crm/membership and returns the array', async () => {
    const members = [{ user_key: 'a', membership_status: 'ACTIVE' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(members), { status: 200 })
    );

    const result = await getMembership();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/membership');
    expect(result).toEqual(members);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: FAIL — `../crm` module does not exist.

- [ ] **Step 3: Implement `services/crm.ts`**

Create `backoffice/src/services/crm.ts`:

```ts
import { apiClient } from '../lib/apiClient';

export type RevenuePeriod = 'today' | '7d' | '30d' | 'month';

export interface OwnerOverviewBranch {
  slug: string;
  name: string;
  revenue_moka: number;
  tx_moka: number;
  revenue_web: number;
  tx_web: number;
  hadir: number;
  total_barbers: number;
  goshow: number;
  pending_bookings: number;
}

export interface OwnerOverview {
  today: string;
  branches: OwnerOverviewBranch[];
  totals: {
    revenue_moka: number;
    revenue_web: number;
    tx_total: number;
    hadir: number;
    goshow: number;
    pending: number;
  };
}

export interface OwnerRevenueSummary {
  revenue_moka: number;
  revenue_web: number;
  tx_total: number;
  avg_tx: number;
}

export interface OwnerRevenueDailyPoint {
  date: string;
  moka: number;
  web: number;
}

export interface OwnerRevenueBranchCompare {
  slug: string;
  name: string;
  revenue_moka: number;
  revenue_web: number;
  tx_total: number;
}

export interface OwnerRevenueTopBarber {
  barber_id: string;
  name: string;
  branch: string;
  tx_count: number;
  revenue: number;
}

export interface OwnerRevenueTopService {
  service_name: string;
  count: number;
  revenue: number;
}

export interface OwnerRevenue {
  summary: OwnerRevenueSummary;
  daily_trend: OwnerRevenueDailyPoint[];
  branch_compare: OwnerRevenueBranchCompare[];
  top_barbers: OwnerRevenueTopBarber[];
  top_services: OwnerRevenueTopService[];
}

export interface MemberProfile {
  user_key: string;
  full_name: string;
  email: string;
  membership_status: 'ACTIVE' | 'INACTIVE';
  membership_activated_at: string | null;
  membership_started_at: string | null;
  membership_expires_at: string | null;
  current_tier: string;
  total_points: number;
  total_visits: number;
  created_at: string;
  phone: string | null;
  last_visit: string | null;
}

export function getOwnerOverview(): Promise<OwnerOverview> {
  return apiClient.get<OwnerOverview>('/api/admin/crm/owner-overview');
}

export function getOwnerRevenue(params: { branch?: string; period?: RevenuePeriod }): Promise<OwnerRevenue> {
  const branch = params.branch ?? 'all';
  const period = params.period ?? 'month';
  const query = new URLSearchParams({ branch, period }).toString();
  return apiClient.get<OwnerRevenue>(`/api/admin/crm/owner-revenue?${query}`);
}

export function getMembership(): Promise<MemberProfile[]> {
  return apiClient.get<MemberProfile[]>('/api/admin/crm/membership');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/crm.ts backoffice/src/services/__tests__/crm.test.ts
git commit -m "feat(backoffice): add crm service layer (owner-overview, owner-revenue, membership)"
```

---

### Task 2: `services/moka.ts` — typed wrapper for `moka/status`

**Files:**
- Create: `backoffice/src/services/moka.ts`
- Create: `backoffice/src/services/__tests__/moka.test.ts`

**Interfaces:**
- Consumes: `apiClient`.
- Produces: `getMokaStatus(): Promise<MokaStatus>`, types `MokaStatus`,
  `MokaOutletStatus`, `MokaSyncLog`.

- [ ] **Step 1: Write the failing test**

Create `backoffice/src/services/__tests__/moka.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMokaStatus } from '../moka';

describe('moka service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getMokaStatus calls GET /api/moka/status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ oauthConfigured: true, outlets: [], recentLogs: [] }), { status: 200 })
    );

    const result = await getMokaStatus();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/moka/status');
    expect(result.oauthConfigured).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- moka.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/moka.ts`**

Create `backoffice/src/services/moka.ts`:

```ts
import { apiClient } from '../lib/apiClient';

export interface MokaOutletStatus {
  id: string;
  name: string;
  slug: string;
  mokaOutletId: string | null;
  hasToken: boolean;
  tokenExpiry: string | null;
  tokenExpired: boolean | null;
}

export interface MokaSyncLog {
  direction: string;
  status: string;
  created_at: string;
  error_message: string | null;
}

export interface MokaStatus {
  oauthConfigured: boolean;
  outlets: MokaOutletStatus[];
  recentLogs: MokaSyncLog[];
}

export function getMokaStatus(): Promise<MokaStatus> {
  return apiClient.get<MokaStatus>('/api/moka/status');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- moka.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/moka.ts backoffice/src/services/__tests__/moka.test.ts
git commit -m "feat(backoffice): add moka service layer (status)"
```

---

### Task 3: `PeriodSelector` and `BranchSelector` components

**Files:**
- Create: `backoffice/src/components/PeriodSelector.tsx`
- Create: `backoffice/src/components/BranchSelector.tsx`
- Create: `backoffice/src/components/__tests__/PeriodSelector.test.tsx`
- Create: `backoffice/src/components/__tests__/BranchSelector.test.tsx`

**Interfaces:**
- Consumes: `RevenuePeriod` type from `../services/crm`.
- Produces:
  - `<PeriodSelector value={RevenuePeriod} onChange={(p: RevenuePeriod) => void} />`
  - `<BranchSelector value={string} branches={{slug: string; name: string}[]} onChange={(slug: string) => void} />`
    (`value="all"` means "Semua Cabang")

- [ ] **Step 1: Write the failing tests**

Create `backoffice/src/components/__tests__/PeriodSelector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodSelector } from '../PeriodSelector';

describe('PeriodSelector', () => {
  it('calls onChange with the selected period', async () => {
    const onChange = vi.fn();
    render(<PeriodSelector value="month" onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Periode'), 'today');

    expect(onChange).toHaveBeenCalledWith('today');
  });

  it('shows the current value as selected', () => {
    render(<PeriodSelector value="7d" onChange={() => {}} />);

    expect(screen.getByLabelText('Periode')).toHaveValue('7d');
  });
});
```

Create `backoffice/src/components/__tests__/BranchSelector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchSelector } from '../BranchSelector';

const BRANCHES = [
  { slug: 'csb', name: 'CSB' },
  { slug: 'bypass', name: 'Bypass' },
];

describe('BranchSelector', () => {
  it('always offers "Semua Cabang" as the first option', () => {
    render(<BranchSelector value="all" branches={BRANCHES} onChange={() => {}} />);

    const select = screen.getByLabelText('Cabang') as HTMLSelectElement;
    expect(select.options[0].value).toBe('all');
    expect(select.options[0].textContent).toBe('Semua Cabang');
  });

  it('calls onChange with the selected branch slug', async () => {
    const onChange = vi.fn();
    render(<BranchSelector value="all" branches={BRANCHES} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Cabang'), 'csb');

    expect(onChange).toHaveBeenCalledWith('csb');
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npm --workspace=backoffice run test -- PeriodSelector.test.tsx BranchSelector.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `PeriodSelector.tsx`**

Create `backoffice/src/components/PeriodSelector.tsx`:

```tsx
import type { RevenuePeriod } from '../services/crm';

const OPTIONS: { value: RevenuePeriod; label: string }[] = [
  { value: 'today', label: 'Hari Ini' },
  { value: '7d', label: '7 Hari Terakhir' },
  { value: '30d', label: '30 Hari Terakhir' },
  { value: 'month', label: 'Bulan Ini' },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: RevenuePeriod;
  onChange: (period: RevenuePeriod) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="sr-only">Periode</span>
      <select
        aria-label="Periode"
        value={value}
        onChange={(e) => onChange(e.target.value as RevenuePeriod)}
        className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary outline-none focus:border-rb-red"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Implement `BranchSelector.tsx`**

Create `backoffice/src/components/BranchSelector.tsx`:

```tsx
export function BranchSelector({
  value,
  branches,
  onChange,
}: {
  value: string;
  branches: { slug: string; name: string }[];
  onChange: (slug: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="sr-only">Cabang</span>
      <select
        aria-label="Cabang"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary outline-none focus:border-rb-red"
      >
        <option value="all">Semua Cabang</option>
        {branches.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: Run to verify both pass**

Run: `npm --workspace=backoffice run test -- PeriodSelector.test.tsx BranchSelector.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backoffice/src/components/PeriodSelector.tsx backoffice/src/components/BranchSelector.tsx backoffice/src/components/__tests__/PeriodSelector.test.tsx backoffice/src/components/__tests__/BranchSelector.test.tsx
git commit -m "feat(backoffice): add PeriodSelector and BranchSelector components"
```

---

### Task 4: Wire the real Command Center page

**Files:**
- Modify: `backoffice/src/pages/CommandCenter.tsx` (full rewrite)
- Create: `backoffice/src/pages/__tests__/CommandCenter.test.tsx`

**Interfaces:**
- Consumes: `getOwnerOverview`, `getOwnerRevenue`, `getMembership` from
  `../services/crm`; `getMokaStatus` from `../services/moka`;
  `PeriodSelector`, `BranchSelector` from Task 3; `StatCard`, `PageHeader`,
  `LoadingState`, `ErrorState`, `EmptyState`, `LiveBadge` (already shipped,
  Phase 1A).
- Produces: the real `CommandCenter` page — no other task depends on its
  internals, so this task owns its full layout.

**Design-fidelity note (read before writing code):** the design handoff's KPI
row (`Command Center.dc.html`) shows Booking/Completed Services/Repeat
Customers/Attendance Alerts/Active Members/Payroll Pending. Per this
workstream's Global Constraints, four of those six have no real cross-branch
source yet (Completed Services, Repeat Customers, Attendance Alerts, Payroll
Pending — all require either a per-branch loop or a subsystem that doesn't
exist yet). This task builds a **6-cell KPI row using only real fields**:
Revenue (period), Transaksi (period), Rata-rata Transaksi, Kehadiran Barber
Hari Ini, Booking Pending Hari Ini, Member Aktif — same visual card style,
different (real) content. This is a disclosed, deliberate deviation, not an
oversight — call it out again in the completion report's design-fidelity
review.

- [ ] **Step 1: Write the failing test for the real page**

Create `backoffice/src/pages/__tests__/CommandCenter.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CommandCenter } from '../CommandCenter';

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 500000, tx_moka: 5, revenue_web: 100000, tx_web: 1, hadir: 4, total_barbers: 5, goshow: 1, pending_bookings: 2 },
  ],
  totals: { revenue_moka: 500000, revenue_web: 100000, tx_total: 6, hadir: 4, goshow: 1, pending: 2 },
};

const OWNER_REVENUE = {
  summary: { revenue_moka: 2000000, revenue_web: 400000, tx_total: 24, avg_tx: 100000 },
  daily_trend: [{ date: '2026-09-01', moka: 500000, web: 100000 }],
  branch_compare: [{ slug: 'csb', name: 'CSB', revenue_moka: 2000000, revenue_web: 400000, tx_total: 24 }],
  top_barbers: [{ barber_id: 'b1', name: 'Ubay', branch: 'csb', tx_count: 12, revenue: 600000 }],
  top_services: [{ service_name: 'Haircut', count: 10, revenue: 500000 }],
};

const MOKA_STATUS = {
  oauthConfigured: true,
  outlets: [{ id: 'o1', name: 'CSB', slug: 'csb', mokaOutletId: 'm1', hasToken: true, tokenExpiry: '2027-01-01', tokenExpired: false }],
  recentLogs: [{ direction: 'pull', status: 'ok', created_at: '2026-09-01T10:00:00Z', error_message: null }],
};

const MEMBERSHIP = [
  { user_key: 'u1', full_name: 'Budi', email: 'budi@example.com', membership_status: 'ACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'gold', total_points: 100, total_visits: 5, created_at: '2026-08-15T00:00:00Z', phone: '+6281', last_visit: '2026-08-30' },
  { user_key: 'u2', full_name: 'Sari', email: 'sari@example.com', membership_status: 'INACTIVE', membership_activated_at: null, membership_started_at: null, membership_expires_at: null, current_tier: 'bronze', total_points: 0, total_visits: 1, created_at: '2026-07-01T00:00:00Z', phone: '+6282', last_visit: '2026-07-10' },
];

function mockFetchSequence() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('owner-revenue')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_REVENUE), { status: 200 }));
    }
    if (url.includes('moka/status')) {
      return Promise.resolve(new Response(JSON.stringify(MOKA_STATUS), { status: 200 }));
    }
    if (url.includes('membership')) {
      return Promise.resolve(new Response(JSON.stringify(MEMBERSHIP), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('CommandCenter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders real revenue and transaction totals once data loads', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText(/Rp\s?2\.400\.000/)).toBeInTheDocument();
    });
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('renders the active member count derived from the membership list', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('shows an UNAVAILABLE state for the Inventory Snapshot section', async () => {
    mockFetchSequence();
    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText(/UNAVAILABLE/i)).toBeInTheDocument();
    });
  });

  it('renders a local error state for one section without blanking the whole page when owner-revenue fails, while owner-overview still renders', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('owner-overview')) {
        return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
      }
      if (url.includes('owner-revenue')) {
        return Promise.resolve(new Response('server exploded', { status: 500 }));
      }
      if (url.includes('moka/status')) {
        return Promise.resolve(new Response(JSON.stringify(MOKA_STATUS), { status: 200 }));
      }
      if (url.includes('membership')) {
        return Promise.resolve(new Response(JSON.stringify(MEMBERSHIP), { status: 200 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    render(<CommandCenter />);

    await waitFor(() => {
      expect(screen.getByText(/Terjadi kesalahan/i)).toBeInTheDocument();
    });
    // owner-overview-derived content still renders despite owner-revenue failing:
    expect(screen.getByText(/Command Center/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- CommandCenter.test.tsx`
Expected: FAIL — current `CommandCenter.tsx` still renders the Phase 1A
placeholder, none of the real content exists yet.

- [ ] **Step 3: Rewrite `CommandCenter.tsx`**

Replace `backoffice/src/pages/CommandCenter.tsx` in full:

```tsx
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LiveBadge } from '../components/LiveBadge';
import { PeriodSelector } from '../components/PeriodSelector';
import { BranchSelector } from '../components/BranchSelector';
import {
  getOwnerOverview,
  getOwnerRevenue,
  getMembership,
  type OwnerOverview,
  type OwnerRevenue,
  type MemberProfile,
  type RevenuePeriod,
} from '../services/crm';
import { getMokaStatus, type MokaStatus } from '../services/moka';

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

export function CommandCenter() {
  const [period, setPeriod] = useState<RevenuePeriod>('month');
  const [branch, setBranch] = useState('all');

  const [overview, setOverview] = useState<LoadState<OwnerOverview>>({ status: 'loading' });
  const [revenue, setRevenue] = useState<LoadState<OwnerRevenue>>({ status: 'loading' });
  const [moka, setMoka] = useState<LoadState<MokaStatus>>({ status: 'loading' });
  const [membership, setMembership] = useState<LoadState<MemberProfile[]>>({ status: 'loading' });

  useEffect(() => {
    getOwnerOverview()
      .then((data) => setOverview({ status: 'ready', data }))
      .catch(() => setOverview({ status: 'error', message: 'Terjadi kesalahan memuat ringkasan cabang.' }));
  }, []);

  useEffect(() => {
    getMokaStatus()
      .then((data) => setMoka({ status: 'ready', data }))
      .catch(() => setMoka({ status: 'error', message: 'Terjadi kesalahan memuat status Moka.' }));
  }, []);

  useEffect(() => {
    getMembership()
      .then((data) => setMembership({ status: 'ready', data }))
      .catch(() => setMembership({ status: 'error', message: 'Terjadi kesalahan memuat data membership.' }));
  }, []);

  useEffect(() => {
    setRevenue({ status: 'loading' });
    getOwnerRevenue({ branch, period })
      .then((data) => setRevenue({ status: 'ready', data }))
      .catch(() => setRevenue({ status: 'error', message: 'Terjadi kesalahan memuat data revenue.' }));
  }, [branch, period]);

  const activeMembers = membership.status === 'ready'
    ? membership.data.filter((m) => m.membership_status === 'ACTIVE').length
    : null;

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <div className="flex items-center gap-2">
            <BranchSelector
              value={branch}
              branches={overview.status === 'ready' ? overview.data.branches.map((b) => ({ slug: b.slug, name: b.name })) : []}
              onChange={setBranch}
            />
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
        }
      />

      {/* KPI row — real fields only, spec §8a / this task's design-fidelity note */}
      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {revenue.status === 'loading' && <LoadingState label="Memuat KPI..." />}
        {revenue.status === 'error' && <ErrorState message={revenue.message} />}
        {revenue.status === 'ready' && (
          <>
            <StatCard value={formatRupiah(revenue.data.summary.revenue_moka + revenue.data.summary.revenue_web)} label="Revenue" tint="red" />
            <StatCard value={revenue.data.summary.tx_total} label="Transaksi" tint="green" />
            <StatCard value={formatRupiah(revenue.data.summary.avg_tx)} label="Rata-rata Transaksi" tint="blue" />
          </>
        )}
        {overview.status === 'loading' && <LoadingState label="Memuat..." />}
        {overview.status === 'error' && <ErrorState message={overview.message} />}
        {overview.status === 'ready' && (
          <>
            <StatCard
              value={`${overview.data.totals.hadir}/${overview.data.branches.reduce((s, b) => s + b.total_barbers, 0)}`}
              label="Kehadiran Barber Hari Ini"
              tint="orange"
            />
            <StatCard value={overview.data.totals.pending} label="Booking Pending Hari Ini" tint="purple" />
          </>
        )}
        {membership.status === 'loading' && <LoadingState label="Memuat..." />}
        {membership.status === 'error' && <ErrorState message={membership.message} />}
        {membership.status === 'ready' && <StatCard value={activeMembers} label="Member Aktif" tint="teal" />}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Branch performance */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Performa Cabang</h2>
            <LiveBadge />
          </div>
          {revenue.status === 'loading' && <LoadingState />}
          {revenue.status === 'error' && <ErrorState message={revenue.message} />}
          {revenue.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {revenue.data.branch_compare.map((b) => (
                <div key={b.slug} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{b.name}</span>
                  <span className="text-rb-text-muted">{formatRupiah(b.revenue_moka + b.revenue_web)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Barber leaderboard */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Barber Terbaik</h2>
            <LiveBadge />
          </div>
          {revenue.status === 'loading' && <LoadingState />}
          {revenue.status === 'error' && <ErrorState message={revenue.message} />}
          {revenue.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {revenue.data.top_barbers.map((b) => (
                <div key={b.barber_id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{b.name}</span>
                  <span className="text-rb-text-muted">{formatRupiah(b.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Moka health */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Integrasi Moka</h2>
            <LiveBadge />
          </div>
          {moka.status === 'loading' && <LoadingState />}
          {moka.status === 'error' && <ErrorState message={moka.message} />}
          {moka.status === 'ready' && (
            <div className="flex flex-col divide-y divide-rb-divider">
              {moka.data.outlets.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-rb-text-secondary">{o.name}</span>
                  <span className={o.tokenExpired ? 'text-rb-red-tint-fg' : 'text-rb-green-tint-fg'}>
                    {o.hasToken ? (o.tokenExpired ? 'Token kedaluwarsa' : 'Terhubung') : 'Belum terhubung'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inventory — UNAVAILABLE, spec §8a owner decision */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-rb-text">Inventory Snapshot</h2>
          </div>
          <EmptyState
            title="UNAVAILABLE"
            description="Data Stockist belum bisa diakses dari Backoffice (kendala akses backend, bukan data kosong). Menunggu keputusan terpisah."
          />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test and iterate against real rendered output**

Run: `npm --workspace=backoffice run test -- CommandCenter.test.tsx`
Expected: 4 tests pass. If a text-matcher fails because `Intl.NumberFormat`
renders currency differently than expected in the test environment (locale
data availability varies), adjust the test's regex to match what actually
renders — do not change the component to chase a specific string format; the
currency value's correctness (not its exact glyph) is what matters.

- [ ] **Step 5: Run the full test suite**

Run: `npm --workspace=backoffice run test`
Expected: all tests pass (Task 1–3 suites + this task's 4 tests).

- [ ] **Step 6: Verify the build succeeds**

Run: `npm --workspace=backoffice run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add backoffice/src/pages/CommandCenter.tsx backoffice/src/pages/__tests__/CommandCenter.test.tsx
git commit -m "feat(backoffice): wire Command Center to real owner-overview/owner-revenue/moka/membership data"
```

---

### Task 5: Design-fidelity review against `Command Center.dc.html`

**Files:** none (review task, no code changes unless the review finds a fixable
gap — if so, fix inline and re-run Task 4's tests before committing).

- [ ] **Step 1: Read `design_handoff_command_center/screens/Command Center.dc.html`**
      and the live-rendered page side by side (`npm --workspace=backoffice run dev`,
      log in with the real credential, visit `/`).

- [ ] **Step 2: Fill out the comparison checklist**

Document, in the final report (not a new file — spec §14/completion report
already covers this):
- Layout hierarchy: header → KPI row → two-column sections → matches / deviates how
- Typography: serif headings, Inter body — matches (shared `index.css` tokens,
  unchanged this workstream)
- Card radius/spacing/borders — matches (shared `rb-card`/`rb-border` tokens)
- Badge styles — `LiveBadge`/`EmptyState` reused from Phase 1A, unchanged
- Section order — note any reordering vs the `.dc.html` and why
- **Disclosed deviations**: KPI cell content (§ Task 4 design-fidelity note),
  no Priority Action Bar this increment (Attendance/Payroll/Stock subsystems
  don't exist yet), Inventory Snapshot shows UNAVAILABLE instead of numbers,
  Branch Performance shows revenue instead of Ramai/Normal crowd-level pills
  (no real signal for crowd level — inventing one would violate the
  no-fake-numbers rule)

- [ ] **Step 3: Fix anything trivially fixable** (spacing, wrong tint color,
      wrong label text) inline, re-run `npm --workspace=backoffice run test`
      and `npm --workspace=backoffice run build` after any fix, then amend
      the Task 4 commit only if still uncommitted — otherwise a new small
      commit.

---

## Definition of done for this workstream

- [ ] `npm --workspace=backoffice run test` passes (Workstream A's 14 tests +
      this workstream's ~15 new tests)
- [ ] `npm --workspace=backoffice run build` succeeds
- [ ] Root `node --test --test-force-exit server/test/*.test.js` still shows
      only the same 24 pre-existing/unrelated failures
- [ ] Serverless function count unchanged at 12
- [ ] Manual live-credential check: log in, confirm every KPI number matches
      what a direct `curl` to the same endpoints (with the real token) returns
      — no visual-only sanity check, actually cross-check at least one number
- [ ] Design-fidelity review (Task 5) written into the completion report,
      deviations explicitly listed
- [ ] Report per spec §14 before starting Workstream B2 (Operations)
