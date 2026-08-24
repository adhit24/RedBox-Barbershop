# Stockist App Shell — Nav Bar, Header, Stok Hub, Profil (Plan 3 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the RedBox Stockist app's persistent chrome — bottom navigation and top header — to the Claude Design mockup exactly (full-width static nav with always-visible icon+label, dynamic per-page header with search/notification icons), and add the two new pages the mockup's nav depends on that don't exist yet: a "Stok" hub (owner/manager) and a "Profil" page (all roles).

**Architecture:** Pure frontend, one shared layout file (`app/admin/stockist/layout.tsx`) plus two new page routes. `BottomNavBar` is rebuilt to match the mockup's static full-width bar (current version is a floating pill with an expand/collapse animation — replaced, not extended, since the visual language is fundamentally different). The header becomes per-page: a `headerFor()`-style lookup keyed on pathname (mirroring the mockup's own `headerFor()` switch) replaces the current fixed "RedBox Stockist" branding bar. The search icon in the header links to each section's existing in-page search (Produk/Stok Cabang already have their own search bars) rather than building a new global search. The notification icon links to a placeholder route for now — the real Notifikasi page is Plan 4 (needs new backend), so this plan's notification icon links to a route that will exist by Plan 4's end, but is NOT built in this plan (see Global Constraints).

