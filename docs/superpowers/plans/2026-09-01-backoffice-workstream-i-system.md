# Backoffice Workstream I — System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Roles & Permissions and Package Feature Access — the final
two screens of the 23-screen scope. Roles & Permissions shows a **target**
RBAC architecture, explicitly labeled DEMO/PARTIAL (spec §4: `users.role`
has no `manager`/`admin` split today — only `owner`/`branch_admin`/`barber`).
Package Feature Access is different from every other DEMO screen in this
build: its content (Full Feature Review Mode is the real current state; the
commercial package plan is real but explicitly unenforced) is **accurate**,
not fabricated — spec classifies it "DEMO by design" because it's a
product-planning artifact, not because its facts are fictional.

**Architecture:** Same static-mock-data pattern as F/G/H for Roles &
Permissions (no service layer). Package Feature Access renders accurate,
already-established facts (Full Feature Review Mode, the future package
plan) as local constants — not business metrics needing a data source.

**Tech Stack:** No new libraries.

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§4, §5 rows 22–23, §6 Full Feature Review Mode, §8 workstream I)

## Global Constraints

- Roles & Permissions: `DemoBadge`/target-architecture note — never claims
  the matrix is enforced server-side (spec §4: "client-side visibility is
  never represented as server-side authorization anywhere in the product").
- Package Feature Access: content must stay factually accurate to §6 (Full
  Feature Review Mode is real, current, and correctly described) — this
  page does NOT get fabricated numbers, it gets an honest "this is a
  planning artifact" framing instead.
- No backend calls, no new service files.
- `npm --workspace=backoffice run build` / `test` succeed after every task.

---

### Task 1: Roles & Permissions page

**Files:**
- Create: `backoffice/src/pages/RolesPermissions.tsx`
- Create: `backoffice/src/pages/__tests__/RolesPermissions.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/system/roles`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (3 → 2).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RolesPermissions } from '../RolesPermissions';

