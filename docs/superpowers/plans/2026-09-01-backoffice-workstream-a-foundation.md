# Backoffice Workstream A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Backoffice `backoffice/` workspace a working test runner and a
single, tested source of truth for its route table (fixing two route-naming
issues carried over from Phase 1A) — the two things every later workstream
(B–I) depends on.

**Architecture:** Add Vitest + React Testing Library to the existing Vite
workspace (no new build tool, matches the ecosystem already in use). Extract
the inline placeholder-route array in `App.tsx` into its own `routes.ts` module
so it's unit-testable without rendering the full app/auth stack, and fix its
two path names to match the spec's final route map.

**Tech Stack:** Vitest, @testing-library/react, @testing-library/jest-dom,
jsdom, TypeScript, React Router (all added to the existing `backoffice/`
Vite/React/TS workspace — no changes to `server/`, `vercel.json`, or any other
workspace).

**Spec:** `docs/superpowers/specs/2026-08-31-redbox-backoffice-command-center-design.md`
(§7 route map, §8 workstream A scope, §9 component/file layout, §14 production
safety checklist)

## Global Constraints

- Serverless function count must stay at exactly 12 — this workstream touches
  only `backoffice/` files, never `vercel.json`, `api/`, or `server/index.js`.
- No changes to `frontend/`, `admin.redboxbarbershop.com`,
  `stockist.redboxbarbershop.com`, `public/crm.html`, `public/admin-moka.html`.
- `TEMPORARY COMPATIBILITY AUTH` (spec §4) is not modified — `apiClient.ts`,
  `AuthProvider.tsx` behavior stays identical; this workstream only adds test
  coverage for existing `apiClient.ts` behavior and fixes route paths.
- Every screen is its own route — never collapsed into a shared multi-tab page
  (spec §7).
- `npm --workspace=backoffice run build` must succeed after every task.

---

### Task 1: Add Vitest test infrastructure + characterization tests for `apiClient.ts`

**Files:**
- Modify: `backoffice/package.json` (add `devDependencies`, add `"test"` script)
- Modify: `backoffice/vite.config.ts` (add `test` config block)
- Create: `backoffice/src/test/setup.ts`
- Create: `backoffice/src/lib/__tests__/apiClient.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `getStoredToken`, `storeToken`, `clearToken`,
  `onUnauthorized`, `ApiError` — all already exported from
  `backoffice/src/lib/apiClient.ts` (Phase 1A, unchanged by this task).
- Produces: a working `npm --workspace=backoffice run test` command that every
  later task in every workstream runs before committing.

- [ ] **Step 1: Add test dependencies and scripts**

Edit `backoffice/package.json` — add to `devDependencies` (alongside the
existing entries, alphabetical order preserved) and add a `test` script:

```json
{
  "name": "backoffice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-router-dom": "^7.9.6"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.15",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.2.4",
    "@types/react-dom": "^19.2.4",
    "@vitejs/plugin-react": "^4.4.1",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.1.15",
    "typescript": "^5.7.3",
    "vite": "^7.1.5",
    "vitest": "^3.0.5"
  }
}
```

Run: `npm install` (from repo root — this is an npm workspaces monorepo, always
run `npm install` from the root, never inside `backoffice/`)

Expected: install succeeds, no errors.

- [ ] **Step 2: Add the Vitest config block**

Edit `backoffice/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3: Add the test setup file**