**Tech Stack:** Next.js 16 (App Router) / React 19 / TypeScript, Tailwind v4, `lucide-react` icons (existing convention for nav — mockup uses Material Symbols but this codebase's nav already uses Lucide, kept consistent), `material-symbols-outlined` (existing convention for in-page icons).

**Spec:** The Claude Design mockup `RedBox Stockist.dc.html` — specifically its bottom nav bar markup (`showNav`/`navItems` block, `flex:1` stacked icon+label buttons), its top header markup (`showHeader`/`canBack`/`title`/`subtitle`/`goSearch`/`goNotif` block), its `headerFor()` title/subtitle map, and its `isStokHub`/`hubItems` and profile (`profileRows`) screens — all read via the DesignSync/Claude Design MCP tool earlier this session. User-confirmed direction: nav must be "sama persis" (exactly the same) as the mockup.

## Global Constraints

- No API contract, database schema, or auth/session change.
- No new npm dependencies.
- The header's notification icon links to `/admin/stockist/notifications` — that route does NOT get built in this plan (Plan 4 builds it, since it needs a new backend table). Linking to a not-yet-existing route is acceptable here because Next.js will 404 gracefully on a route that doesn't exist yet, and this plan's own QA step explicitly checks and documents this as an expected, temporary gap — not a defect to work around with a fake page.
- `BranchAdminDashboard`'s own internal content (the cards/sections rendered inside the page body) is NOT touched by this plan — only the surrounding chrome (header, nav) and net-new pages change. A separate future plan handles restyling `BranchAdminDashboard`'s body to match the mockup's `isBranchHome` screen exactly (banner order, KPI tint colors, action button set) — flagged by the user as still mismatched, tracked for its own plan.
- Only ONE role currently exists in the codebase beyond `branch_admin`/`barber`: `owner`. The mockup's nav has a concept of "central" roles (owner + a not-yet-built "manager") sharing one 4-tab nav; since `manager` doesn't exist in this codebase yet (tracked separately, its own future plan per earlier research), this plan's owner nav applies to `user.role === 'owner'` only — structured so extending it to also cover `manager` later is a one-line change (`isCentral = role === 'owner' || role === 'manager'`), not a rewrite.
- No frontend test framework — verification is `npx tsc --noEmit` / `npm run lint` / `npm run build` / manual dev-server smoke checks.

---

### Task 1: Rebuild `BottomNavBar` to match the mockup's static full-width bar

**Files:**
- Modify: `frontend/src/components/ui/bottom-nav-bar.tsx` (full file, 106 lines → ~55 lines)

**Interfaces:**
- Consumes: nothing new.
- Produces: `BottomNavItem` type UNCHANGED (`{ label: string; href: string; icon: LucideIcon; activePrefixes?: string[] }`) so callers need no type-level changes. `BottomNavBarProps` drops the now-meaningless `stickyBottom` prop (confirmed via `grep -rn 'BottomNavBar\|stickyBottom' frontend/src` that the only consumer, `app/admin/stockist/layout.tsx`, never passes it — it always used the `true` default, so removing it is a safe, unused-prop cleanup, not a behavior change).

- [ ] **Step 1: Replace the full file**

```tsx
// frontend/src/components/ui/bottom-nav-bar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  activePrefixes?: string[];
};

export type BottomNavBarProps = {
  items: BottomNavItem[];
  className?: string;
};

export function BottomNavBar({ items, className = '' }: BottomNavBarProps) {
  const pathname = usePathname() || '';

  return (
    <nav
      aria-label="Navigasi utama"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[430px] items-stretch bg-surface-elevated border-t border-border-base px-1 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]',
        className
      )}
    >
      {items.map((item) => {
        // Exact match for the root Stockist route so it doesn't stay "active"
        // on every deeper page (which all start with the same prefix).
        const active = item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? (item.href === '/admin/stockist'
          ? pathname === item.href
          : pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl transition-colors active:scale-95',
              active ? 'text-primary-container' : 'text-text-muted hover:text-text-secondary'
            )}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} aria-hidden />
            <span className="text-[10px] font-bold tracking-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default BottomNavBar;
```

(Drops `framer-motion` entirely from this file — the mockup's nav has no expand/collapse animation, every tab is always icon+label, so there's nothing to animate. `whileTap`-style press feedback is kept via a plain Tailwind `active:scale-95` instead.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: the diff itself is clean, but this WILL surface an error in `app/admin/stockist/layout.tsx` — its current `<BottomNavBar items={...} />` call doesn't pass `stickyBottom` so that's fine, but `layout.tsx`'s nav arrays are about to change shape too (Task 2, not yours) — if `npx tsc --noEmit` shows an error only inside `layout.tsx` at this point, that's expected sequencing (Task 2 resolves it); if it shows an error inside `bottom-nav-bar.tsx` itself, that's a real problem in this task — stop and report.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/bottom-nav-bar.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): rebuild BottomNavBar as a static full-width bar

Replaces the floating pill with expand/collapse animation with the
mockup's exact pattern: a full-width bar, every tab always showing
both icon and label, active tab colored red. The two look
fundamentally different, so this is a rebuild, not an extension.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rebuild the header as a dynamic per-page bar, restructure nav items, add Stok hub route

**Files:**
- Modify: `frontend/src/app/admin/stockist/layout.tsx` (full file)

**Interfaces:**
- Consumes: `BottomNavBar`'s rebuilt props (Task 1).
- Produces: no new exports (this is a page-shell component, not a library). Introduces an internal `HEADER_MAP`-style lookup (pathname prefix → `{ title, subtitle? }`) that later pages don't need to know about or opt into — the layout alone decides what header to show based on the current route.

Context: the current header is a fixed, non-navigational branding bar ("RedBox Stockist" + role badge + theme toggle + logout) shown identically on every page. The mockup's header changes per screen (title = "Beranda"/"Notifikasi"/"Stok Cabang"/etc., subtitle = contextual like "Cabang Bypass" or "2 belum dibaca"), has a back button on non-root screens, and carries search + notification icon buttons instead of the theme toggle/logout (which move to the Profil page in this plan, matching the mockup's own IA — `logout` lives on the mockup's Profil screen, not its header).

- [ ] **Step 1: Re-read the current live file first**

This file has been modified by several tasks across two prior plans. Re-read `frontend/src/app/admin/stockist/layout.tsx` in full before editing to confirm it still matches the version quoted in Step 2 below — if it has drifted, adapt the replacement to preserve every requirement listed here while keeping whatever legitimately changed (e.g. if a login-guard `useEffect` gained a new dependency, keep that).

- [ ] **Step 2: Replace the full file**

```tsx
// frontend/src/app/admin/stockist/layout.tsx
'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, Truck, User, PackageCheck } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';
import { PremiumLoginTransition, type PremiumRole } from '@/components/auth/PremiumLoginTransition';
import { useStockistTheme } from '@/lib/stockist/useTheme';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

// Ordered longest-prefix-first so a more specific route (e.g. "/branch-stock/all")
// matches before a shorter one ("/branch-stock") that would otherwise shadow it.
const HEADER_ROUTES: Array<{ prefix: string; title: string; subtitle?: string }> = [
  { prefix: '/admin/stockist/branch-stock/all', title: 'Semua Stok', subtitle: 'Sebaran per produk' },
  { prefix: '/admin/stockist/branch-stock', title: 'Stok Cabang' },
  { prefix: '/admin/stockist/branches', title: 'Stok Cabang' },
  { prefix: '/admin/stockist/products', title: 'Produk', subtitle: 'Master produk RedBox' },
  { prefix: '/admin/stockist/warehouse', title: 'Gudang Pusat', subtitle: 'Stok pusat & penerimaan' },
  { prefix: '/admin/stockist/transfers', title: 'Transfer' },
  { prefix: '/admin/stockist/requests', title: 'Permintaan Stok' },
  { prefix: '/admin/stockist/returns', title: 'Retur Barang' },
  { prefix: '/admin/stockist/stock-opname', title: 'Stock Opname' },
  { prefix: '/admin/stockist/ledger', title: 'Inventory Ledger' },
  { prefix: '/admin/stockist/insights', title: 'Insight' },
  { prefix: '/admin/stockist/notifications', title: 'Notifikasi' },
  { prefix: '/admin/stockist/profile', title: 'Profil' },
  { prefix: '/admin/stockist/stok', title: 'Stok', subtitle: 'Pilih area yang mau dibuka' },
];

function headerFor(pathname: string, isOwner: boolean, branchLabel: string | null): { title: string; subtitle: string | null; canBack: boolean } {
  if (pathname === '/admin/stockist') {
    return { title: 'Beranda', subtitle: isOwner ? 'Semua lokasi' : branchLabel, canBack: false };
  }
  const match = HEADER_ROUTES.find((r) => pathname.startsWith(r.prefix));
  return { title: match?.title ?? 'RedBox Stockist', subtitle: match?.subtitle ?? null, canBack: true };
}

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const pathname = usePathname() || '';
  const { theme } = useStockistTheme();
  const [transition, setTransition] = useState<{ role: PremiumRole; name?: string | null } | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/admin/stockist/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const readTransition = () => {
      try {
      const stored = sessionStorage.getItem('redbox:post-login-transition');
      if (stored) setTransition(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem('redbox:post-login-transition');
      }
    };
    readTransition();
    window.addEventListener('redbox:login-complete', readTransition);
    return () => window.removeEventListener('redbox:login-complete', readTransition);
  }, [user?.id, loading]);

  useEffect(() => {
    if (!transition || loading || !user) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem('redbox:post-login-transition');
      setTransition(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [transition, loading, user]);

  // The login page is rendered inside this layout. Keep children visible while
  // auth is unresolved or absent; middleware still protects server requests,
  // and the client redirect above protects in-app navigation.
  if (loading || !user) {
    return <div data-theme={theme}>{children}</div>;
  }

  if (transition) {
    return (
      <div data-theme={theme}>
        <PremiumLoginTransition role={transition.role} userName={transition.name || user.name} theme={theme} />
      </div>
    );
  }

  const isOwner = user.role === 'owner';
  const branchLabel = user.role === 'branch_admin' ? (BRANCH_NAMES[user.branch || ''] || user.branch || null) : null;

  const ownerTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/stok', icon: Boxes },
    { label: 'Transfer', href: '/admin/stockist/transfers', icon: Truck },
    { label: 'Profil', href: '/admin/stockist/profile', icon: User }
  ];

  const branchAdminTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/branch-stock', icon: Boxes },
    { label: 'Masuk', href: '/admin/stockist/transfers', icon: PackageCheck },
    { label: 'Profil', href: '/admin/stockist/profile', icon: User }
  ];

  const header = headerFor(pathname, isOwner, branchLabel);
  const searchHref = isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock';

  return (
    <div data-theme={theme}>
    <MotionConfig reducedMotion="user">
      <div className="bg-surface-container-lowest text-text-primary antialiased min-h-screen">
      {/* TopAppBar */}
      <header
        className="bg-surface-dim fixed top-0 w-full z-50 flex items-center gap-3 px-4 h-[56px] max-w-[430px] left-1/2 -translate-x-1/2 border-b border-border-base"
        style={{ boxShadow: 'var(--shadow2)' }}
      >
        {header.canBack ? (
          <button
            onClick={() => router.back()}
            aria-label="Kembali"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-primary"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        ) : (
          <span className="material-symbols-outlined text-primary-container text-[22px] shrink-0">inventory_2</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-bold leading-tight text-text-primary">{header.title}</span>
          {header.subtitle && <span className="truncate text-[11px] font-medium text-text-muted">{header.subtitle}</span>}
        </div>
        <button
          onClick={() => router.push(searchHref)}
          aria-label="Cari produk"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">search</span>
        </button>
        <button
          onClick={() => router.push('/admin/stockist/notifications')}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="pt-[calc(56px+16px)] pb-[calc(70px+24px)] px-4 w-full max-w-[430px] mx-auto min-h-screen flex flex-col gap-4">
        {children}
      </main>

      {/* BottomNavBar */}
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
      </div>
    </MotionConfig>
    </div>
  );
}
```

Notes on deliberate changes from the current file:
- The role badge ("Owner" / branch name pill), theme toggle button, and logout button are all REMOVED from the header — they move to the new Profil page (Task 4), matching the mockup's IA where the header only ever carries navigation (back/title/search/notifications), never account actions.
- Header height grows from `48px` to `56px` to comfortably fit two icon buttons plus a two-line title/subtitle stack; `main`'s top padding is updated to match (`pt-[calc(56px+16px)]`).
- `Building2`/`ClipboardList`/`History`/`LayoutDashboard`/`Lightbulb` icon imports are dropped (no longer used by the new 4-tab nav definitions); `Truck`/`User` are newly imported.
- The notification bell's unread red-dot indicator is intentionally NOT included yet — that requires real unread-count data, which doesn't exist until Plan 4 builds the notifications backend. Do not fabricate a static dot.

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors now (this task resolves whatever Task 1 left pending).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/stockist/layout.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): dynamic per-page header, 4-tab nav for both roles

Header now shows a contextual title/subtitle (with a back button on
non-root screens) and search/notification icons, replacing the fixed
branding bar — account actions (theme toggle, logout) move to the new
Profil page in the next task. Both roles get a 4-tab bottom nav
matching the mockup: Owner gets Beranda/Stok/Transfer/Profil (Stok
points at a new hub page built next), Admin Cabang keeps
Beranda/Stok/Masuk/Profil. The notification icon links to a route
that doesn't exist until Plan 4 (needs a new backend) — a documented,
temporary gap, not a defect.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Build the "Stok" hub page (owner only)

**Files:**
- Create: `frontend/src/app/admin/stockist/stok/page.tsx`

**Interfaces:**
- Consumes: `useUser` (route-guards to owner only, mirroring the pattern other stockist pages use).
- Produces: a page component at `/admin/stockist/stok`, default export, no other module imports it.

Context: mirrors the mockup's `isStokHub` screen (`hubItems` array in the `.dc.html`'s script section) — a 7-item icon list, each row linking to an existing page. All 7 destinations already exist in the app today.

