# Backoffice Workstream G — Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Attendance Overview, Fingerprint Import, and Exception Review
as honest DEMO/PARTIAL screens — `barber_attendance` has only 2 rows in
production (spec §5 row 5), not a real source; no upload/parser backend
exists for fingerprint import. All three use static mock data with
`DemoBadge` prominently shown.

**Architecture:** No service layer, no API calls, same pattern as
Workstream F. Exception Review's list/detail selection uses real local
React state (`useState`) — a genuine UI interaction, not a data claim — per
the design handoff's own note that this is local-state-only navigation.
Action buttons (Approve Penalty, Upload & Process, etc.) render for design
fidelity but have no handlers — this is a UI prototype, not claimed
production-ready (spec row 6).

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§5 rows 5–7, §8 workstream G)

## Global Constraints

- Every number is DEMO data — `DemoBadge` in every page header.
- No real employee PII beyond what's already synthetic in the `.dc.html`
  mockups' own sample data.
- No backend calls, no new service files.
- Action buttons with no real backend to call render inert (no `onClick`) —
  never fake a success/failure toast for an action that didn't happen.
- `npm --workspace=backoffice run build` / `test` succeed after every task.

---

### Task 1: Attendance Overview page

**Files:**
- Create: `backoffice/src/pages/AttendanceOverview.tsx`
- Create: `backoffice/src/pages/__tests__/AttendanceOverview.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/attendance`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (10 → 9).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendanceOverview } from '../AttendanceOverview';

