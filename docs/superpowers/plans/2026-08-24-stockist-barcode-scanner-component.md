# RedBox Stockist Barcode Scanner Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `BarcodeScannerSheet` component correctly, matching the design handoff's exact §22 spec — replaces an earlier, wrong full-screen-overlay draft that was written before the handoff was found.

**Architecture:** One component file, using `@zxing/browser` (already installed — `frontend/package.json`, from the superseded scanner plan's Task 1) to decode a live camera feed inside a small contained viewport, per §22's exact dimensions/colors/copy. This plan builds and self-verifies the component in isolation — wiring it into consumer screens happens in `docs/superpowers/plans/2026-08-24-stockist-product-lists-consolidation.md`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, `@zxing/browser`.

**Spec:** `docs/superpowers/specs/2026-08-24-stockist-barcode-scanner-design.md` (corrected 2026-08-24 against `design_handoff_stockist_mobile/README.md` §22).

## Global Constraints

- Exact §22 values: viewport 320px / 20px radius / background `#17141480`; inner frame 210px / 22px radius / 2px dashed border `#ffffff66`; `qr_code_2` icon at 52px; caption "Arahkan kamera ke barcode produk"; hint card "Barcode tidak terbaca? Masukkan SKU manual lewat pencarian."; button "Tutup Scanner". No torch control, no inline manual-entry input — closing the sheet returns to the host screen's own search field.
- The scanner must never leave a camera stream running in the background — stop it on close and on unmount, always.
- This repo has no automated test suite. Verification is `npx tsc --noEmit`. Camera behavior itself cannot be verified through type-checking — a manual smoke test on a real device with a real camera is required before this component is considered fully working; flagged as a reminder in Task 1's last step, verified for real once the consolidation plan wires it into a live screen.

---

### Task 1: `BarcodeScannerSheet` component

**Files:**
- Create: `frontend/src/components/stockist/BarcodeScannerSheet.tsx`

**Interfaces:**
- Produces: `<BarcodeScannerSheet open={boolean} onClose={() => void} onScan={(code: string) => void} />` — the consolidation plan imports this from `@/components/stockist/BarcodeScannerSheet`.

- [ ] **Step 1: Verify the installed package's API surface**

Open `frontend/node_modules/@zxing/browser/esm/index.d.ts` (or wherever it re-exports from) and confirm `BrowserMultiFormatReader` and its `decodeFromConstraints(constraints, videoElement, callback)` method exist with the signature this task assumes (returns `Promise<IScannerControls>`, `IScannerControls` has a `.stop()` method). This package was already installed in an earlier plan (`frontend/package.json` already lists `@zxing/browser`), so this step is a confirmation, not an install.

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

type CameraState = 'starting' | 'active' | 'unavailable';

export function BarcodeScannerSheet({ open, onClose, onScan }: BarcodeScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scannedRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>('starting');

  useEffect(() => {
    if (!open) return;

    scannedRef.current = false;
    setCameraState('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
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
      })
      .catch(() => {
        if (cancelled) return;
        setCameraState('unavailable');
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onScan]);

  if (!open) return null;

  const showFeed = cameraState === 'active';

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-black/60 px-6" role="dialog" aria-modal="true">
      <div
        className="relative flex h-[320px] w-[320px] flex-col items-center justify-center overflow-hidden rounded-[20px]"
        style={{ background: '#17141480' }}
      >
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${showFeed ? '' : 'hidden'}`}
          muted
          playsInline
        />
        <div
          className="relative flex h-[210px] w-[210px] items-center justify-center rounded-[22px] border-2 border-dashed"
          style={{ borderColor: '#ffffff66' }}
        >
          {!showFeed && (
            <span className="material-symbols-outlined text-white text-[52px]">qr_code_2</span>
          )}
        </div>
        <span className="absolute bottom-4 px-4 text-center text-[12px] text-white">
          {cameraState === 'unavailable' ? 'Kamera tidak tersedia di perangkat ini.' : 'Arahkan kamera ke barcode produk'}
        </span>
      </div>

      <div className="w-full max-w-[320px] rounded-2xl bg-white/10 p-3.5 text-center text-[12px] text-white">
        Barcode tidak terbaca? Masukkan SKU manual lewat pencarian.
      </div>

      <button
        type="button"
        onClick={onClose}
        className="h-[48px] w-full max-w-[320px] rounded-2xl bg-primary-container font-bold text-white active:scale-95 transition-transform"
      >
        Tutup Scanner
      </button>
    </div>
  );
}
```

(`cameraState` starts `'starting'` and shows the static `qr_code_2` icon with no feed, exactly like the `'unavailable'` state, until the camera stream is actually ready — this is a brief, expected transition state, not a distinct spec-called-out state, so it intentionally shares the icon-only rendering rather than needing its own caption text. Only `'unavailable'` gets the caption changed to explain why nothing is showing.)

- [ ] **Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/stockist/BarcodeScannerSheet.tsx
git commit -m "$(cat <<'EOF'
feat(stockist): rebuild BarcodeScannerSheet to match design handoff §22

Replaces an earlier full-screen-overlay draft written before the
design handoff was found. Matches the exact spec: 320px viewport,
dashed-border frame, qr_code_2 icon, hint card pointing back to
manual search, "Tutup Scanner" button. No torch, no inline
manual-entry input.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual smoke-test reminder**

This component cannot be exercised until it's wired into a real screen (the consolidation plan does that next). Once wired in, a manual test on a real device with a camera is required — this step is a reminder, not something to act on now.

---