Create `backoffice/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Write characterization tests for the existing `apiClient`**

Create `backoffice/src/lib/__tests__/apiClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiClient,
  storeToken,
  clearToken,
  onUnauthorized,
  ApiError,
} from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it('attaches the x-admin-token header when a token is stored', async () => {
    storeToken('secret-token');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Headers).get('x-admin-token')).toBe('secret-token');
  });

  it('does not attach the x-admin-token header when no token is stored', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await apiClient.get('/api/test');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Headers).has('x-admin-token')).toBe(false);
  });

  it('notifies onUnauthorized listeners and throws ApiError on a 401 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 401 })
    );
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    await expect(apiClient.get('/api/test')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('throws ApiError carrying the response status for other non-ok responses', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('server exploded', { status: 500 })
    );

    await expect(apiClient.get('/api/test')).rejects.toMatchObject({ status: 500 });
  });

  it('resolves with the parsed JSON body on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
    );

    const result = await apiClient.get<{ hello: string }>('/api/test');

    expect(result).toEqual({ hello: 'world' });
  });
});
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm --workspace=backoffice run test`
Expected: 5 tests pass, 0 failures. (This is a characterization suite for
already-shipped code, not new-code TDD, so PASS on the first run is correct —
if anything fails, the bug is in the test, not `apiClient.ts`, since that file
is unmodified in this task.)

- [ ] **Step 6: Verify the build still succeeds**

Run: `npm --workspace=backoffice run build`
Expected: succeeds, same output as before (`dist/index.html`,
`dist/assets/*.js`, `dist/assets/*.css`).

- [ ] **Step 7: Commit**

```bash
git add backoffice/package.json backoffice/vite.config.ts backoffice/src/test/setup.ts backoffice/src/lib/__tests__/apiClient.test.ts package-lock.json
git commit -m "test(backoffice): add Vitest infra and characterization tests for apiClient"
```

---

### Task 2: Extract and fix the placeholder route table

**Files:**
- Create: `backoffice/src/routes.ts`
- Create: `backoffice/src/__tests__/routes.test.ts`
- Modify: `backoffice/src/App.tsx`
- Modify: `backoffice/src/components/Sidebar.tsx`
- Create: `backoffice/src/components/__tests__/Sidebar.test.tsx`

**Interfaces:**
- Consumes: nothing new from Task 1 except the now-working `npm --workspace=backoffice run test` command.
- Produces: `COMMAND_CENTER_PATH: string`, `LOGIN_PATH: string`,
  `PLACEHOLDER_ROUTES: PlaceholderRouteDef[]` (with `PlaceholderRouteDef =
  { path: string; title: string }`) exported from `backoffice/src/routes.ts`.
  Every later workstream that adds a real page (replacing a `ComingSoon` entry)
  removes that entry from `PLACEHOLDER_ROUTES` and adds its own `<Route>` in
  `App.tsx` — this array is the single source of truth for "not yet built."

- [ ] **Step 1: Write the failing route-table test**

Create `backoffice/src/__tests__/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COMMAND_CENTER_PATH, LOGIN_PATH, PLACEHOLDER_ROUTES } from '../routes';

describe('Backoffice route table', () => {
  it('uses / for Command Center and /login for Login', () => {
    expect(COMMAND_CENTER_PATH).toBe('/');
    expect(LOGIN_PATH).toBe('/login');
  });

  it('uses the pluralized Payroll Employee Detail path', () => {
    const route = PLACEHOLDER_ROUTES.find((r) => r.title === 'Payroll Employee Detail');
    expect(route?.path).toBe('/payroll/employees/:id');
  });

  it('nests Membership Report under /reports', () => {
    const route = PLACEHOLDER_ROUTES.find((r) => r.title === 'Membership Report');
    expect(route?.path).toBe('/reports/membership');
  });

  it('no longer defines a bare /membership route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/membership');
  });

  it('no longer defines the singular /payroll/employee/:id route', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(paths).not.toContain('/payroll/employee/:id');
  });

  it('defines exactly the 22 non-Command-Center, non-Login screens', () => {
    expect(PLACEHOLDER_ROUTES).toHaveLength(22);
  });

  it('has no duplicate paths', () => {
    const paths = PLACEHOLDER_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace=backoffice run test -- routes.test.ts`
Expected: FAIL — `backoffice/src/routes.ts` does not exist yet (module not
found).

- [ ] **Step 3: Create `routes.ts` with the reconciled route table**

Create `backoffice/src/routes.ts`:

```ts
export interface PlaceholderRouteDef {
  path: string;
  title: string;
}

export const COMMAND_CENTER_PATH = '/';
export const LOGIN_PATH = '/login';

/**
 * Screens not yet implemented (spec §8, workstreams B–I) — each renders the
 * shared ComingSoon placeholder until its workstream replaces the entry with
 * a real <Route> in App.tsx. Remove an entry here the same commit a real
 * page for it ships.
 */
