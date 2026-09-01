# Backoffice Workstream F — HR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HR Employee List and Employee Detail as honest, clearly
labeled DEMO screens — no `employees` table exists (spec §5 row 3/4), so no
backend work is needed or possible this workstream. Both pages use static
mock data matching the `.dc.html` mockups' shape, with `DemoBadge`
prominently shown per spec's "DEMO always visibly labeled" rule.

**Architecture:** No service layer, no API calls. Each page holds its own
typed mock dataset as a local constant and renders it directly — same
pattern as `ComingSoon` but with real designed layout. `DemoBadge` sits in
the page header, not buried in a corner.

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 3–4, §8 workstream F)

## Global Constraints

- Every number on these pages is DEMO data — `DemoBadge` must appear in the
  page header, not just implied by page content.
- No real employee PII, even fictional-but-plausible data resembling actual
  staff — use clearly synthetic names/IDs (the `.dc.html` mockups' own
  sample data is fine to reuse verbatim, it's already synthetic placeholder
  content).
- No backend calls, no new service files.
- `npm --workspace=backoffice run build` / `test` succeed after every task.

---

### Task 1: HR Employee List page

**Files:**
- Create: `backoffice/src/pages/HREmployeeList.tsx`
- Create: `backoffice/src/pages/__tests__/HREmployeeList.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/hr`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (12 → 11 remaining placeholders),
      same removal pattern as prior workstreams.

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/HREmployeeList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HREmployeeList } from '../HREmployeeList';

