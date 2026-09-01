'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { CoreSpinLoader } from '@/components/ui/core-spin-loader';

export type PremiumRole = 'owner' | 'manager' | 'branch_admin' | 'barber';

const THEME_STYLES = {
  dark: { background: '#090707', mutedText: '#786D6F' },
  light: { background: '#F7F7F5', mutedText: '#9D9494' },
} as const;

export function PremiumLoginTransition({
  role,
  userName,
  theme = 'dark',
}: {
  role: PremiumRole;
  userName?: string | null;
  theme?: 'dark' | 'light';
}) {
  const styles = THEME_STYLES[theme];
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-hidden px-6"
      style={{ background: styles.background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
      role="status"
      data-role={role}
      aria-live="polite"
      aria-label="Menyiapkan dashboard"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 35%, rgba(199,40,32,0.11), transparent 72%)' }} />
      <div className="relative flex w-full max-w-[320px] flex-col items-center text-center">
        <motion.div
          className="relative h-[132px] w-[132px] sm:h-[146px] sm:w-[146px]"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <Image src="/Brand_assets/logo_hitam_trnsparan.png" alt="Logo RedBox Barbershop" fill priority className="object-contain p-3" sizes="146px" />
        </motion.div>
        <motion.div
          className="relative mt-5 h-[56px] w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.16 }}
        >
          <Image src="/Brand_assets/wordmark_hitam.png" alt="RedBox Barbershop" fill priority className="object-contain px-2 py-1" sizes="320px" />
        </motion.div>
        <div className="mt-7 w-full">
          <CoreSpinLoader />
        </div>
        {userName && <p className="-mt-4 text-[11px]" style={{ color: styles.mutedText }}>Menyiapkan ruang kerja, {userName}...</p>}
      </div>
    </motion.div>
  );
}