- [ ] **Step 1: Write the page**

```tsx
// frontend/src/app/admin/stockist/stok/page.tsx
'use client';

import Link from 'next/link';
import { useUser } from '@/hooks/useUser';

interface HubItem {
  key: string;
  name: string;
  desc: string;
  icon: string;
  tint: string;
  color: string;
  href: string;
}

const HUB_ITEMS: HubItem[] = [
  { key: 'produk', name: 'Produk', desc: 'Master produk, harga, stok minimum', icon: 'category', tint: 'bg-tint-info', color: 'text-info', href: '/admin/stockist/products' },
  { key: 'gudang', name: 'Gudang Pusat', desc: 'Stok pusat & penerimaan barang', icon: 'warehouse', tint: 'bg-tint-success', color: 'text-success', href: '/admin/stockist/warehouse' },
  { key: 'cabang', name: 'Stok Cabang', desc: 'Sebaran stok per cabang', icon: 'storefront', tint: 'bg-tint-warning', color: 'text-warning', href: '/admin/stockist/branch-stock' },
  { key: 'ledger', name: 'Inventory Ledger', desc: 'Semua pergerakan stok', icon: 'receipt_long', tint: 'bg-tint-danger', color: 'text-danger', href: '/admin/stockist/ledger' },
  { key: 'requests', name: 'Permintaan Stok', desc: 'Pengajuan dari cabang', icon: 'add_shopping_cart', tint: 'bg-tint-info', color: 'text-info', href: '/admin/stockist/requests' },
  { key: 'returns', name: 'Retur Barang', desc: 'Pengembalian & barang rusak', icon: 'keyboard_return', tint: 'bg-tint-warning', color: 'text-warning', href: '/admin/stockist/returns' },
  { key: 'insight', name: 'Insight', desc: 'Sinyal distribusi & restock', icon: 'lightbulb', tint: 'bg-tint-success', color: 'text-success', href: '/admin/stockist/insights' },
];

export default function StokHubPage() {
  const { user } = useUser();
  if (!user || user.role !== 'owner') return null;

  return (
    <div className="flex flex-col gap-2.5">
      {HUB_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="flex w-full items-center gap-3 rounded-2xl border border-border-base bg-surface-elevated p-4 shadow-[var(--shadow)] hover:border-danger/40 transition-colors"
        >
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tint}`}>
            <span className={`material-symbols-outlined text-[21px] ${item.color}`}>{item.icon}</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-bold text-text-primary">{item.name}</span>
            <span className="text-[11px] text-text-secondary">{item.desc}</span>
          </span>
          <span className="material-symbols-outlined shrink-0 text-[20px] text-text-muted">chevron_right</span>
        </Link>
      ))}
    </div>
  );
}
```

(`stock-opname` is deliberately NOT in this hub — it wasn't one of the mockup's 7 `hubItems`, which is why it's absent from this list too; it stays reachable via the Owner Home's "Aksi cepat" or wherever it's already linked from today, unaffected by this plan.)

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/stok/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add the Stok hub page for owner navigation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Build the Profil page (both roles)

**Files:**
- Create: `frontend/src/app/admin/stockist/profile/page.tsx`

**Interfaces:**
- Consumes: `useUser` (for identity fields), `useStockistTheme` (theme toggle, moved here from the header).
- Produces: a page component at `/admin/stockist/profile`.

Context: mirrors the mockup's Profil screen (identity card + account rows) but ALSO absorbs what the header used to carry (theme toggle, logout) and — since `branch_admin`'s bottom nav dropped from 5 tabs to 4 in Task 2 — provides quick links to the two destinations that lost their dedicated nav tab (`Permintaan`/`requests`, `Riwayat`/`ledger`) so they stay reachable. This is a deliberate, justified deviation from the mockup's exact Profil content, not an oversight — the mockup's own branch nav never had 5 tabs in the first place, so it never needed this; this codebase's branch nav did, and this plan is removing that capacity from the nav bar, so it must be replaced somewhere.

- [ ] **Step 1: Write the page**

```tsx
// frontend/src/app/admin/stockist/profile/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { useStockistTheme } from '@/lib/stockist/useTheme';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