describe('RolesPermissions', () => {
  it('shows the DEMO badge and a target-architecture disclosure', () => {
    render(<RolesPermissions />);
    expect(screen.getByText(/DEMO/i)).toBeInTheDocument();
    expect(screen.getByText(/belum diterapkan di backend/i)).toBeInTheDocument();
  });

  it('renders the role cards and the module access matrix', () => {
    render(<RolesPermissions />);
    expect(screen.getByText('Owner / Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

const ROLES = [
  { name: 'Owner / Super Admin', count: 1 },
  { name: 'Manager', count: 3 },
  { name: 'Branch Admin', count: 5 },
  { name: 'HR / Payroll', count: 2 },
];

const COLUMNS = ['Owner', 'Manager', 'Branch Admin', 'HR / Payroll'];

const MATRIX: { name: string; access: boolean[] }[] = [
  { name: 'Command Center', access: [true, true, true, false] },
  { name: 'HR & People', access: [true, true, false, true] },
  { name: 'Attendance', access: [true, true, true, true] },
  { name: 'Regular Payroll', access: [true, false, false, true] },
  { name: 'Barber Payroll', access: [true, true, false, true] },
  { name: 'Operations', access: [true, true, true, false] },
  { name: 'CRM & Customer', access: [true, true, false, false] },
  { name: 'Membership', access: [true, true, false, false] },
  { name: 'Stockist & Inventory', access: [true, true, true, false] },
  { name: 'Moka Integration', access: [true, false, false, false] },
  { name: 'Reports', access: [true, true, false, false] },
  { name: 'System', access: [true, false, false, false] },
];

export function RolesPermissions() {
  return (
    <>
      <PageHeader
        title="Peran & Izin"
        subtitle="Kelola apa yang bisa dilihat dan dilakukan setiap role di Backoffice"
        actions={<DemoBadge />}
      />
      <p className="mb-6 max-w-2xl text-sm text-rb-text-muted">
        Ini adalah rancangan arsitektur target — <code>users.role</code> produksi saat ini hanya
        memiliki <code>owner</code>/<code>branch_admin</code>/<code>barber</code>, belum ada split
        Manager/HR-Payroll. Matriks ini belum diterapkan di backend sebagai otorisasi nyata; tampilan
        di Backoffice tidak pernah menjadi pengganti otorisasi server-side.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.name} className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
            <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">{r.name}</div>
            <div className="text-xs text-rb-text-muted">{r.count} pengguna (contoh)</div>
          </div>
        ))}
      </div>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid gap-2 border-b border-rb-divider px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted" style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}>
          <div>Modul</div>
          {COLUMNS.map((c) => <div key={c} className="text-center">{c}</div>)}
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {MATRIX.map((m) => (
            <div key={m.name} className="grid items-center gap-2 px-4 py-3 text-sm" style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}>
              <div className="font-semibold text-rb-text">{m.name}</div>
              {m.access.map((granted, i) => (
                <div key={i} className="text-center">
                  {granted ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rb-green-tint-bg text-xs text-rb-green-tint-fg">✓</span>
                  ) : (
                    <span className="text-rb-text-faint">—</span>
                  )}
                </div>
              ))}
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
git add backoffice/src/pages/RolesPermissions.tsx backoffice/src/pages/__tests__/RolesPermissions.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Roles & Permissions, target architecture, DEMO/PARTIAL"
```

---

### Task 2: Package Feature Access page

**Files:**
- Create: `backoffice/src/pages/PackageFeatureAccess.tsx`
- Create: `backoffice/src/pages/__tests__/PackageFeatureAccess.test.tsx`
- Modify: `backoffice/src/routes.ts` (remove `/system/packages`)
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/__tests__/routes.test.ts`

- [ ] **Step 1: Update route table** (2 → 1; only `/system/settings`
      remains, which per spec stays a placeholder forever — it's not one
      of the 23 designed screens).

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageFeatureAccess } from '../PackageFeatureAccess';

describe('PackageFeatureAccess', () => {
  it('accurately describes Full Feature Review Mode as the real current state', () => {
    render(<PackageFeatureAccess />);
    expect(screen.getByText('Full Feature Review Mode')).toBeInTheDocument();
    expect(screen.getByText(/Semua modul dibuka sementara/i)).toBeInTheDocument();
  });

  it('discloses the commercial package plan as not yet enforced', () => {
    render(<PackageFeatureAccess />);
    expect(screen.getByText(/belum diberlakukan/i)).toBeInTheDocument();
    expect(screen.getByText('Redbox Business Suite')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then implement.

```tsx
import { PageHeader } from '../components/PageHeader';

const FREE_FEATURES = ['HR & People', 'Attendance', 'Regular Payroll'];
const BUSINESS_SUITE_FEATURES = [
  'Barber Commission Payroll', 'Operations', 'CRM & Customer',
  'Membership', 'Stockist Analytics', 'Moka Integration', 'Reports',
];

export function PackageFeatureAccess() {
  return (
    <>
      <PageHeader title="Akses Paket" subtitle="Mode prototipe saat ini vs. rencana paket komersial di masa depan" />

      <div className="mb-6 flex items-center justify-between rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rb-orange-tint-fg" />
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">Mode Prototipe Saat Ini</div>
            <div className="font-serif text-xl font-semibold text-rb-text">Full Feature Review Mode</div>
            <div className="mt-1 text-xs text-rb-text-muted">Semua modul dibuka sementara agar Owner bisa menjelajah seluruh sistem sebelum development.</div>
          </div>
        </div>
        <span className="whitespace-nowrap rounded-rb-pill bg-rb-orange-tint-bg px-3.5 py-1.5 text-xs font-semibold text-rb-orange-tint-fg">Semua Fitur: Aktif</span>
      </div>

      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Rencana Paket Komersial (belum diberlakukan)</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rb-green-tint-fg" />
            <h3 className="font-serif text-base font-semibold text-rb-text">Redbox Free</h3>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {FREE_FEATURES.map((f) => (
              <div key={f} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium text-rb-text">{f}</span>
                <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">Aktif sekarang</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rb-purple-tint-fg" />
            <h3 className="font-serif text-base font-semibold text-rb-text">Redbox Business Suite</h3>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {BUSINESS_SUITE_FEATURES.map((f) => (
              <div key={f} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium text-rb-text">{f}</span>
                <span className="rounded-rb-pill bg-rb-orange-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-orange-tint-fg">Dibuka untuk review</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4.5 text-xs leading-relaxed text-rb-text-faint">
        Setelah keputusan paket final, sistem entitlement ini akan mengunci kembali modul Business Suite sampai diaktifkan lewat upgrade atau add-on.
      </p>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes** (2 tests).
- [ ] **Step 5: Wire the route, commit.**

```bash
git add backoffice/src/pages/PackageFeatureAccess.tsx backoffice/src/pages/__tests__/PackageFeatureAccess.test.tsx backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/__tests__/routes.test.ts
git commit -m "feat(backoffice): add Package Feature Access, accurate current-state description"
```

---

### Task 3: Full-product verification

- [ ] Run full backoffice test suite; expect all pass.
- [ ] Build; expect success.
- [ ] Run the full root server suite regression check; expect the same 24
      pre-existing/unrelated failures.
- [ ] Verify `vercel.json`'s `functions` map still has exactly 12 entries.
- [ ] Design-fidelity review against both `.dc.html` files; commit review
      notes.
- [ ] Confirm `PLACEHOLDER_ROUTES` now contains exactly 1 entry
      (`/system/settings`) — every one of the 23 designed screens has a
      real page.

## Definition of done for this workstream

- [ ] Full backoffice test suite passes
- [ ] Build succeeds
- [ ] Root server suite shows only the same 24 pre-existing/unrelated failures
- [ ] Serverless function count unchanged at 12
- [ ] Roles & Permissions never claims real server-side enforcement
- [ ] Package Feature Access content is factually accurate, not fabricated
- [ ] All 23 designed screens now have real pages — this is the final
      workstream; proceed to the Master Completion Report per standing
      instruction