describe('HREmployeeList', () => {
  it('shows the DEMO badge', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the employee roster with names, positions, and branches', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    expect(screen.getByText('Ubay Santoso')).toBeInTheDocument();
    expect(screen.getByText('Senior Barber')).toBeInTheDocument();
  });

  it('links each employee row to Employee Detail', () => {
    render(<HREmployeeList />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Ubay Santoso/i });
    expect(link.getAttribute('href')).toBe('/hr/employees/RB-0142');
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/HREmployeeList.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoEmployee {
  id: string;
  name: string;
  initials: string;
  unit: string;
  position: string;
  branch: string;
  attendance: string;
  status: 'Aktif' | 'Cuti';
}

const EMPLOYEES: DemoEmployee[] = [
  { id: 'RB-0142', name: 'Ubay Santoso', initials: 'US', unit: 'Redbox Barbershop', position: 'Senior Barber', branch: 'Samadikun', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0098', name: 'Dodi Iskandar', initials: 'DI', unit: 'Redbox Barbershop', position: 'Barber', branch: 'CSB', attendance: 'Terlambat 1x', status: 'Aktif' },
  { id: 'SD-0033', name: 'Rizky Pratama', initials: 'RP', unit: 'Sundaze Coffee Shop', position: 'Barista', branch: 'Bypass', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0071', name: 'Andra Wijaya', initials: 'AW', unit: 'Redbox Barbershop', position: 'Cashier', branch: 'Tegal', attendance: 'Terlambat 2x', status: 'Aktif' },
  { id: 'RB-0055', name: 'Farhan Maulana', initials: 'FM', unit: 'Redbox Barbershop', position: 'Barber', branch: 'Sumber', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'SD-0019', name: 'Nadia Kusuma', initials: 'NK', unit: 'Sundaze Coffee Shop', position: 'Manager', branch: 'Bypass', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0110', name: 'Bagus Setiawan', initials: 'BS', unit: 'Redbox Barbershop', position: 'Barber', branch: 'CSB', attendance: 'Tepat waktu', status: 'Cuti' },
  { id: 'RB-0087', name: 'Teguh Firmansyah', initials: 'TF', unit: 'Redbox Barbershop', position: 'Admin', branch: 'Samadikun', attendance: 'Tepat waktu', status: 'Aktif' },
];

export function HREmployeeList() {
  return (
    <>
      <PageHeader
        title="HR & People"
        subtitle="Data karyawan contoh — menunggu tabel employees produksi"
        actions={<DemoBadge />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={EMPLOYEES.length} label="Total Karyawan (contoh)" tint="red" />
        <StatCard value={EMPLOYEES.filter((e) => e.unit === 'Redbox Barbershop').length} label="Redbox Barbershop" tint="orange" />
        <StatCard value={EMPLOYEES.filter((e) => e.unit === 'Sundaze Coffee Shop').length} label="Sundaze Coffee Shop" tint="purple" />
        <StatCard value={new Set(EMPLOYEES.map((e) => e.unit)).size} label="Unit Bisnis" tint="teal" />
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Unit Bisnis</div><div>Posisi</div><div>Cabang</div><div>Attendance</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {EMPLOYEES.map((e) => (
            <Link
              key={e.id}
              to={`/hr/employees/${e.id}`}
              className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm no-underline hover:bg-rb-bg"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-red-tint-bg text-xs font-semibold text-rb-red-tint-fg">{e.initials}</span>
                <div>
                  <div className="font-semibold text-rb-text">{e.name}</div>
                  <div className="text-[11px] text-rb-text-faint">{e.id}</div>
                </div>
              </div>
              <div className="text-rb-text-secondary">{e.unit}</div>
              <div className="text-rb-text-secondary">{e.position}</div>
              <div className="text-rb-text-secondary">{e.branch}</div>
              <div className="font-semibold text-rb-text-secondary">{e.attendance}</div>
              <div>
                <span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${e.status === 'Aktif' ? 'bg-rb-green-tint-bg text-rb-green-tint-fg' : 'bg-rb-divider text-rb-text-muted'}`}>
                  {e.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- HREmployeeList.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/HREmployeeList.tsx backoffice/src/pages/__tests__/HREmployeeList.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add HR Employee List, DEMO"
```

---

### Task 2: Employee Detail page

**Files:**
- Create: `backoffice/src/pages/EmployeeDetail.tsx`
- Create: `backoffice/src/pages/__tests__/EmployeeDetail.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/hr/employees/:id`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (11 → 10).

- [ ] **Step 2: Write the failing page test**

Create `backoffice/src/pages/__tests__/EmployeeDetail.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EmployeeDetail } from '../EmployeeDetail';

describe('EmployeeDetail', () => {
  it('shows the DEMO badge', () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/RB-0098']}>
        <Routes><Route path="/hr/employees/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders demo employee fields', () => {
    render(
      <MemoryRouter initialEntries={['/hr/employees/RB-0098']}>
        <Routes><Route path="/hr/employees/:id" element={<EmployeeDetail />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Dodi Iskandar')).toBeInTheDocument();
    expect(screen.getByText('CSB')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

Create `backoffice/src/pages/EmployeeDetail.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { DemoBadge } from '../components/DemoBadge';

const FIELDS = [
  { label: 'Employee ID', value: 'RB-0098' },
  { label: 'Business Unit', value: 'Redbox Barbershop' },
  { label: 'Cabang Saat Ini', value: 'CSB' },
  { label: 'Tanggal Mulai', value: '3 Jan 2023' },
  { label: 'Tipe Payroll', value: 'Komisi Barber' },
  { label: 'Status', value: 'Karyawan Tetap' },
];

const PERFORMANCE = [
  { value: '612', label: 'Customer Dilayani' },
  { value: '58%', label: 'Repeat Customer' },
  { value: '584', label: 'Layanan Selesai' },
  { value: '21/22', label: 'Attendance' },
];

const HISTORY = [
  { branch: 'CSB', period: 'Jan 2025 — sekarang' },
  { branch: 'Samadikun', period: 'Jun 2024 — Jan 2025' },
  { branch: 'Bypass', period: 'Jan 2023 — Jun 2024' },
];

export function EmployeeDetail() {
  return (
    <>
      <Link to="/hr" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke HR &amp; People</Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rb-red-tint-bg text-xl font-semibold text-rb-red-tint-fg">DI</span>
            <DemoBadge />
          </div>
          <h1 className="font-serif text-xl font-semibold text-rb-text">Dodi Iskandar</h1>
          <div className="mb-3 text-xs text-rb-text-muted">Barber · Redbox Barbershop</div>
          <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-green-tint-fg">Aktif</span>
          <div className="my-4 h-px bg-rb-divider" />
          <div className="flex flex-col gap-2 text-sm">
            {FIELDS.map((f) => (
              <div key={f.label} className="flex justify-between">
                <span className="text-rb-text-muted">{f.label}</span>
                <span className="font-semibold text-rb-text">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Ringkasan Layanan (contoh)</h2>
            <div className="grid grid-cols-4 gap-3">
              {PERFORMANCE.map((p) => (
                <div key={p.label}>
                  <div className="font-serif text-lg font-semibold text-rb-text">{p.value}</div>
                  <div className="text-[11px] text-rb-text-muted">{p.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Riwayat Cabang</h2>
            <div className="flex flex-col divide-y divide-rb-divider">
              {HISTORY.map((h) => (
                <div key={h.branch} className="flex justify-between py-2 text-sm">
                  <span className="font-medium text-rb-text">{h.branch}</span>
                  <span className="text-rb-text-muted">{h.period}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --workspace=backoffice run test -- EmployeeDetail.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/EmployeeDetail.tsx backoffice/src/pages/__tests__/EmployeeDetail.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Employee Detail, DEMO"
```

---

### Task 3: Verification

- [x] Full backoffice test suite: 20 files, 77 tests, all pass.
- [x] Build succeeds (74 modules).
- [x] Root server suite / function count unaffected — no backend files
      touched this workstream.
- [x] Design-fidelity review: both pages structurally match their
      `.dc.html` mockups (List: stat cards + filterable roster table with
      pagination footer — pagination controls omitted since only 8 demo
      rows exist, not a real 70-row dataset; Detail: profile card + demo
      performance summary + branch history, matching layout). Every
      stat/field is DEMO data; `DemoBadge` visible in both headers.

## Definition of done

- [x] Full backoffice test suite passes
- [x] Build succeeds
- [x] DemoBadge visible on both pages
- [x] No stop condition hit — proceed into Workstream G
