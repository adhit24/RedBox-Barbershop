# RedBox Stockist Barcode/QR Scanner Implementation Plan

**SUPERSEDED 2026-08-24.** Task 1 (dependency + `barcode` type field) completed and remains valid — do not redo it. Tasks 2-6 below are stale: Task 2's `BarcodeScannerSheet` design was written before `design_handoff_stockist_mobile/` was found and doesn't match the corrected spec (see `docs/superpowers/specs/2026-08-24-stockist-barcode-scanner-design.md`, corrected 2026-08-24) or its real successor plan `docs/superpowers/plans/2026-08-24-stockist-barcode-scanner-component.md`. Tasks 3 and 5 (Product Master, Semua Stok integration) are superseded by `docs/superpowers/plans/2026-08-24-stockist-product-lists-consolidation.md`, which restructures those same screens and wires the scanner in as part of that restructuring. Tasks 4 and 6 (Terima Barang, Stock Opname integration) remain queued for when those screens get their own dedicated rebuilds later in the roadmap (`docs/superpowers/specs/2026-08-24-stockist-design-handoff-gap-audit.md`) — do not execute them against this plan's stale line-number references; write fresh task briefs against whatever those screens look like at that time.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, camera-based barcode/QR scanner to RedBox Stockist, wired into four existing screens (Product Master, Terima Barang, Semua Stok/Stok Cabang, Stock Opname).

