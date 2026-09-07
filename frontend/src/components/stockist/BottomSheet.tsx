'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sheetBackdrop, sheetPanel } from '@/lib/stockist/motion';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

// Only one BottomSheet is ever open at a time in this app (the owner command
// center drives all of them off a single `drillDown` union state), so a
// fixed id for the heading is safe here.
const TITLE_ID = 'stockist-bottom-sheet-title';

const FOCUSABLE_SELECTOR = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture the triggering element and move focus into the panel on open;
  // restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusTarget = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel;
    focusTarget?.focus();

    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  // Lock body scroll while open so the page behind the sheet doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled')
      );
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // z-[60], not z-50: BottomNavBar (components/ui/bottom-nav-bar.tsx)
          // is `fixed ... z-50` and renders after <main> in the Stockist
          // layout DOM, so at equal z-index it paints (and captures touch)
          // on top of this sheet — the nav visually and interactively ate
          // the lower portion of every sheet. z-[60] matches the same
          // above-nav convention already used by the other Stockist modal
          // in branch-stock/page.tsx.
          className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center bg-black/60"
          variants={sheetBackdrop}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            ref={panelRef}
            // flex column with a non-scrolling header and a separately
            // scrolling body (min-h-0 is required for a flex child to be
            // allowed to shrink below its content size and actually scroll
            // instead of overflowing the column). 85dvh (not vh) so the
            // sheet is sized against the real visible mobile viewport, not
            // the address-bar-collapsed maximum.
            className="w-full sm:max-w-[420px] sm:rounded-2xl rounded-t-2xl bg-surface-elevated border border-border-base max-h-[85dvh] flex flex-col overflow-hidden"
            variants={sheetPanel}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            tabIndex={-1}
          >
            <div className="flex items-center justify-between p-4 border-b border-border-base shrink-0">
              <h3 id={TITLE_ID} className="text-[15px] font-semibold text-text-primary">{title}</h3>
              <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Tutup">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
