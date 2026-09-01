# Backoffice Workstream B2 — Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Operations `ComingSoon` placeholder with a real, cross-branch
daily operations view: a unified "Booking Hari Ini" feed and a "Barber On Duty"
roster, both aggregated client-side from the existing branch-scoped
`command-center` endpoint — zero backend changes.

**Architecture:** `getOwnerOverview()` (already shipped, B1) supplies the list of
branch slugs/names. `Promise.all` fans out one `command-center?branch=<slug>`
call per branch (5 calls, once on mount, no polling), and the page merges each
branch's `booking_feed` and `barbers` arrays into one combined, branch-tagged
list. No new backend endpoint, no widened SELECT — the source-pill sub-feature
(Website/Walk-in/Moka/Admin) is honestly omitted this increment (see audit
note in spec §8a).

**Tech Stack:** Same as B1 — no new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§8 workstream B2, §9 components, §12 design fidelity, §14 production safety)

## Global Constraints

- No fabricated statuses. Booking status pills use the real `status` enum
  values `command-center`'s `booking_feed` actually returns (`pending`,
  `confirmed` — the endpoint pre-filters to these two), not the design's
  invented Selesai/Berjalan/Perlu Review labels which don't map 1:1 to the
  real enum.
- Source pill (Website/Walk-in/Moka/Admin) is **omitted this increment** —
  disclosed deviation, not a bug. `bookings` has no `source` column;
  `schedules.source` only has two values (`web`/`moka`); deriving it needs a
  join through `bookings.schedule_id` the existing endpoint doesn't select.
  Not worth a backend change for a cosmetic tag — flagged for a future,
  separately-scoped decision if wanted.