**Architecture:** One reusable full-screen `BarcodeScannerSheet` component (built on `@zxing/browser`) opened from a scan button/icon on each of the four screens. Each screen matches the decoded code against its own already-loaded product list (client-side, via each product's `barcode` field) and takes a screen-specific action on match/no-match. No backend or database change.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, `@zxing/browser` (new dependency).

**Spec:** `docs/superpowers/specs/2026-08-24-stockist-barcode-scanner-design.md`

## Global Constraints

- No backend or database change — barcode matching is 100% client-side against product lists every target screen already fetches.
- `@zxing/browser` is the only new dependency (confirmed with the user over the native `BarcodeDetector` API — unreliable on Safari/iOS).
- The scanner must never leave a camera stream running in the background — stop it on close and on unmount, always.
- Manual text entry must always be available as a fallback, regardless of camera/permission state — never a dead end.
- Torch/flashlight toggle only renders when the active camera track reports the capability — never shown broken/disabled.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` (frontend-only plan, no backend files touched, so no `node -c` needed). A manual smoke test on a real device with a real camera is required before this plan is considered fully done — flagged explicitly in Task 6.
- The exact visual chrome (viewfinder frame style, dark overlay, "Scan barcode produk" button placement above the Stock Opname product list) is based on real screenshots of the Claude Design mockup the user shared directly in this session — match them, not the earlier design spec's placeholder assumptions.

---

### Task 1: Add `@zxing/browser` dependency and the `barcode` field to `StockistProduct`

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/stockistApi.ts:2-15` (the `StockistProduct` interface)

**Interfaces:**
- Produces: `StockistProduct.barcode: string | null` — every later task's barcode-matching logic reads this field.

- [ ] **Step 1: Install the dependency**

Run: `cd frontend && npm install @zxing/browser@^0.2.1`

- [ ] **Step 2: Add the `barcode` field to the product type**

The backend already returns `barcode` on every product (`server/routes/stockist.js` does `select('*')` on the `products` table, which has a `barcode TEXT` column per `server/migrations/2026-08-15-stockist-inventory-foundation.sql:20`) — the frontend type just doesn't declare it yet. In `frontend/src/lib/stockistApi.ts`, change:

```ts
export interface StockistProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  purchase_price?: number | null;
```

to:

```ts
export interface StockistProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  barcode: string | null;
  purchase_price?: number | null;
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (adding an optional-shaped-as-required field with `| null` is safe since every real API response already includes it; existing code that builds `StockistProduct` object literals — e.g. any test fixtures — would need `barcode` too, so re-run and check for any such literal the type-checker flags).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/stockistApi.ts
git commit -m "$(cat <<'EOF'
feat(stockist): add @zxing/browser dependency and product barcode field

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Build the reusable `BarcodeScannerSheet` component

**Files:**
- Create: `frontend/src/components/stockist/BarcodeScannerSheet.tsx`

**Interfaces:**
- Consumes: `@zxing/browser`'s `BrowserMultiFormatReader` and `IScannerControls` (installed in Task 1).
- Produces: `<BarcodeScannerSheet open={boolean} onClose={() => void} onScan={(code: string) => void} />` — every later task imports this from `@/components/stockist/BarcodeScannerSheet`.

- [ ] **Step 1: Verify the installed package's torch-control method signature**

`@zxing/browser`'s README documents a `switchTorch()` method on the controls object returned from `decodeFromConstraints`/`decodeFromVideoDevice`, but doesn't spell out its exact parameter signature. Before writing Step 2's code, open `frontend/node_modules/@zxing/browser/esm/index.d.ts` (or wherever it re-exports `IScannerControls` from — check its `index.d.ts` and follow any re-export) and find the real signature of `switchTorch`. If it takes a boolean argument (`switchTorch(onOff: boolean): Promise<void>`), the code in Step 2 below is correct as written. If it takes no arguments (toggles internally) or returns something other than `Promise<void>`, adjust the `toggleTorch` function in Step 2 to match the real signature exactly — do not guess if the two disagree.

- [ ] **Step 2: Write the component**

```tsx
// frontend/src/components/stockist/BarcodeScannerSheet.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';

interface BarcodeScannerSheetProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

type CameraState = 'starting' | 'active' | 'denied' | 'unsupported';

export function BarcodeScannerSheet({ open, onClose, onScan }: BarcodeScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scannedRef = useRef(false);

  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  useEffect(() => {
    if (!open) return;

    scannedRef.current = false;
    setCameraState('starting');
    setManualMode(false);
    setManualValue('');
    setTorchOn(false);
    setTorchAvailable(false);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
      return;
    }

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result) => {
          if (result && !scannedRef.current) {
            scannedRef.current = true;
            onScan(result.getText());
          }
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCameraState('active');

        const stream = videoRef.current?.srcObject;
        if (stream instanceof MediaStream) {
          const [track] = stream.getVideoTracks();
          const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
          if (capabilities?.torch) setTorchAvailable(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          setCameraState('denied');
        } else {
          setCameraState('unsupported');
        }
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onScan]);

  if (!open) return null;

  async function toggleTorch() {
    if (!controlsRef.current) return;
    try {
      await controlsRef.current.switchTorch(!torchOn);
      setTorchOn((v) => !v);
    } catch {
      // non-fatal — a failed torch toggle shouldn't block scanning
    }
  }

  function submitManual() {
    const value = manualValue.trim();
    if (!value) return;
    onScan(value);
  }

  const showCamera = !manualMode && cameraState !== 'denied' && cameraState !== 'unsupported';

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 h-[56px] shrink-0">
        <button
          onClick={onClose}
          aria-label="Tutup pemindai"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
        <span className="text-white text-[14px] font-semibold">Scan Barcode</span>
        {torchAvailable ? (
          <button
            onClick={toggleTorch}
            aria-label="Nyalakan senter"
            className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${torchOn ? 'bg-primary-container' : 'bg-white/10'}`}
          >
            <span className="material-symbols-outlined text-[20px]">{torchOn ? 'flash_on' : 'flash_off'}</span>
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {showCamera && (
          <>
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
            <div className="relative h-56 w-56 rounded-2xl border-2 border-white/80" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
            <p className="absolute bottom-24 left-0 right-0 text-center text-white text-[13px] px-8">
              Arahkan kamera ke barcode produk
            </p>
          </>
        )}

        {!showCamera && (
          <div className="w-full max-w-[320px] px-6 flex flex-col gap-3 text-center">
            {cameraState === 'denied' && (
              <p className="text-white text-[13px]">Akses kamera ditolak. Kamu masih bisa masukkan kode secara manual.</p>
            )}
            {cameraState === 'unsupported' && (
              <p className="text-white text-[13px]">Kamera tidak tersedia di perangkat ini. Masukkan kode secara manual.</p>
            )}
            <input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
              placeholder="Masukkan kode barcode"
              className="w-full bg-white/10 border border-white/30 rounded-lg px-3 py-2.5 text-white text-sm text-center placeholder:text-white/50 focus:outline-none focus:border-white"
            />
            <button
              onClick={submitManual}
              className="w-full bg-primary-container text-white font-semibold text-sm h-[44px] rounded-lg"
            >
              Cari Produk
            </button>
          </div>
        )}
      </div>

      {showCamera && (
        <button
          onClick={() => setManualMode(true)}
          className="shrink-0 h-[56px] text-white text-[13px] font-semibold"
        >
          Masukkan kode manual
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. If Step 1 found `switchTorch` has a different signature than `(onOff: boolean) => Promise<void>`, this is where a mismatch would surface — fix `toggleTorch` to match, not the type declaration.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/BarcodeScannerSheet.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): add reusable camera barcode/QR scanner sheet

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire scanning into Product Master (`products/page.tsx`)

**Files:**
- Modify: `frontend/src/app/admin/stockist/products/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>` (Task 2), `StockistProduct.barcode` (Task 1).

This file has two views in one component: the default branch_admin view (lines 15-578, its search input at lines 331-340) and `OwnerInventoryView` (lines 588-665, its search input at line 638). Both get a scan button added to their existing search bar.

- [ ] **Step 1: Add the import and scan state to the branch_admin view**

Add near the top of the file, after the existing imports:

```ts
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

Inside `ProductsPage` (the default export function), alongside the other `useState` calls near the top (after the `togglingId` state declaration), add:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
```

- [ ] **Step 2: Add the scan handler to the branch_admin view**

After the `refresh` function definition (and before `useEffect(() => { refresh(); }, []);`), add:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setSearchQuery(match.sku);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

- [ ] **Step 3: Add the scan icon to the branch_admin search bar and render the sheet**

Change the search input block (around line 331-340) from:

```tsx
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nama atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
```

to:

```tsx
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari nama atau SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted transition-colors"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
        <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

(Note: `pl-9 pr-4` became `pl-9 pr-10` to make room for the new right-side icon button.)

- [ ] **Step 4: Add scanning to `OwnerInventoryView`**

`OwnerInventoryView` (starting line 588) is a separate function component in the same file with its own state and its own search input. Add its own scan state, near its other `useState` calls:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
```

Add a scan handler after the component's `useEffect` block that loads data:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setQuery(match.sku);
      setExpandedId(match.id);
    } else {
      setError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

Change the owner search input (line 638) from:

```tsx
        <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); setExpandedId(null); }} placeholder="Cari produk atau SKU" className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-primary-container placeholder:text-text-muted" />
```

to:

```tsx
        <div className="relative">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); setExpandedId(null); }} placeholder="Cari produk atau SKU" className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:border-primary-container placeholder:text-text-muted" />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
        <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