interface ProfileRow {
  key: string;
  icon: string;
  label: string;
  value: string;
  onClick?: () => void;
}

export default function ProfilePage() {
  const { user, signOut } = useUser();
  const router = useRouter();
  const { theme, toggleTheme } = useStockistTheme();
  if (!user) return null;

  const isOwner = user.role === 'owner';
  const branchLabel = user.role === 'branch_admin' ? (BRANCH_NAMES[user.branch || ''] || user.branch || '-') : null;
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const rows: ProfileRow[] = [
    {
      key: 'org',
      icon: 'apartment',
      label: isOwner ? 'Organisasi' : 'Cabang',
      value: isOwner ? 'RedBox Barbershop Indonesia' : `${branchLabel} · terkunci`,
    },
    { key: 'status', icon: 'verified_user', label: 'Status akun', value: 'Aktif · terverifikasi' },
    {
      key: 'theme',
      icon: theme === 'light' ? 'dark_mode' : 'light_mode',
      label: 'Tampilan',
      value: theme === 'light' ? 'Mode terang' : 'Mode gelap',
      onClick: toggleTheme,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border-base bg-surface-elevated p-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-container text-[16px] font-bold text-white">
          {initials}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold text-text-primary">{user.name}</span>
          <span className="truncate text-[11px] text-text-muted">{user.email}</span>
          <span className="mt-1 w-fit rounded-full bg-primary-container/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-container">
            {isOwner ? 'Owner' : branchLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border-base overflow-hidden rounded-2xl border border-border-base bg-surface-elevated">
        {rows.map((row) => {
          const content = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">{row.icon}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span className="text-[12px] font-semibold text-text-primary">{row.label}</span>
                <span className="truncate text-[11px] text-text-muted">{row.value}</span>
              </span>
            </>
          );
          return row.onClick ? (
            <button key={row.key} onClick={row.onClick} className="flex items-center gap-3 p-3.5 text-left hover:bg-surface-container-high transition-colors">
              {content}
            </button>
          ) : (
            <div key={row.key} className="flex items-center gap-3 p-3.5">
              {content}
            </div>
          );
        })}
      </div>

      {!isOwner && (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[12px] font-bold text-text-primary">Menu lainnya</span>
          <div className="flex flex-col divide-y divide-border-base overflow-hidden rounded-2xl border border-border-base bg-surface-elevated">
            <Link href="/admin/stockist/requests" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Permintaan Stok</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
            <Link href="/admin/stockist/ledger" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Riwayat Ledger</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
            <Link href="/admin/stockist/returns" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Retur Barang</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
          </div>
        </div>
      )}

      <button
        onClick={() => {
          if (confirm('Keluar dari aplikasi?')) {
            signOut();
            router.replace('/admin/stockist/login');
          }
        }}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-danger/30 text-[13px] font-bold text-danger"
      >
        <span className="material-symbols-outlined text-[19px]">logout</span>
        Keluar
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/stockist/profile/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add the Profil page

Absorbs the theme toggle and logout action moved out of the header in
the previous task, and gives branch_admin quick links to Permintaan/
Ledger/Retur — destinations that lost their dedicated bottom-nav tab
when the nav went from 5 tabs to 4 to match the mockup.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verification pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full production build**

Run: `cd frontend && npm run build`
Expected: succeeds, all routes generated (including the two new ones, `/admin/stockist/stok` and `/admin/stockist/profile`), zero TypeScript errors.

- [ ] **Step 2: Confirm no other file references the removed `stickyBottom` prop or the dropped icon imports**

Run: `grep -rn 'stickyBottom' frontend/src` — expect zero matches.

- [ ] **Step 3: Smoke-test the login page still renders**

Run: `cd frontend && npm run dev`, then:
```bash
curl -s -o /dev/null -w "login HTTP %{http_code}\n" http://localhost:3000/admin/stockist/login
```
Expected: HTTP 200 (the layout's unauthenticated passthrough branch is unaffected by this plan, but this confirms the file still compiles and serves at runtime, not just at build time). Stop the dev server afterward with a scoped kill targeting only the PID listening on the dev port (`netstat`-and-targeted-`taskkill` on Windows, or the equivalent) — never a system-wide `taskkill /IM node.exe` or `pkill -f node`.

- [ ] **Step 4: Note remaining manual QA scope**

Full interactive QA (logging in as both roles, confirming the new header/nav/hub/profile render and navigate correctly, confirming the notification icon's expected temporary 404) still requires real Supabase credentials not available in this environment. Record this explicitly as open for the user, same as prior plans in this sequence.

No commit for this task — verification only.

---

## What this plan deliberately does not cover

- **The Notifikasi page itself** — the header's bell icon links to `/admin/stockist/notifications`, which doesn't exist until Plan 4 (needs a new database table + API for a real notification inbox, per the user's explicit choice to build it properly rather than derive a fake one from existing data).
- **Real barcode/QR camera scanning** — Plan 5, needs a new npm dependency and browser camera permission handling.
- **`BranchAdminDashboard`'s body content** (the cards inside the Beranda page for branch admins) — still doesn't match the mockup's `isBranchHome` screen (banner order, KPI tint colors, exact action button set) per the user's own screenshot comparison; tracked for its own future plan, not touched here (this plan only touched the chrome around it).
- **The "Manager" role** — tracked separately, its own future plan (needs database + backend permission work across ~10 files, already researched earlier this session).
