'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sheetBackdrop, sheetPanel } from '@/lib/stockist/motion';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60"
          variants={sheetBackdrop}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="w-full sm:max-w-[420px] sm:rounded-2xl rounded-t-2xl bg-surface-elevated border border-border-base max-h-[80vh] overflow-y-auto"
            variants={sheetPanel}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-base sticky top-0 bg-surface-elevated">
              <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
              <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Tutup">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