- [ ] **Step 5: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/admin/stockist/products/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): wire barcode scanning into Product Master search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire scanning into Terima Barang (`warehouse/page.tsx`)

**Files:**
- Modify: `frontend/src/app/admin/stockist/warehouse/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>` (Task 2), `StockistProduct.barcode` (Task 1).

A scan matched to a product auto-selects it in the "Pilih Produk" `<select>` of the Receive Stock form. This form is only shown to `isOwner` (line 107: `{isOwner && showForm && (...)}`), so the scan button only needs to appear inside that same block.

- [ ] **Step 1: Add the import and scan state**

Add near the top of the file:

```ts
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

Inside `WarehousePage`, alongside the other `useState` calls (after `const [formError, setFormError] = useState<string | null>(null);`), add:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
```

- [ ] **Step 2: Add the scan handler**

After the `handleReceive` function definition, add:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code && p.is_active);
    if (match) {
      setForm((f) => ({ ...f, product_id: match.id }));
    } else {
      setFormError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

- [ ] **Step 3: Add the scan button next to "Pilih Produk" and render the sheet**

Change the "Pilih Produk" field block (around line 192-207) from:

```tsx
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-text-secondary">Pilih Produk *</label>
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2.5 text-text-primary focus:outline-none focus:border-primary-container"
                required
              >
                <option value="">-- Pilih produk --</option>
                {products.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
```

to:

```tsx
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-text-secondary">Pilih Produk *</label>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-primary-container"
                >
                  <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
                  Scan
                </button>
              </div>
              <select
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
                className="w-full bg-surface-container-lowest border border-border-base rounded-lg px-3 py-2.5 text-text-primary focus:outline-none focus:border-primary-container"
                required
              >
                <option value="">-- Pilih produk --</option>
                {products.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
            <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/warehouse/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): wire barcode scanning into Terima Barang product picker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire scanning into Semua Stok / Stok Cabang (`branch-stock/all/page.tsx`)

**Files:**
- Modify: `frontend/src/app/admin/stockist/branch-stock/all/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>` (Task 2), `StockistProduct.barcode` (Task 1).

This matches the mockup screenshot the user shared directly: a scan icon inside this screen's own search bar (this page is what the mockup calls "Stok Cabang").

- [ ] **Step 1: Add the import and scan state**

Add near the top of the file:

```ts
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

Inside `SemuaStokContent`, alongside the other `useState` calls (after `const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);`), add:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
```

- [ ] **Step 2: Add the scan handler**

After the `toggleBrandCollapse` function definition (just before the `return (` of the component), add:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const match = products.find((p) => p.barcode && p.barcode === code);
    if (match) {
      setScanError(null);
      setSearchQuery(match.sku);
      setVisibleCount(PRODUCT_PAGE_SIZE);
    } else {
      setScanError('Produk dengan barcode ini tidak ditemukan.');
    }
  }
```

- [ ] **Step 3: Add the scan icon to the search bar and render the sheet + error banner**

Change the search bar block (lines 253-264) from:

```tsx
      {/* Search & Filter Bar */}
      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); }}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
        </div>
```

to:

```tsx
      {/* Search & Filter Bar */}
      <section className="flex gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
          <input
            type="text"
            placeholder="Cari produk atau SKU"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PRODUCT_PAGE_SIZE); setScanError(null); }}
            className="w-full bg-surface-container-lowest border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2 focus:outline-none focus:border-primary-container placeholder:text-text-muted transition-colors"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode produk"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-primary-container hover:bg-primary-container/10"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
          </button>
        </div>
```

(`pl-9 pr-4` becomes `pl-9 pr-10` for the same reason as Task 3.)

Immediately after that `</section>` closing tag (still before the products listing further down), add:

```tsx
      {scanError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{scanError}</span>
        </div>
      )}

      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/branch-stock/all/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): wire barcode scanning into Semua Stok search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire scanning into Stock Opname (`stock-opname/[id]/page.tsx`)

**Files:**
- Modify: `frontend/src/app/admin/stockist/stock-opname/[id]/page.tsx`

**Interfaces:**
- Consumes: `<BarcodeScannerSheet>` (Task 2), `StockistProduct.barcode` (Task 1).

The mockup screenshot the user shared shows a full-width "Scan barcode produk" button sitting above the product list, inside the same session (not a separate search step — this page's `items` are already the fixed set of products being counted for this opname). A scan locates the matching item, scrolls it into view, and briefly highlights it so the person can enter its physical count immediately. Only shown while counting is in progress (`canCount`).

- [ ] **Step 1: Add the import and scan state**

Add near the top of the file:

```ts
import { BarcodeScannerSheet } from '@/components/stockist/BarcodeScannerSheet';
```

Inside `StockOpnameDetailPage`, alongside the other `useState` calls (after `const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});`), add:

```ts
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
```

Add `useRef` to the existing React import at the top of the file — change:

```ts
import { useEffect, useState, use as usePromise } from 'react';
```

to:

```ts
import { useEffect, useRef, useState, use as usePromise } from 'react';
```

- [ ] **Step 2: Add the scan handler**

After the `handleCancel` function definition (and before the `if (loading) {` early return), add:

```ts
  function handleScan(code: string) {
    setScannerOpen(false);
    const product = products.find((p) => p.barcode && p.barcode === code);
    const item = product ? items.find((i) => i.product_id === product.id) : undefined;
    if (item) {
      setScanError(null);
      itemRefs.current[item.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedItemId(item.id);
      setTimeout(() => setHighlightedItemId((current) => (current === item.id ? null : current)), 1500);
    } else {
      setScanError('Produk dengan barcode ini tidak ada di sesi opname ini.');
    }
  }
```

- [ ] **Step 3: Add the scan button above the product list, the ref callback on each item card, and the highlight style**

Change the section header + button that currently precedes the item list (around lines 210-217) from:

```tsx
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Produk</h3>
        <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">
          {items.length} Item
        </span>
      </div>

      <div className="flex flex-col gap-3">
```

to:

```tsx
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Produk</h3>
        <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">
          {items.length} Item
        </span>
      </div>

      {canCount && (
        <button
          onClick={() => setScannerOpen(true)}
          className="w-full bg-surface-elevated border border-border-base text-text-primary font-semibold text-sm h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px] text-primary-container">qr_code_scanner</span>
          Scan barcode produk
        </button>
      )}

      {scanError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{scanError}</span>
        </div>
      )}

      <BarcodeScannerSheet open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} />

      <div className="flex flex-col gap-3">
```

Change the item card's opening `<div>` (around line 229) from:

```tsx
            <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
```

to:

```tsx
            <div
              key={item.id}
              ref={(el) => { itemRefs.current[item.id] = el; }}
              className={`bg-surface-elevated border rounded-xl p-4 flex flex-col gap-3 transition-colors ${
                highlightedItemId === item.id ? 'border-primary-container' : 'border-border-base'
              }`}
            >
```

- [ ] **Step 4: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/stockist/stock-opname/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): wire barcode scanning into Stock Opname product list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Manual smoke test reminder**

None of the six tasks above can be fully verified by `tsc --noEmit` alone — camera access, permission prompts, and actual barcode decoding only exist at runtime on a real device. Before this plan is considered done, manually test on a real phone/tablet with a camera: opening the scanner from all four entry points, scanning a real barcode that matches a seeded product, scanning one that doesn't, denying camera permission and confirming the manual-entry fallback still works, and confirming the camera stops (no lingering camera-in-use indicator) after closing the sheet each time.

---
