'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export interface BackButtonProps {
  fallbackHref: string;
  label?: string;
  className?: string;
}

// router.back() alone silently fails (or exits the app) when the page was
// opened directly — a deep link, a fresh tab, a PWA icon tap. history.length
// is an imperfect but standard heuristic for "is there anything to go back
// to in this tab" — good enough to fall back to a safe, known-good route.
export function BackButton({ fallbackHref, label = 'Kembali', className = '' }: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex items-center gap-1.5 -ml-2 min-h-[44px] px-2 rounded-lg text-text-secondary hover:text-text-primary active:scale-95 transition-all ${className}`}
    >
      <ArrowLeft size={18} strokeWidth={2.4} />
      <span className="text-[13px] font-semibold">{label}</span>
    </button>
  );
}
