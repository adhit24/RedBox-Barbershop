# RedBox Stockist — Camera Barcode/QR Scanner Design

## Context

RedBox Stockist (Next.js 16/React 19/TypeScript/Tailwind v4 frontend, Express/Supabase backend) is being rebuilt end-to-end to match a Claude Design mockup. This is Plan 5 of that effort — the previous plans (theme/toggle, app shell nav+header, notifications inbox) are shipped and live in production. See `docs/superpowers/plans/2026-08-24-stockist-notifications-inbox.md` for the most recent precedent plan and its conventions.

The user explicitly confirmed real camera-based scanning is required (not a UI-only shell) earlier in this effort. The 38-screen master spec (`Revised Google Stitch Prompt — RedBox Stockist Mobile App (Light Theme, Modern Style, Reference-Based).md`, repo root) lists "Barcode Scanner" as its own screen (§12 table of contents, item 30) but has no dedicated prose section elaborating its UI. The only concrete textual references are:
- §25 STOCK OPNAME: flow step "Cari / Scan Produk", features list includes "barcode scan shortcut"
- §31 COMPONENT SYSTEM: "barcode scanner placeholder" listed as a reusable component

**Superseded 2026-08-24:** the `design_handoff_stockist_mobile/` folder (README.md §22 "Scan Barcode") was found mid-session and is now the authoritative source for this screen's exact visual treatment — the "Architecture" section below has been corrected to match it exactly, replacing the earlier full-screen-overlay guess this doc originally contained (written before the handoff was found, when only the thinner Stitch-prompt doc and no mockup access were available). §22's exact text: "Viewport 320px radius 20px latar gelap `#17141480`, di tengahnya kotak 210px radius 22px border dashed 2px `#ffffff66` dengan ikon `qr_code_2` 52px. Caption bawah 'Arahkan kamera ke barcode produk'. Di bawah viewport: card hint 'Barcode tidak terbaca? Masukkan SKU manual lewat pencarian.' dan tombol 'Tutup Scanner'. Bottom nav disembunyikan di layar ini."

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
- On `open` becoming true, requests camera access (`BrowserMultiFormatReader.decodeFromConstraints` from `@zxing/browser`, preferring the rear/environment-facing camera via `facingMode: 'environment'`) and starts continuous decode against a `<video>` element.
- On a successful decode, calls `onScan(code)` once (guarded so a held-steady barcode doesn't fire twice) — the parent is responsible for closing the sheet after handling the code.
- Stops the camera stream on unmount and whenever `open` flips to false — never leaves a camera light on in the background.
- Renders, matching §22 exactly:
  - A centered **320px** viewport, **20px radius**, background `#17141480` (dark, semi-transparent) — not a full-bleed overlay.
  - Inside it, a centered **210px** box, **22px radius**, **2px dashed border** in `#ffffff66`, containing a `qr_code_2` icon at **52px** (shown when the camera hasn't produced a frame yet / as the resting icon inside the frame) with the live camera feed as the viewport's background once active.
  - Caption below the frame, inside the viewport: **"Arahkan kamera ke barcode produk"**.
  - Below the viewport (outside it, as its own element): a **hint card** reading **"Barcode tidak terbaca? Masukkan SKU manual lewat pencarian."** — this is informational text pointing the user back to the host screen's own search field, not an inline text-entry form. There is no in-sheet manual-entry input; closing the scanner (via the button below) returns to the host screen, where the user can type into the search bar they already have.
  - A **"Tutup Scanner"** button below the hint card that calls `onClose`.
  - The screen's bottom nav is hidden while this sheet is open — since it's rendered as a fixed-position overlay above everything (`z-[70]`, matching this app's other full-screen sheets), it already visually covers the bottom nav; no separate hide-logic is needed.
  - **Permission-denied / unsupported-context state**: no dedicated alternate layout — the same frame/hint-card/button structure renders regardless; if `getUserMedia` fails (denied or unsupported), the `<video>` simply never gets a stream, so the frame shows just the static `qr_code_2` icon with no live feed behind it, and the hint card's copy is supplemented with one short line noting the camera isn't available (exact wording is an implementation-task detail, not specified in §22, since the mockup doesn't distinguish this state visually — closing and using the search bar always remains the path forward either way).
  - No torch/flashlight control — not part of §22's spec for this screen (the earlier draft of this doc invented one before the handoff was found; dropped).

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
| Camera permission denied | Frame shows no live feed (just the static `qr_code_2` icon), hint card notes the camera isn't available, "Tutup Scanner" returns to the host screen's own search field |
| No camera / insecure context | Same as above |
| Scanned code matches no product | Sheet closes, screen shows its existing toast/error pattern with a screen-specific fallback action (see table above) |
| Decode never happens (user just closes) | No error — closing is a normal, silent action |

## Testing

This repo has no automated test suite (frontend: no `test` script in `package.json`; backend: none either) — established precedent from every prior plan in this effort is `npx tsc --noEmit` for the frontend and `node -c` for any touched backend file (none expected here, since this plan is pure-frontend). Camera behavior itself cannot be verified through type-checking; a manual smoke test on a real device with a real camera (testing all three entry points, the permission-denied path, the manual-entry fallback, and both a matching and non-matching scan) is required before this plan is considered done — flagged explicitly because this is the first camera-dependent feature built in this app this session, unlike prior plans which were fully verifiable through static checks alone.

## Resolved (was: Open Question Carried Forward)

The live mockup's exact visual treatment (§22) is now known via the design handoff and is fully incorporated into the Architecture section above — no open question remains.
