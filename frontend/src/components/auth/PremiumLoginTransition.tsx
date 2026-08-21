'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';

export type PremiumRole = 'owner' | 'manager' | 'branch_admin' | 'barber';

const MESSAGES: Record<PremiumRole, string[]> = {
  owner: [
    'Menyiapkan ringkasan bisnis Anda...',
    'Mengecek kondisi stok seluruh cabang...',
    'Merapikan insight penting hari ini...',
  ],
  manager: [
    'Mengecek permintaan dari cabang...',
    'Menyiapkan daftar pekerjaan operasional...',
    'Mengecek transfer yang sedang berjalan...',
  ],
  branch_admin: [
    'Mengecek kondisi stok cabang...',
    'Menyiapkan barang yang perlu perhatian...',
    'Mengecek barang masuk hari ini...',
  ],
  barber: ['Menyiapkan ruang kerja Anda...'],
};

export function PremiumLoginTransition({ role, userName }: { role: PremiumRole; userName?: string | null }) {
  const messages = MESSAGES[role];
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (messages.length < 2) return;
    const timer = window.setInterval(() => setMessageIndex((index) => (index + 1) % messages.length), 850);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  const message = userName && messageIndex === 0
    ? `Menyiapkan dashboard Anda, ${userName}...`
    : messages[messageIndex];

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-hidden px-6"
      style={{ background: '#090707' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
      role="status"
      aria-live="polite"
      aria-label="Menyiapkan dashboard"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 35%, rgba(199,40,32,0.11), transparent 72%)' }} />
      <div className="relative flex w-full max-w-[320px] flex-col items-center text-center">
        <motion.div
          className="relative h-[118px] w-[118px] sm:h-[132px] sm:w-[132px]"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <Image src="/Brand_assets/logo_transparant.png" alt="RedBox" fill priority className="object-contain" sizes="132px" />
        </motion.div>
        <motion.div
          className="relative mt-5 h-[34px] w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.16 }}
        >
          <Image src="/Brand_assets/logo_font.png" alt="RedBox Barbershop" fill priority className="object-contain" sizes="320px" />
        </motion.div>
        <div className="mt-9 h-5 w-full overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={message}
              className="text-[12px] text-[#B8AAAC]"
              initial={{ opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -7 }}
              transition={{ duration: 0.22 }}
            >
              {message}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-[#211B1C]" aria-hidden="true">
          <motion.div
            className="h-full rounded-full bg-[#C72820] shadow-[0_0_12px_rgba(199,40,32,0.65)]"
            animate={{ x: ['-100%', '220%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: '42%' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
