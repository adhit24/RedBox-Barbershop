# Page Transition & Animation Polish — Design Spec

**Date:** 2026-06-09
**Scope:** Bold & Punchy slide-horizontal page transitions di semua route groups + Framer Motion polish untuk barber schedule page.

---

## 1. Background & Context

### Existing State
- Role picker (`/`) dan Login (`/login`): sudah punya framer-motion entry animations, `whileTap`, hover effects
- Admin dashboard: sudah punya `motion.div`, `AnimatePresence`, `Skeleton` pulse
- Owner revenue/payment: sudah punya motion, AnimatePresence, recharts
- **Barber schedule** (`/barber/schedule`): belum ada Framer Motion sama sekali
- **Tidak ada page transitions** di seluruh app — navigasi antar halaman langsung cut tanpa animasi

### Goal
Tambah slide-horizontal page transitions di semua route groups sehingga app terasa seperti native mobile app. Sekaligus tambah Framer Motion polish di barber schedule yang saat ini paling "bare".

---

## 2. Animation Style: Bold & Punchy

- **Entry:** slide tegas dari kanan/kiri + opacity 0→1
- **Spring:** `stiffness: 300, damping: 30`
- **Tap:** `whileTap: { scale: 0.95 }` konsisten
- **Duration:** 300–380ms untuk transitions, 150–200ms untuk micro-interactions
- **Exit:** hanya -30% slide (tidak full-reverse) + fade out 200ms

---

## 3. Page Transition System

### Approach: PageTransition Component + useNavigationDirection Hook

### 3a. `useNavigationDirection` Hook

**File:** `frontend/src/hooks/useNavigationDirection.ts`

```ts
import { usePathname } from 'next/navigation';
import { useRef, useEffect } from 'react';

const ROUTE_ORDER = [
  '/',
  '/login',
  '/owner/dashboard',
  '/owner/revenue',
  '/owner/payment',
  '/owner/profile',
  '/admin/dashboard',
  '/admin/bookings',
  '/admin/barbers',
  '/admin/leaderboard',
  '/admin/customers',
  '/admin/membership',
  '/barber/home',
  '/barber/schedule',
  '/barber/leaderboard',
  '/barber/feed',
  '/barber/profile',
];

export type NavDirection = 'forward' | 'back' | 'none';

export function useNavigationDirection(): NavDirection {
  const pathname = usePathname();
  const prevPathname = useRef<string>(pathname);
  const direction = useRef<NavDirection>('none');

  useEffect(() => {
    const prev = prevPathname.current;
    const curr = pathname;
    if (prev === curr) return;
    const prevIdx = ROUTE_ORDER.findIndex(r => prev.startsWith(r));
    const currIdx = ROUTE_ORDER.findIndex(r => curr.startsWith(r));
    if (prevIdx === -1 || currIdx === -1) {
      direction.current = 'forward';
    } else {
      direction.current = currIdx >= prevIdx ? 'forward' : 'back';
    }
    prevPathname.current = curr;
  }, [pathname]);

  return direction.current;
}
```

### 3b. `PageTransition` Component

**File:** `frontend/src/components/PageTransition.tsx`

```tsx
'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useNavigationDirection, type NavDirection } from '@/hooks/useNavigationDirection';

const variants = {
  enter: (dir: NavDirection) => ({
    x: dir === 'back' ? '-100%' : '100%',
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: NavDirection) => ({
    x: dir === 'back' ? '30%' : '-30%',
    opacity: 0,
  }),
};

export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const direction = useNavigationDirection();

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={pathname}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{
          x: { type: 'spring', stiffness: 300, damping: 30 },
          opacity: { duration: 0.2 },
        }}
        className={className}
        style={{ willChange: 'transform' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### 3c. Root `app/template.tsx`

**File:** `frontend/src/app/template.tsx`

`template.tsx` di App Router re-mount setiap navigasi (berbeda dari `layout.tsx` yang persist), sehingga AnimatePresence bekerja natural untuk root pages (`/`, `/login`).

```tsx
'use client';
import { PageTransition } from '@/components/PageTransition';

export default function RootTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
```

### 3d. Layout Modifications

Wrap `<main>{children}</main>` dengan `<PageTransition>` di tiga layout:

**`app/owner/layout.tsx`** (sudah `'use client'`) — ganti:
```tsx
<main>{children}</main>
```
dengan:
```tsx
<PageTransition>
  <main>{children}</main>
</PageTransition>
```

**`app/barber/layout.tsx`** (sudah `'use client'`) — sama persis.

**`app/admin/layout.tsx`** — cek apakah sudah `'use client'`. Jika belum, tambahkan directive. Lalu wrap `<main>` yang sama.

---

## 4. Barber Schedule Animation Polish

**File:** `frontend/src/app/barber/schedule/page.tsx`

### 4a. Tab Indicator (layoutId)

```tsx
<button onClick={() => setTab(t.key)} className="relative flex-1 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer">
  {tab === t.key && (
    <motion.span
      layoutId="schedule-tab-indicator"
      className="absolute inset-0 rounded-xl bg-slate-700"
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    />
  )}
  <span className="relative z-10">{t.label}</span>
</button>
```

### 4b. Booking Card Stagger

```tsx
<motion.div
  key={booking.id}
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: index * 0.06, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
>
  <BookingCard booking={booking} />
</motion.div>
```

### 4c. Skeleton Loading

```tsx
function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ opacity: [0.4, 0.7, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className={`bg-slate-800 rounded-lg ${className}`}
    />
  );
}
```

Render 3 skeleton saat `loading === true`.

### 4d. Empty State

```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.85 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
  className="flex flex-col items-center justify-center py-16 gap-3"
>
  <motion.div
    animate={{ opacity: [0.4, 0.8, 0.4] }}
    transition={{ duration: 2.5, repeat: Infinity }}
    className="text-3xl"
  >
    ✂️
  </motion.div>
  <p className="text-slate-500 text-sm">Tidak ada jadwal {dateForTab(tab).label.toLowerCase()}</p>
</motion.div>
```

### 4e. AnimatePresence untuk List per Tab

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={tab}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.15 }}
  >
    {/* booking cards atau empty state */}
  </motion.div>
</AnimatePresence>
```

---

## 5. File Summary

| File | Action |
|---|---|
| `frontend/src/hooks/useNavigationDirection.ts` | CREATE |
| `frontend/src/components/PageTransition.tsx` | CREATE |
| `frontend/src/app/template.tsx` | CREATE |
| `frontend/src/app/owner/layout.tsx` | MODIFY — wrap `<main>` |
| `frontend/src/app/barber/layout.tsx` | MODIFY — wrap `<main>` |
| `frontend/src/app/admin/layout.tsx` | MODIFY — tambah 'use client' jika perlu, wrap `<main>` |
| `frontend/src/app/barber/schedule/page.tsx` | MODIFY — tab layoutId, stagger, skeleton, empty state |

---

## 6. Mobile-First Constraints

- `willChange: 'transform'` di motion.div agar GPU-composited, tidak janky di mobile
- Tidak pakai `overflow: hidden` di page wrapper — bisa break sticky headers
- Semua animasi ≤ 400ms agar tidak lambat di low-end device
- `AnimatePresence mode="wait"` — exit selesai sebelum enter dimulai