export const PLACEHOLDER_ROUTES: PlaceholderRouteDef[] = [
  { path: '/hr', title: 'HR & People' },
  { path: '/hr/employees/:id', title: 'Employee Detail' },
  { path: '/attendance', title: 'Attendance Overview' },
  { path: '/attendance/import', title: 'Fingerprint Import' },
  { path: '/attendance/exceptions', title: 'Exception Review' },
  { path: '/payroll', title: 'Payroll Overview' },
  { path: '/payroll/regular', title: 'Regular Payroll' },
  { path: '/payroll/barber', title: 'Barber Payroll' },
  { path: '/payroll/employees/:id', title: 'Payroll Employee Detail' },
  { path: '/operations', title: 'Operations' },
  { path: '/crm', title: 'CRM Overview' },
  { path: '/crm/customers/:id', title: 'Customer 360' },
  { path: '/reports/membership', title: 'Membership Report' },
  { path: '/stockist', title: 'Stockist & Inventory Dashboard' },
  { path: '/moka', title: 'Moka POS Integration' },
  { path: '/reports', title: 'Reports Overview' },
  { path: '/reports/branches', title: 'Branch Performance' },
  { path: '/reports/customers', title: 'Customer Report' },
  { path: '/reports/barbers', title: 'Barber Performance' },
  { path: '/system/roles', title: 'Peran & Izin' },
  { path: '/system/packages', title: 'Akses Paket' },
  { path: '/system/settings', title: 'Pengaturan' },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace=backoffice run test -- routes.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Update `App.tsx` to import the route table instead of defining it inline**

Replace `backoffice/src/App.tsx` in full:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { BackofficeLayout } from './layouts/BackofficeLayout';
import { Login } from './pages/Login';
import { CommandCenter } from './pages/CommandCenter';
import { ComingSoon } from './pages/ComingSoon';
import { COMMAND_CENTER_PATH, LOGIN_PATH, PLACEHOLDER_ROUTES } from './routes';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path={LOGIN_PATH} element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <BackofficeLayout />
            </ProtectedRoute>
          }
        >
          <Route path={COMMAND_CENTER_PATH} element={<CommandCenter />} />
          {PLACEHOLDER_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<ComingSoon title={route.title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to={COMMAND_CENTER_PATH} replace />} />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Fix the Membership nav link in `Sidebar.tsx`**

In `backoffice/src/components/Sidebar.tsx`, in the `NAV_GROUPS` array, find:

```ts
      { to: '/membership', label: 'Membership' },
```

Replace with:

```ts
      { to: '/reports/membership', label: 'Membership' },
```

(This is the only line that changes in this file — everything else stays
exactly as shipped in Phase 1A.)

- [ ] **Step 7: Write a test confirming the Sidebar links to the new Membership path**

Create `backoffice/src/components/__tests__/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { AuthProvider } from '../../auth/AuthProvider';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('links Membership to /reports/membership, not the old /membership path', () => {
    renderSidebar();

    const link = screen.getByRole('link', { name: 'Membership' });

    expect(link).toHaveAttribute('href', '/reports/membership');
  });

  it('still links Command Center to /', () => {
    renderSidebar();

    const link = screen.getByRole('link', { name: 'Command Center' });

    expect(link).toHaveAttribute('href', '/');
  });
});
```

- [ ] **Step 8: Run the full test suite and verify everything passes**

Run: `npm --workspace=backoffice run test`
Expected: all tests pass (apiClient suite from Task 1 + routes suite + Sidebar
suite from this task — 14 tests total).

- [ ] **Step 9: Verify the build still succeeds**

Run: `npm --workspace=backoffice run build`
Expected: succeeds.

- [ ] **Step 10: Manually verify no other file references the old paths**

Run: `grep -rn "'/membership'" backoffice/src` and
`grep -rn "/payroll/employee/" backoffice/src`
Expected: zero matches for both (confirms nothing besides `Sidebar.tsx` and
`App.tsx`/`routes.ts` referenced the old paths — if this finds something,
update it before committing).

- [ ] **Step 11: Commit**

```bash
git add backoffice/src/routes.ts backoffice/src/App.tsx backoffice/src/components/Sidebar.tsx backoffice/src/__tests__/routes.test.ts backoffice/src/components/__tests__/Sidebar.test.tsx
git commit -m "fix(backoffice): reconcile placeholder route table (payroll employee id plural, membership under /reports)"
```

---

## Definition of done for this workstream

- [ ] `npm --workspace=backoffice run test` passes (14 tests: 5 apiClient + 7
      routes + 2 Sidebar)
- [ ] `npm --workspace=backoffice run build` succeeds
- [ ] `node --check server/index.js` and full `npm test` (root, server suite)
      still show only the 24 pre-existing/unrelated failures already
      documented in the spec — nothing in this workstream touches `server/`
- [ ] Serverless function count unchanged at 12 (this workstream never touches
      `vercel.json` or `api/`)
- [ ] Two commits on `feat/backoffice-full-product`, each independently
      reviewable
- [ ] Report back per spec §14 before starting Workstream B