- 5 parallel requests on mount is the entire request budget for this page —
  no polling, no re-fetch on interaction (there's no period/branch filter on
  Operations per the design — it's always the live cross-branch view).
- One branch's failed `command-center` call must not blank the whole page —
  merge only the branches that succeeded, and show a small inline notice
  listing which branch(es) failed to load, if any.
- Serverless function count stays at 12 — no backend files touched.
- `npm --workspace=backoffice run build` and `test` must succeed after every task.

---

### Task 1: Extend `services/crm.ts` with `getCommandCenterForBranch`

**Files:**
- Modify: `backoffice/src/services/crm.ts`
- Modify: `backoffice/src/services/__tests__/crm.test.ts`

**Interfaces:**
- Consumes: `apiClient` (unchanged).
- Produces: `getCommandCenterForBranch(branch: string): Promise<CommandCenterBranchData>`,
  type `CommandCenterBranchData` — Task 2 imports this directly.

- [ ] **Step 1: Write the failing test**

Add to `backoffice/src/services/__tests__/crm.test.ts` (inside the existing
`describe('crm service', ...)` block, alongside the existing tests):

```ts
  it('getCommandCenterForBranch calls GET /api/admin/crm/command-center?branch=<slug>', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ today: '2026-09-01', barbers: [], stats: {}, home_service: [], booking_feed: [], moka_open_bills: [], alerts: [] }), { status: 200 })
    );

    await getCommandCenterForBranch('csb');

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/crm/command-center?branch=csb');
  });
```

Add the import at the top of the same test file:

```ts
import { getOwnerOverview, getOwnerRevenue, getMembership, getCommandCenterForBranch } from '../crm';
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: FAIL — `getCommandCenterForBranch` is not exported yet.

- [ ] **Step 3: Implement it**

Add to `backoffice/src/services/crm.ts` (append at the end of the file):

```ts
export interface CommandCenterBarber {
  id: string;
  name: string;
  branch: string;
  attendance_status: string | null;
  today_count: number;
}

export interface CommandCenterBookingFeedItem {
  id: string;
  status: 'pending' | 'confirmed';
  time: string;
  barber_id: string | null;
  name: string;
  wa: string | null;
  service: string;
  notes: string | null;
}

export interface CommandCenterBranchData {
  today: string;
  barbers: CommandCenterBarber[];
  stats: {
    hadir: number;
    tidak_hadir: number;
    belum_check_in: number;
    booking_today: number;
    pending: number;
    home_service_active: number;
    moka_open_bills: number;
  };
  home_service: unknown[];
  booking_feed: CommandCenterBookingFeedItem[];
  moka_open_bills: unknown[];
  alerts: { type: string; message: string }[];
}

export function getCommandCenterForBranch(branch: string): Promise<CommandCenterBranchData> {
  return apiClient.get<CommandCenterBranchData>(`/api/admin/crm/command-center?branch=${encodeURIComponent(branch)}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- crm.test.ts`
Expected: 5 tests pass (4 existing + this one).

- [ ] **Step 5: Commit**

```bash
git add backoffice/src/services/crm.ts backoffice/src/services/__tests__/crm.test.ts
git commit -m "feat(backoffice): add getCommandCenterForBranch to crm service"
```

---

### Task 2: Remove Operations from the placeholder table, build the real page

**Files:**
- Create: `backoffice/src/pages/Operations.tsx`
- Create: `backoffice/src/pages/__tests__/Operations.test.tsx`
- Modify: `backoffice/src/routes.ts`
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `getOwnerOverview` (B1), `getCommandCenterForBranch` (Task 1),
  `PageHeader`, `StatCard`, `LoadingState`, `ErrorState`, `LiveBadge`
  (all shipped).
- Produces: the real `Operations` page — no other task depends on its
  internals.

- [ ] **Step 1: Update the route-table test first**

In `backoffice/src/__tests__/routes.test.ts`, change the length assertion and
add a new one:

```ts
  it('defines exactly the 21 remaining non-Command-Center, non-Login, non-Operations screens', () => {
    expect(PLACEHOLDER_ROUTES).toHaveLength(21);
  });

  it('no longer defines /operations as a placeholder (it has a real page)', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/operations');
  });
```

Replace the old `toHaveLength(22)` test (delete it — the new one above
supersedes it).

- [ ] **Step 2: Run to verify the route-table test fails**

Run: `npm --workspace=backoffice run test -- routes.test.ts`
Expected: FAIL — `PLACEHOLDER_ROUTES` still has 22 entries including `/operations`.

- [ ] **Step 3: Remove the `/operations` entry from `routes.ts`**

In `backoffice/src/routes.ts`, delete this line from `PLACEHOLDER_ROUTES`:

```ts
  { path: '/operations', title: 'Operations' },
```

- [ ] **Step 4: Run to verify the route-table test passes**

Run: `npm --workspace=backoffice run test -- routes.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Write the failing test for the real Operations page**

Create `backoffice/src/pages/__tests__/Operations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Operations } from '../Operations';

const OWNER_OVERVIEW = {
  today: '2026-09-01',
  branches: [
    { slug: 'csb', name: 'CSB', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 0, goshow: 0, pending_bookings: 0 },
    { slug: 'bypass', name: 'Bypass', revenue_moka: 0, tx_moka: 0, revenue_web: 0, tx_web: 0, hadir: 0, total_barbers: 0, goshow: 0, pending_bookings: 0 },
  ],
  totals: { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 0 },
};

const CSB_DATA = {
  today: '2026-09-01',
  barbers: [{ id: 'b1', name: 'Ubay', branch: 'csb', attendance_status: 'hadir', today_count: 3 }],
  stats: { hadir: 1, tidak_hadir: 0, belum_check_in: 0, booking_today: 2, pending: 1, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [{ id: 'bk1', status: 'pending', time: '10:00', barber_id: 'b1', name: 'Budi', wa: '+6281', service: 'Haircut', notes: null }],
  moka_open_bills: [],
  alerts: [],
};

const BYPASS_DATA = {
  today: '2026-09-01',
  barbers: [{ id: 'b2', name: 'Sari', branch: 'bypass', attendance_status: null, today_count: 0 }],
  stats: { hadir: 0, tidak_hadir: 0, belum_check_in: 1, booking_today: 0, pending: 0, home_service_active: 0, moka_open_bills: 0 },
  home_service: [],
  booking_feed: [],
  moka_open_bills: [],
  alerts: [],
};

function mockFetchSequence() {
  const fetchMock = fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('owner-overview')) {
      return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
    }
    if (url.includes('branch=csb')) {
      return Promise.resolve(new Response(JSON.stringify(CSB_DATA), { status: 200 }));
    }
    if (url.includes('branch=bypass')) {
      return Promise.resolve(new Response(JSON.stringify(BYPASS_DATA), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
}

describe('Operations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges the booking feed across branches and shows the customer name', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
  });

  it('resolves the barber name from the matching branch roster', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
    expect(screen.getByText('Ubay')).toBeInTheDocument();
  });

  it('renders the barber-on-duty roster merged across branches', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getAllByText('Ubay').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Sari')).toBeInTheDocument();
  });

  it('shows a total booking-today count derived from real per-branch stats', async () => {
    mockFetchSequence();
    render(<Operations />);

    await waitFor(() => {
      // CSB booking_today: 2, Bypass booking_today: 0 -> total 2
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('does not blank the whole page when one branch fails to load', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('owner-overview')) {
        return Promise.resolve(new Response(JSON.stringify(OWNER_OVERVIEW), { status: 200 }));
      }
      if (url.includes('branch=csb')) {
        return Promise.resolve(new Response(JSON.stringify(CSB_DATA), { status: 200 }));
      }
      if (url.includes('branch=bypass')) {
        return Promise.resolve(new Response('server exploded', { status: 500 }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    });

    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Budi')).toBeInTheDocument();
    });
    expect(screen.getByText(/Bypass/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm --workspace=backoffice run test -- Operations.test.tsx`
Expected: FAIL — `../Operations` module does not exist.

- [ ] **Step 7: Implement `Operations.tsx`**

Create `backoffice/src/pages/Operations.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { LiveBadge } from '../components/LiveBadge';
import {
  getOwnerOverview,
  getCommandCenterForBranch,
  type CommandCenterBookingFeedItem,
  type CommandCenterBarber,
} from '../services/crm';

interface MergedBooking extends CommandCenterBookingFeedItem {
  branchName: string;
  barberName: string;
}

interface MergedBarber extends CommandCenterBarber {
  branchName: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      bookings: MergedBooking[];
      barbers: MergedBarber[];
      bookingTodayTotal: number;
      failedBranches: string[];
    };

export function Operations() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let overview;
      try {
        overview = await getOwnerOverview();
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Terjadi kesalahan memuat daftar cabang.' });
        return;
      }

      const results = await Promise.allSettled(
        overview.branches.map((b) => getCommandCenterForBranch(b.slug))
      );

      const bookings: MergedBooking[] = [];
      const barbers: MergedBarber[] = [];
      let bookingTodayTotal = 0;
      const failedBranches: string[] = [];

      results.forEach((result, i) => {
        const branch = overview.branches[i];
        if (result.status === 'rejected') {
          failedBranches.push(branch.name);
          return;
        }
        const data = result.value;
        bookingTodayTotal += data.stats.booking_today;

        const barberNameMap = new Map(data.barbers.map((b) => [b.id, b.name]));
        for (const booking of data.booking_feed) {
          bookings.push({
            ...booking,
            branchName: branch.name,
            barberName: (booking.barber_id && barberNameMap.get(booking.barber_id)) || '—',
          });
        }
        for (const barber of data.barbers) {
          barbers.push({ ...barber, branchName: branch.name });
        }
      });

      bookings.sort((a, b) => a.time.localeCompare(b.time));

      if (!cancelled) {
        setState({ status: 'ready', bookings, barbers, bookingTodayTotal, failedBranches });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Operations"
        subtitle="Aktivitas booking dan barber lintas cabang, hari ini"
      />

      {state.status === 'loading' && <LoadingState label="Memuat data operasional..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg px-4 py-2.5 text-sm text-rb-orange-tint-fg">
              Gagal memuat data untuk: {state.failedBranches.join(', ')}. Cabang lain tetap ditampilkan.
            </div>
          )}

          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.bookingTodayTotal} label="Booking Hari Ini" tint="red" />
            <StatCard value={state.bookings.length} label="Menunggu / Perlu Aksi" tint="purple" />
            <StatCard value={state.barbers.filter((b) => b.attendance_status === 'hadir' || b.attendance_status === 'terlambat').length} label="Barber Hadir" tint="green" />
            <StatCard value={state.barbers.filter((b) => !b.attendance_status).length} label="Belum Check-in" tint="orange" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Booking Hari Ini</h2>
                <LiveBadge partial />
              </div>
              {state.bookings.length === 0 && (
                <p className="py-6 text-center text-sm text-rb-text-muted">Tidak ada booking pending/confirmed saat ini.</p>
              )}
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.bookings.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-12 shrink-0 text-rb-text-muted">{b.time}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-rb-text-secondary">{b.name}</div>
                      <div className="truncate text-xs text-rb-text-muted">{b.service} · {b.branchName} · {b.barberName}</div>
                    </div>
                    <span className="shrink-0 rounded-rb-pill bg-rb-blue-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-blue-tint-fg">
                      {b.status === 'pending' ? 'Menunggu Konfirmasi' : 'Terkonfirmasi'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-base font-semibold text-rb-text">Barber On Duty</h2>
                <LiveBadge />
              </div>
              <div className="flex flex-col divide-y divide-rb-divider">
                {state.barbers.map((b) => (
                  <div key={`${b.branchName}-${b.id}`} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-rb-text-secondary">{b.name}</div>
                      <div className="text-xs text-rb-text-muted">{b.branchName}</div>
                    </div>
                    <span className="shrink-0 text-xs text-rb-text-muted">{b.attendance_status ?? 'Belum check-in'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] text-rb-text-faint">
                Moka tetap menjadi sumber kebenaran transaksional untuk seluruh booking.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 8: Wire the route in `App.tsx`**

In `backoffice/src/App.tsx`, add the import and the real route (placed among
the other real routes, before the `PLACEHOLDER_ROUTES.map` line):

```tsx
import { Operations } from './pages/Operations';
```

```tsx
          <Route path={COMMAND_CENTER_PATH} element={<CommandCenter />} />
          <Route path="/operations" element={<Operations />} />
          {PLACEHOLDER_ROUTES.map((route) => (
```

- [ ] **Step 9: Run the Operations test suite**

Run: `npm --workspace=backoffice run test -- Operations.test.tsx`
Expected: 5 tests pass. If a text query is ambiguous (e.g. `getByText('2')`
matching more than one node), switch to `getAllByText('2').length` guarding —
same pattern as the fixture-collision fix in Workstream B1 Task 4.

- [ ] **Step 10: Run the full test suite**

Run: `npm --workspace=backoffice run test`
Expected: all tests pass (Workstream A's 14 + B1's 13 + this workstream's 6).

- [ ] **Step 11: Verify the build succeeds**

Run: `npm --workspace=backoffice run build`
Expected: succeeds.

- [ ] **Step 12: Commit**

```bash
git add backoffice/src/pages/Operations.tsx backoffice/src/pages/__tests__/Operations.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): wire Operations to real per-branch command-center data, merged client-side"
```

---

### Task 3: Design-fidelity review against `Operations.dc.html`

**Files:** none (review task; fix trivial gaps inline if found, re-run Task 2's
tests before any follow-up commit).

- [x] **Step 1: Read `design_handoff_command_center/screens/Operations.dc.html`**
      and the live-rendered page side by side.

- [x] **Step 2: Document disclosed deviations** (for the completion report):
  - **Source pill (Website/Walk-in/Moka/Admin) omitted** — no real backing
    this increment. `bookings` has no `source` column; `schedules.source`
    only distinguishes 2 values (web/moka), not the design's 4; deriving it
    would need a join through `bookings.schedule_id`, which `command-center`
    doesn't currently select. Not worth a backend change for a cosmetic tag.
  - **Status pills use the real 2-value enum** (`Menunggu Konfirmasi` /
    `Terkonfirmasi`), not the design's 4-value Selesai/Berjalan/Menunggu/Perlu
    Review — `command-center`'s `booking_feed` only returns pending/confirmed
    rows in the first place; there is no real "Selesai"/"completed" signal
    available from this endpoint.
  - **Stat row uses 4 real cells** (Booking Hari Ini, Menunggu/Perlu Aksi,
    Barber Hadir, Belum Check-in) instead of the design's Booking/Selesai/
    Berjalan/Butuh Review — same "no fabricated completion status" reasoning
    as Command Center's KPI row.
  - **Barber On Duty status is the raw daily `attendance_status`** value
    (hadir/terlambat/izin/sakit/cuti/none), not the design's live-occupancy
    labels ("Sedang melayani" / "Tersedia" / "Istirahat" with a colored dot).
    Those labels describe real-time booking occupancy — whether a barber is
    *currently* serving a customer right now — which has no backing data
    source; `attendance_status` only tells us whether they checked in for
    the day. Fabricating an occupancy state was correctly avoided per the
    "no invented queue/occupancy signals" rule.
  - **Branch filter chip row (design's "Semua Cabang" pill) omitted** —
    Operations is scoped as an always-all-branches merged view per this
    plan's architecture (no per-branch filtering control), so the chip row
    has no function to attach to. Minor structural omission, not a data
    fidelity issue.
  - Everything else — booking time/customer/service/branch/barber columns,
    the barber roster's name/branch, and the reconciliation footer note — is
    real, live data or static copy matching the design.

- [x] **Step 3: Fix anything trivially fixable inline**, re-run tests + build,
      new small commit if anything changed post-Task-2-commit.
      No fixes were needed — all gaps above are deliberate, correctly-reasoned
      omissions rather than bugs, so no follow-up commit was made.

---

## Definition of done for this workstream

- [x] `npm --workspace=backoffice run test` passes (34 tests total: routes 8,
      moka 1, apiClient 5, crm 5, Operations 5, Sidebar 2, PeriodSelector 2,
      BranchSelector 2, CommandCenter 4)
- [x] `npm --workspace=backoffice run build` succeeds
- [x] Root server suite still shows only the same 24 pre-existing/unrelated
      failures (verified via `node --test --test-force-exit server/test/*.test.js`
      — all in stockist-notifications, membership dashboard, phone-alias
      resolution, webhook.js scans, BottomNavBar; none touch Backoffice)
- [x] Serverless function count unchanged at 12 (verified against
      `vercel.json`'s `functions` map — no `server/` or `api/` files touched)
- [x] Design-fidelity review written into the completion report (see Task 3)
- [x] No stop condition was hit — proceed directly into Workstream C per
      standing instruction
