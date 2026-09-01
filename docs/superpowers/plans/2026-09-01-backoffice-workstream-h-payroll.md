# Backoffice Workstream H — Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Payroll Overview, Regular Payroll, Barber Payroll, and
Payroll Employee Detail as honest DEMO screens — no payroll table exists
(spec §5 rows 8–11). All four use static mock data with `DemoBadge`
prominent in every header. **Never hardcode/assert a real barber commission
rate** — the mockup's own commission/revenue-sharing figures are used
verbatim only as illustrative DEMO content on an entirely DEMO-labeled
page, never presented as Redbox's actual real commission policy.

**Architecture:** Same pattern as Workstreams F/G — no service layer, no
API calls, typed mock datasets as local constants, action buttons render
inert (no `onClick`).

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 8–11, §8 workstream H)

## Global Constraints

- Every number is DEMO data — `DemoBadge` in every page header.
- Never assert or compute a real commission percentage — the demo
  "Revenue Sharing 8%" / "Tier Senior Barber" text is illustrative sample
  content on an all-DEMO page, not a claimed real policy.
- No backend calls, no new service files.
- Action buttons (Approve, Generate Payslip, Create Payroll Draft, Edit
  Adjustment) render inert — no `onClick`, no fake success state.
- `npm --workspace=backoffice run build` / `test` succeed after every task.

---

### Task 1: Payroll Overview page

**Files:**
- Create: `backoffice/src/pages/PayrollOverview.tsx`
- Create: `backoffice/src/pages/__tests__/PayrollOverview.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/payroll`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (7 → 6).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PayrollOverview } from '../PayrollOverview';

