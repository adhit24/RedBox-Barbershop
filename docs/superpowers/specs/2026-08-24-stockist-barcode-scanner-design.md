# RedBox Stockist — Camera Barcode/QR Scanner Design

## Context

RedBox Stockist (Next.js 16/React 19/TypeScript/Tailwind v4 frontend, Express/Supabase backend) is being rebuilt end-to-end to match a Claude Design mockup. This is Plan 5 of that effort — the previous plans (theme/toggle, app shell nav+header, notifications inbox) are shipped and live in production. See `docs/superpowers/plans/2026-08-24-stockist-notifications-inbox.md` for the most recent precedent plan and its conventions.

The user explicitly confirmed real camera-based scanning is required (not a UI-only shell) earlier in this effort. The 38-screen master spec (`Revised Google Stitch Prompt — RedBox Stockist Mobile App (Light Theme, Modern Style, Reference-Based).md`, repo root) lists "Barcode Scanner" as its own screen (§12 table of contents, item 30) but has no dedicated prose section elaborating its UI. The only concrete textual references are:
- §25 STOCK OPNAME: flow step "Cari / Scan Produk", features list includes "barcode scan shortcut"
- §31 COMPONENT SYSTEM: "barcode scanner placeholder" listed as a reusable component

The live Claude Design mockup (`RedBox Stockist.dc.html`) could not be re-fetched in this session — both the DesignSync MCP tool (project not listed under the user's writable design-system projects) and a direct WebFetch (403, authenticated URL) failed to retrieve it. This design therefore works from the master spec doc's stated intent plus this app's own established visual conventions (rounded cards, soft tints, `material-symbols-outlined` icons, Tailwind v4 tokens already defined in `globals.css`) rather than pixel-matching a screen this session could not view. If the mockup becomes reachable in a later session, the scanner sheet's exact visual treatment (frame style, colors, copy) should be reconciled against it then.

Products already have a `barcode` column (`server/migrations/2026-08-15-stockist-inventory-foundation.sql:20`), settable via the existing Tambah/Edit Produk forms. `GET /api/stockist/products` already returns the full product list with no filtering — every page this plan touches already fetches (or can cheaply fetch) that full list, so barcode-to-product matching is a client-side lookup. No backend or database change is needed for this plan.

## Goals

- A reusable full-screen camera scanner component, usable from multiple screens.
- Wired into three screens, confirmed with the user: **Stock Opname** (Cari/Scan Produk step — the one explicitly spec'd integration point), **Product Master** (search-by-scan), and **Terima Barang / Receive Stock form** (Pilih Produk field).
- Decodes both 1D retail barcodes (EAN-13/UPC/Code128 — what's actually printed on RedBox's physical products) and QR codes, since the user's earlier confirmation named "barcode/QR" together.
- Graceful, non-blocking degradation when the camera is unavailable, permission is denied, or a scanned code doesn't match any known product — manual text entry is always available as a fallback, never a dead end.

## Non-Goals

- No backend/database changes. Matching is client-side against already-fetched product data.
- No new "Barcode Scanner" as its own routed page/screen — it is a full-screen overlay/sheet opened from an existing screen, closed back to that screen (matches how the master spec describes it functioning as a *shortcut* within existing flows, not a standalone destination with its own nav entry).
- No support for printing/generating barcodes — scanning existing ones only.
- No offline/service-worker camera caching — this is a live, in-session camera feed only.

## Library Choice

**`@zxing/browser`** (the official ZXing project's browser-targeted JS package), confirmed with the user over the alternative of the native `BarcodeDetector` (Shape Detection API).

Reasoning: `@zxing/browser` decodes both 1D (EAN/UPC/Code128) and 2D (QR, DataMatrix) formats from a raw `<video>` element the app controls directly — meaning the overlay/frame UI can be built to match this app's own visual language rather than being constrained by a pre-styled scanner widget. `BarcodeDetector` is browser-native (faster, zero dependency) but unreliable across the actual device fleet RedBox staff use in-store — notably weak or absent on Safari/iOS historically — and would need a full ZXing fallback path anyway to be safe, which is strictly more code than just using ZXing alone.

## Architecture

### New component: `BarcodeScannerSheet`

`frontend/src/components/stockist/BarcodeScannerSheet.tsx` — a `'use client'` full-screen overlay component:

```tsx
interface BarcodeScannerSheetProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}
```

Internally:
- On `open` becoming true, requests camera access (`BrowserMultiFormatReader.decodeFromVideoDevice` from `@zxing/browser`, preferring the rear/environment-facing camera via `facingMode: 'environment'`) and starts continuous decode against a `<video>` element.
- On a successful decode, calls `onScan(code)` once (debounced/guarded so a held-steady barcode doesn't fire twice), shows a brief success flash, then the parent is responsible for closing the sheet (via `open=false`) after handling the code — the component itself does not auto-close, so the parent can decide whether to show a "not found" toast without the camera view already having vanished mid-feedback.
- Stops the camera stream (`reader.reset()` / stopping tracks) on unmount and whenever `open` flips to false — never leaves a camera light on in the background.
- Renders:
  - Full-bleed `<video>` feed behind a dark semi-transparent overlay with a centered cut-out viewfinder frame (rounded-corner bracket styling, using this app's existing border/radius tokens).
  - Top bar: close button (X, `aria-label="Tutup pemindai"`), title "Scan Barcode".
  - Torch/flashlight toggle button — shown only if the active camera track's `getCapabilities()` reports a `torch` capability; otherwise omitted entirely (never rendered disabled/broken).
  - Instructional copy: "Arahkan kamera ke barcode produk".
  - A "Masukkan kode manual" text button that swaps the camera view for a simple text input + submit button, calling `onScan(value)` on submit — always available regardless of camera state.
  - **Permission-denied state**: if `getUserMedia` rejects with a permission error, replace the camera view with a friendly message ("Akses kamera ditolak. Kamu masih bisa masukkan kode secara manual.") and the manual-entry input, no retry-loop.
  - **Unsupported-context state**: if the browser lacks camera APIs or the page isn't a secure context, same friendly fallback, manual entry only, no attempt to explain browser internals to the user.

### Integration pattern (all three screens)

Each screen adds:
1. A scan icon button (`material-symbols-outlined` `qr_code_scanner` or similar, matching the icon language already used for the header's search/notification buttons) near its existing search/product-picker field.
2. Local `scannerOpen` state, `<BarcodeScannerSheet open={scannerOpen} onClose={...} onScan={handleScan} />`.
3. `handleScan(code)` looks up the code against the screen's already-loaded product list, comparing against each product's `barcode` field (trimmed, case-sensitive exact match — barcodes are numeric/alphanumeric codes, not user-typed free text, so no fuzzy matching is needed). On match, close the sheet and take the screen-specific action below. On no match, close the sheet and show the screen's existing toast/error UI pattern with "Produk dengan barcode ini tidak ditemukan" plus the screen-specific fallback action.

| Screen | On match | On no match |
|---|---|---|
| Stock Opname (Cari/Scan Produk step) | Select that product, advance to Input Stok Fisik for it (identical to tapping it in the existing search-result list) | Toast + stay on the search step |
| Product Master | Navigate to that product's detail/edit view | Toast + a button/link into "Tambah Produk" with the scanned code pre-filled into its barcode field |
| Terima Barang (Receive Stock form) | Auto-select that product in the "Pilih Produk" field | Toast + stay on the form, Pilih Produk unchanged |

No new shared state or context beyond what's described above — each screen owns its own `scannerOpen`/lookup logic, calling into the one shared `BarcodeScannerSheet` component. This mirrors how `EmptyState`/`SkeletonCard` are already reused across screens elsewhere in this app.

## Data Flow

```
User taps scan icon → BarcodeScannerSheet opens → camera decodes a code
  → onScan(code) fires → screen's handleScan() matches code against
    its already-loaded product list (client-side, no new API call)
  → match found  → screen-specific navigation/selection
  → no match     → screen-specific toast + fallback action
```

No backend route is added or modified. No new database column, table, or migration.

## Error Handling

| Condition | Behavior |
|---|---|
| Camera permission denied | Friendly message, manual-entry input shown, sheet stays open |
| No camera / insecure context | Same friendly fallback, manual entry only |
| Torch unsupported | Toggle button not rendered at all (not shown-disabled) |
| Scanned code matches no product | Sheet closes, screen shows its existing toast/error pattern with a screen-specific fallback action (see table above) |
| Decode never happens (user just closes) | No error — closing is a normal, silent action |

## Testing

This repo has no automated test suite (frontend: no `test` script in `package.json`; backend: none either) — established precedent from every prior plan in this effort is `npx tsc --noEmit` for the frontend and `node -c` for any touched backend file (none expected here, since this plan is pure-frontend). Camera behavior itself cannot be verified through type-checking; a manual smoke test on a real device with a real camera (testing all three entry points, the permission-denied path, the manual-entry fallback, and both a matching and non-matching scan) is required before this plan is considered done — flagged explicitly because this is the first camera-dependent feature built in this app this session, unlike prior plans which were fully verifiable through static checks alone.

## Open Question Carried Forward

The live mockup's exact visual treatment of the Barcode Scanner screen was not viewable this session (see Context). If a future session regains access to it (DesignSync project becomes listed, or the share URL becomes fetchable), the `BarcodeScannerSheet`'s frame/overlay styling and copy should be reconciled against it — this is a cosmetic follow-up, not a functional gap, since the design above already delivers the feature's real behavior.
