'use client';

import { useToast } from '@/lib/stockist/useToast';

export function ToastHost() {
  const toast = useToast();
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      role="status"
      className="fixed left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-3 text-[13px] font-semibold shadow-lg animate-fade-in"
      style={{ bottom: '96px', background: 'var(--color-text-primary)', color: 'var(--background)' }}
    >
      <span className="material-symbols-outlined text-[18px]">check_circle</span>
      {toast.message}
    </div>
  );
}