describe('AttendanceOverview', () => {
  it('shows the DEMO badge', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the attendance roster with check-in/out and status', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    expect(screen.getByText('Dodi Iskandar')).toBeInTheDocument();
    expect(screen.getByText('Missing Check-out')).toBeInTheDocument();
  });

  it('links Exception Belum Selesai to Exception Review', () => {
    render(<AttendanceOverview />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Exception Belum Selesai/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoAttendanceRow {
  name: string;
  branch: string;
  checkin: string;
  checkout: string;
  duration: string;
  status: 'Tepat Waktu' | 'Terlambat' | 'Missing Check-out';
}

const ROWS: DemoAttendanceRow[] = [
  { name: 'Dodi Iskandar', branch: 'CSB', checkin: '08:58', checkout: '18:02', duration: '9j 4m', status: 'Tepat Waktu' },
  { name: 'Rizky Pratama', branch: 'Sundaze Bypass', checkin: '09:22', checkout: '17:45', duration: '8j 23m', status: 'Terlambat' },
  { name: 'Andra Wijaya', branch: 'Tegal', checkin: '09:05', checkout: '—', duration: '—', status: 'Missing Check-out' },
  { name: 'Farhan Maulana', branch: 'Sumber', checkin: '08:50', checkout: '17:55', duration: '9j 5m', status: 'Tepat Waktu' },
  { name: 'Nadia Kusuma', branch: 'Sundaze Bypass', checkin: '08:45', checkout: '18:10', duration: '9j 25m', status: 'Tepat Waktu' },
  { name: 'Bagus Setiawan', branch: 'CSB', checkin: '09:18', checkout: '17:40', duration: '8j 22m', status: 'Terlambat' },
];

const STATUS_TINT: Record<DemoAttendanceRow['status'], string> = {
  'Tepat Waktu': 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  Terlambat: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  'Missing Check-out': 'bg-rb-red-tint-bg text-rb-red-tint-fg',
};

export function AttendanceOverview() {
  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Data contoh — barber_attendance produksi baru memiliki 2 baris, belum representatif"
        actions={<DemoBadge />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={61} label="Hadir Tepat Waktu (contoh)" tint="green" />
        <StatCard value={6} label="Terlambat (contoh)" tint="orange" />
        <StatCard value={2} label="Absen (contoh)" tint="red" />
        <Link to="/attendance/exceptions" className="block no-underline">
          <StatCard value={3} label="Exception Belum Selesai →" tint="blue" />
        </Link>
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Cabang</div><div>Check-in</div><div>Check-out</div><div>Durasi</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.branch}</div>
              <div className="text-rb-text-secondary">{r.checkin}</div>
              <div className="text-rb-text-secondary">{r.checkout}</div>
              <div className="text-rb-text-secondary">{r.duration}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (`npm --workspace=backoffice run test -- AttendanceOverview.test.tsx`, 3 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/AttendanceOverview.tsx backoffice/src/pages/__tests__/AttendanceOverview.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Attendance Overview, DEMO"
```

---

### Task 2: Fingerprint Import page

**Files:**
- Create: `backoffice/src/pages/FingerprintImport.tsx`
- Create: `backoffice/src/pages/__tests__/FingerprintImport.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/attendance/import`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (9 → 8).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FingerprintImport } from '../FingerprintImport';

describe('FingerprintImport', () => {
  it('shows the DEMO badge', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('renders the last-import summary stats', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    expect(screen.getByText('Records Diimport')).toBeInTheDocument();
    expect(screen.getByText('312')).toBeInTheDocument();
  });

  it('links the Exceptions card to Exception Review', () => {
    render(<FingerprintImport />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: /Exceptions/i });
    expect(link.getAttribute('href')).toBe('/attendance/exceptions');
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

const LAST_IMPORT = [
  { value: '312', label: 'Records Diimport', tint: 'bg-rb-green-tint-bg' },
  { value: '18', label: 'Karyawan Cocok', tint: 'bg-rb-blue-tint-bg' },
  { value: '9', label: 'Record Terlambat', tint: 'bg-rb-orange-tint-bg' },
  { value: '2', label: 'Missing Check-in', tint: 'bg-rb-red-tint-bg' },
  { value: '1', label: 'Missing Check-out', tint: 'bg-rb-red-tint-bg' },
];

export function FingerprintImport() {
  return (
    <>
      <Link to="/attendance" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Attendance</Link>
      <PageHeader
        title="Import Fingerprint"
        subtitle="Unggah data mesin fingerprint untuk diproses menjadi attendance"
        actions={<DemoBadge />}
      />

      <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Cabang</div>
            <select disabled className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text">
              <option>Sundaze Coffee Shop</option>
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Periode</div>
            <select disabled className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text">
              <option>Agustus 2026</option>
            </select>
          </div>
        </div>
        <div className="rounded-2xl border border-dashed border-rb-border bg-rb-bg px-8 py-10 text-center">
          <div className="mb-1 text-sm font-semibold text-rb-text">Drag &amp; drop file XLS/XLSX di sini</div>
          <div className="mb-3.5 text-xs text-rb-text-muted">atau klik untuk memilih file dari komputer</div>
          <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-sm font-semibold text-rb-text-secondary">
            Pilih File
          </button>
        </div>
        <button type="button" disabled className="mt-4 w-full rounded-rb-button bg-rb-red px-4 py-3 text-sm font-semibold text-white opacity-60">
          Upload &amp; Process
        </button>
      </div>

      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Hasil Import Terakhir (contoh)</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {LAST_IMPORT.map((s) => (
          <div key={s.label} className={`rounded-2xl px-4 py-3.5 ${s.tint}`}>
            <div className="font-serif text-xl font-semibold text-rb-text">{s.value}</div>
            <div className="text-xs font-semibold text-rb-text-secondary">{s.label}</div>
          </div>
        ))}
        <Link to="/attendance/exceptions" className="block rounded-2xl bg-rb-purple-tint-bg px-4 py-3.5 no-underline">
          <div className="font-serif text-xl font-semibold text-rb-text">3</div>
          <div className="text-xs font-semibold text-rb-purple-tint-fg">Exceptions →</div>
        </Link>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (3 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/FingerprintImport.tsx backoffice/src/pages/__tests__/FingerprintImport.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Fingerprint Import, DEMO UI prototype only"
```

---

### Task 3: Exception Review page

**Files:**
- Create: `backoffice/src/pages/ExceptionReview.tsx`
- Create: `backoffice/src/pages/__tests__/ExceptionReview.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/attendance/exceptions`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (8 → 7).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExceptionReview } from '../ExceptionReview';

describe('ExceptionReview', () => {
  it('shows the DEMO badge', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
  });

  it('selects the first exception by default', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    expect(screen.getByText('Terlambat 22 menit')).toBeInTheDocument();
  });

  it('switches the detail panel when another exception is clicked', () => {
    render(<ExceptionReview />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByText('Andra Wijaya'));
    expect(screen.getByText('Missing check-out')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

interface DemoException {
  id: string;
  initials: string;
  name: string;
  role: string;
  branch: string;
  detected: string;
  date: string;
}

const EXCEPTIONS: DemoException[] = [
  { id: 'e1', initials: 'R', name: 'Rizky Pratama', role: 'Barista', branch: 'Sundaze Coffee Shop', detected: 'Terlambat 22 menit', date: '28 Agustus 2026' },
  { id: 'e2', initials: 'A', name: 'Andra Wijaya', role: 'Cashier', branch: 'Tegal', detected: 'Missing check-out', date: '28 Agustus 2026' },
  { id: 'e3', initials: 'B', name: 'Bagus Setiawan', role: 'Barber', branch: 'CSB', detected: 'Terlambat 15 menit', date: '27 Agustus 2026' },
];

export function ExceptionReview() {
  const [selectedId, setSelectedId] = useState(EXCEPTIONS[0].id);
  const selected = EXCEPTIONS.find((e) => e.id === selectedId) ?? EXCEPTIONS[0];

  return (
    <>
      <Link to="/attendance" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Attendance</Link>
      <PageHeader title="Exception Review" actions={<DemoBadge />} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.5fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            {EXCEPTIONS.length} Exception Menunggu (contoh)
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {EXCEPTIONS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => setSelectedId(ex.id)}
                className={`flex items-center gap-3 px-4 py-3.5 text-left ${ex.id === selectedId ? 'bg-rb-bg' : 'bg-rb-surface'}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-orange-tint-bg text-xs font-semibold text-rb-orange-tint-fg">{ex.initials}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-rb-text">{ex.name}</div>
                  <div className="truncate text-xs text-rb-text-muted">{ex.detected}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rb-orange-tint-bg text-sm font-semibold text-rb-orange-tint-fg">{selected.initials}</span>
            <div>
              <div className="font-semibold text-rb-text">{selected.name}</div>
              <div className="text-xs text-rb-text-muted">{selected.branch} · {selected.role}</div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3.5">
            <div className="rounded-xl bg-rb-bg px-4 py-3.5">
              <div className="mb-1 text-[11px] font-semibold text-rb-text-muted">Tanggal</div>
              <div className="text-sm font-semibold text-rb-text">{selected.date}</div>
            </div>
            <div className="rounded-xl bg-rb-orange-tint-bg px-4 py-3.5">
              <div className="mb-1 text-[11px] font-semibold text-rb-text-muted">Terdeteksi</div>
              <div className="text-sm font-semibold text-rb-orange-tint-fg">{selected.detected}</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Alasan</div>
            <input disabled placeholder="— belum diisi —" className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text-muted" />
          </div>

          <div className="my-4.5 h-px bg-rb-divider" />

          <div className="mb-2.5 text-xs font-semibold text-rb-text-muted">Tindakan</div>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled className="rounded-rb-button bg-rb-red px-4 py-2.5 text-sm font-semibold text-white opacity-60">Approve Penalty</button>
            <button type="button" disabled className="rounded-rb-button bg-rb-green-tint-bg px-4 py-2.5 text-sm font-semibold text-rb-green-tint-fg opacity-60">Approve Exception</button>
            <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Edit Record</button>
            <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Add Note</button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (3 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/ExceptionReview.tsx backoffice/src/pages/__tests__/ExceptionReview.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Exception Review, DEMO with real local list/detail selection"
```

---

### Task 4: Verification

- [x] Full backoffice test suite: 23 files, 87 tests, all pass.
- [x] Build succeeds (77 modules).
- [x] Root server suite / function count unaffected — no backend files
      touched this workstream.
- [x] Design-fidelity review: all three pages structurally match their
      `.dc.html` mockups (Overview: header actions + 4 stat cards + roster
      table; Fingerprint Import: filters + dropzone + last-import stat
      grid, all inert per "UI prototype only"; Exception Review: real
      list/detail local-state selection, action buttons rendered inert).
      DemoBadge visible on all three. Action buttons throughout render
      disabled/inert rather than fake-succeeding — no false confirmations.

## Definition of done

- [x] Full backoffice test suite passes
- [x] Build succeeds
- [x] DemoBadge visible on all three pages
- [x] No functional-looking-but-fake action confirmations anywhere
- [x] No stop condition hit — proceed into Workstream H
