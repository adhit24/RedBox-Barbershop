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
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
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
            onScanRef.current(result.getText());
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
  }, [open]);

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