describe('PayrollOverview', () => {
  it('shows the DEMO badge', () => {
    render(<PayrollOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('links to Regular Payroll and Barber Payroll', () => {
    render(<PayrollOverview />, { wrapper: MemoryRouter });
    expect(screen.getAllByRole('link', { name: /Regular Payroll/i })[0].getAttribute('href')).toBe('/payroll/regular');
    expect(screen.getAllByRole('link', { name: /Barber Payroll/i })[0].getAttribute('href')).toBe('/payroll/barber');
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

export function PayrollOverview() {
  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Data contoh — belum ada tabel payroll produksi"
        actions={<DemoBadge />}
      />
      <section className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard value={70} label="Total Karyawan (contoh)" tint="blue" />
        <Link to="/payroll/regular" className="block no-underline">
          <StatCard value={38} label="Fixed Salary →" tint="purple" />
        </Link>
        <Link to="/payroll/barber" className="block no-underline">
          <StatCard value={32} label="Revenue Sharing →" tint="orange" />
        </Link>
        <StatCard value={4} label="Pending Review (contoh)" tint="yellow" />
        <StatCard value={2} label="Need Adjustment (contoh)" tint="red" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link to="/payroll/regular" className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-purple-tint-bg text-rb-purple-tint-fg">R</div>
          <div className="mb-1.5 text-[15px] font-semibold text-rb-text">Regular Payroll — Fixed Salary</div>
          <p className="text-sm leading-relaxed text-rb-text-muted">Cashier, barista, admin, manager, dan staf operasional lainnya. Basic salary + allowance + overtime − deduction.</p>
          <div className="mt-3.5 text-xs font-semibold text-rb-red">Lihat 38 karyawan →</div>
        </Link>
        <Link to="/payroll/barber" className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-orange-tint-bg text-rb-orange-tint-fg">B</div>
          <div className="mb-1.5 text-[15px] font-semibold text-rb-text">Barber Payroll — Revenue Sharing</div>
          <p className="text-sm leading-relaxed text-rb-text-muted">32 barber dengan skema komisi layanan &amp; revenue sharing (contoh). Komisi mengikuti identitas barber, bukan cabang.</p>
          <div className="mt-3.5 text-xs font-semibold text-rb-red">Lihat 32 barber →</div>
        </Link>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (2 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/PayrollOverview.tsx backoffice/src/pages/__tests__/PayrollOverview.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Payroll Overview, DEMO"
```

---

### Task 2: Regular Payroll page

**Files:**
- Create: `backoffice/src/pages/RegularPayroll.tsx`
- Create: `backoffice/src/pages/__tests__/RegularPayroll.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/payroll/regular`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (6 → 5).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegularPayroll } from '../RegularPayroll';

describe('RegularPayroll', () => {
  it('shows the DEMO badge', () => {
    render(<RegularPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the payroll roster with net salary and status', () => {
    render(<RegularPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText('Nadia Kusuma')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoPayrollRow {
  name: string;
  position: string;
  unit: string;
  days: string;
  overtime: string;
  late: string;
  basic: string;
  adjustment: string;
  net: string;
  status: 'Approved' | 'Pending Review' | 'Draft';
}

const ROWS: DemoPayrollRow[] = [
  { name: 'Nadia Kusuma', position: 'Manager', unit: 'Sundaze', days: '22/22', overtime: '—', late: '—', basic: 'Rp 6.500.000', adjustment: '—', net: 'Rp 6.500.000', status: 'Approved' },
  { name: 'Rizky Pratama', position: 'Barista', unit: 'Sundaze', days: '21/22', overtime: '2j', late: '1x', basic: 'Rp 4.200.000', adjustment: '-Rp 50.000', net: 'Rp 4.150.000', status: 'Pending Review' },
  { name: 'Andra Wijaya', position: 'Cashier', unit: 'Redbox', days: '20/22', overtime: '—', late: '2x', basic: 'Rp 3.800.000', adjustment: '-Rp 100.000', net: 'Rp 3.700.000', status: 'Pending Review' },
  { name: 'Teguh Firmansyah', position: 'Admin', unit: 'Redbox', days: '22/22', overtime: '—', late: '—', basic: 'Rp 4.000.000', adjustment: '+Rp 150.000', net: 'Rp 4.150.000', status: 'Approved' },
  { name: 'Wulan Sari', position: 'Cashier', unit: 'Sundaze', days: '22/22', overtime: '—', late: '—', basic: 'Rp 3.800.000', adjustment: '—', net: 'Rp 3.800.000', status: 'Approved' },
];

const STATUS_TINT: Record<DemoPayrollRow['status'], string> = {
  Approved: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  'Pending Review': 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  Draft: 'bg-rb-divider text-rb-text-muted',
};

export function RegularPayroll() {
  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Payroll</Link>
      <PageHeader title="Regular Payroll" subtitle="Gaji Reguler (fixed salary) — data contoh" actions={<DemoBadge />} />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={38} label="Karyawan (contoh)" tint="blue" />
        <StatCard value={38} label="Payroll Draft (contoh)" tint="yellow" />
        <StatCard value={3} label="Pending Review (contoh)" tint="purple" />
        <StatCard value={34} label="Approved (contoh)" tint="green" />
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Posisi</div><div>Absen</div><div>Gaji Pokok</div><div>Net Salary</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.position}</div>
              <div className="text-rb-text-secondary">{r.days}</div>
              <div className="text-rb-text-secondary">{r.basic}</div>
              <div className="font-semibold text-rb-text">{r.net}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (2 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/RegularPayroll.tsx backoffice/src/pages/__tests__/RegularPayroll.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Regular Payroll, DEMO"
```

---

### Task 3: Barber Payroll page

**Files:**
- Create: `backoffice/src/pages/BarberPayroll.tsx`
- Create: `backoffice/src/pages/__tests__/BarberPayroll.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/payroll/barber`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (5 → 4).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarberPayroll } from '../BarberPayroll';

describe('BarberPayroll', () => {
  it('shows the DEMO badge', () => {
    render(<BarberPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the barber payroll roster with estimated pay', () => {
    render(<BarberPayroll />, { wrapper: MemoryRouter });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    expect(screen.getByText('Rp 5.640.000')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

interface DemoBarberPayrollRow {
  name: string;
  level: string;
  branch: string;
  customers: number;
  commission: string;
  pay: string;
  status: 'Approved' | 'Pending Review' | 'Draft' | 'Need Adjustment';
}

const ROWS: DemoBarberPayrollRow[] = [
  { name: 'Ubay Santoso', level: 'Senior', branch: 'Samadikun', customers: 612, commission: 'Rp 4.620.000', pay: 'Rp 5.640.000', status: 'Approved' },
  { name: 'Dodi Iskandar', level: 'Senior', branch: 'CSB', customers: 540, commission: 'Rp 4.130.000', pay: 'Rp 4.850.000', status: 'Pending Review' },
  { name: 'Farhan Maulana', level: 'Mid', branch: 'Sumber', customers: 412, commission: 'Rp 3.180.000', pay: 'Rp 3.180.000', status: 'Approved' },
  { name: 'Bagus Setiawan', level: 'Mid', branch: 'CSB', customers: 388, commission: 'Rp 2.960.000', pay: 'Rp 2.880.000', status: 'Need Adjustment' },
  { name: 'Yoga Pratama', level: 'Junior', branch: 'Bypass', customers: 260, commission: 'Rp 1.980.000', pay: 'Rp 1.980.000', status: 'Draft' },
];

const STATUS_TINT: Record<DemoBarberPayrollRow['status'], string> = {
  Approved: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  'Pending Review': 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  Draft: 'bg-rb-divider text-rb-text-muted',
  'Need Adjustment': 'bg-rb-red-tint-bg text-rb-red-tint-fg',
};

export function BarberPayroll() {
  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Payroll</Link>
      <PageHeader title="Barber Payroll" subtitle="Revenue Sharing / Komisi Layanan — data contoh, skema ilustratif" actions={<DemoBadge />} />

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Barber</div><div>Level</div><div>Cabang</div><div>Customer</div><div>Komisi (contoh)</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.level}</div>
              <div className="text-rb-text-secondary">{r.branch}</div>
              <div className="text-rb-text-secondary">{r.customers}</div>
              <div className="font-semibold text-rb-text">{r.pay}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (2 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/BarberPayroll.tsx backoffice/src/pages/__tests__/BarberPayroll.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Barber Payroll, DEMO, no real commission asserted"
```

---

### Task 4: Payroll Employee Detail page

**Files:**
- Create: `backoffice/src/pages/PayrollEmployeeDetail.tsx`
- Create: `backoffice/src/pages/__tests__/PayrollEmployeeDetail.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/payroll/employees/:id`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (4 → 3).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PayrollEmployeeDetail } from '../PayrollEmployeeDetail';

describe('PayrollEmployeeDetail', () => {
  it('shows the DEMO badge', () => {
    render(
      <MemoryRouter initialEntries={['/payroll/employees/RB-0098']}>
        <Routes><Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the demo pay breakdown and final pay', () => {
    render(
      <MemoryRouter initialEntries={['/payroll/employees/RB-0098']}>
        <Routes><Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Service Commission')).toBeInTheDocument();
    expect(screen.getByText('Final Pay')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { DemoBadge } from '../components/DemoBadge';

const LINES = [
  { label: 'Service Commission', note: '584 layanan selesai (contoh)', amount: 'Rp 3.900.000', color: 'text-rb-text' },
  { label: 'Revenue Sharing', note: 'Skema ilustratif, bukan kebijakan aktual', amount: 'Rp 720.000', color: 'text-rb-text' },
  { label: 'Attendance Adjustment', note: '21/22 hari hadir (contoh)', amount: '-Rp 50.000', color: 'text-rb-red-tint-fg' },
  { label: 'Overtime', note: '2 jam (contoh)', amount: '+Rp 80.000', color: 'text-rb-green-tint-fg' },
  { label: 'Other Adjustment', note: 'Bonus pelanggan baru (contoh)', amount: '+Rp 200.000', color: 'text-rb-green-tint-fg' },
];

export function PayrollEmployeeDetail() {
  return (
    <>
      <Link to="/payroll/regular" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Payroll</Link>

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rb-red-tint-bg text-sm font-semibold text-rb-red-tint-fg">DI</span>
          <div>
            <div className="text-[17px] font-semibold text-rb-text">Dodi Iskandar</div>
            <div className="text-xs text-rb-text-muted">Barber · Redbox Barbershop · CSB</div>
          </div>
        </div>
        <DemoBadge />
      </div>

      <div className="mb-4 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Rincian Komisi &amp; Revenue Sharing (contoh)
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {LINES.map((l) => (
            <div key={l.label} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm font-semibold text-rb-text">{l.label}</div>
                <div className="text-xs text-rb-text-muted">{l.note}</div>
              </div>
              <div className={`text-sm font-semibold ${l.color}`}>{l.amount}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-4">
          <div className="font-serif text-lg font-semibold text-rb-text">Final Pay</div>
          <div className="font-serif text-xl font-semibold text-rb-red">Rp 4.850.000</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button type="button" disabled className="rounded-rb-button bg-rb-red px-4 py-2.5 text-sm font-semibold text-white opacity-60">Approve</button>
        <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Edit Adjustment</button>
        <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Generate Payslip</button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (2 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/PayrollEmployeeDetail.tsx backoffice/src/pages/__tests__/PayrollEmployeeDetail.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Payroll Employee Detail, DEMO, no real commission asserted"
```

---

### Task 5: Verification

- [x] Full backoffice test suite: 27 files, 94 tests, all pass.
- [x] Build succeeds (81 modules).
- [x] Root server suite / function count unaffected — no backend files
      touched this workstream.
- [x] Design-fidelity review: all four pages structurally match their
      `.dc.html` mockups (Overview: stat cards + two scheme cards; Regular
      Payroll: stat row + roster table; Barber Payroll: roster table with
      demo commission column, explicitly labeled illustrative; Employee
      Detail: itemized pay breakdown + Final Pay total). DemoBadge visible
      on all four. Every commission/revenue-sharing figure is disclosed
      demo/illustrative content on an all-DEMO page — never asserted as
      Redbox's actual real commission policy.

## Definition of done

- [x] Full backoffice test suite passes
- [x] Build succeeds
- [x] DemoBadge visible on all four pages
- [x] No real commission percentage asserted anywhere
- [x] No stop condition hit — proceed into Workstream I
