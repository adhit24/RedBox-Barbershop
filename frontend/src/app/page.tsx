'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const spring = { type: 'spring', stiffness: 380, damping: 30 } as const;
const ease   = [0.16, 1, 0.3, 1] as const;

const roles = [
  {
    num: '01',
    label: 'OWNER',
    sub: 'Akses penuh & laporan',
    href: '/login?role=owner',
  },
  {
    num: '02',
    label: 'KASIR / ADMIN',
    sub: 'Booking, kasir & operasional',
    href: '/login?role=admin',
  },
  {
    num: '03',
    label: 'KAPSTER',
    sub: 'Jadwal & notifikasi layanan',
    href: '/barber/login',
  },
] as const;

function RoleButton({
  role,
  index,
}: {
  role: (typeof roles)[number];
  index: number;
}) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);

  return (
    <motion.button
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.55, ease, delay: 0.28 + index * 0.09 }}
      whileHover="hovered"
      whileTap={{ scale: 0.975 }}
      onTapStart={() => setPressed(true)}
      onTap={() => { setPressed(false); router.push(role.href); }}
      onTapCancel={() => setPressed(false)}
      onClick={() => router.push(role.href)}
      aria-label={`Login sebagai ${role.label}`}
      className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 text-left relative overflow-hidden cursor-pointer"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Hover fill */}
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        variants={{
          hovered: { opacity: 1 },
          initial: { opacity: 0 },
        }}
        initial="initial"
        transition={{ duration: 0.2 }}
        style={{
          background: 'rgba(199,40,32,0.07)',
          border: '1px solid rgba(199,40,32,0.3)',
          margin: '-1px',
          borderRadius: 'inherit',
          boxShadow: '0 0 24px rgba(199,40,32,0.08)',
        }}
      />

      {/* Number */}
      <motion.span
        className="text-[11px] font-mono font-bold flex-shrink-0 w-7 relative z-10"
        variants={{ hovered: { color: '#C72820' }, initial: { color: '#312530' } }}
        transition={{ duration: 0.2 }}
        style={{ color: '#312530' }}
      >
        {role.num}
      </motion.span>

      {/* Labels */}
      <div className="flex-1 min-w-0 relative z-10">
        <motion.p
          className="text-[13px] font-bold tracking-[0.09em] uppercase"
          variants={{ hovered: { color: '#ffffff' }, initial: { color: '#9a9095' } }}
          transition={{ duration: 0.2 }}
          style={{ color: '#9a9095' }}
        >
          {role.label}
        </motion.p>
        <motion.p
          className="text-[11px] mt-0.5 font-normal"
          variants={{ hovered: { color: 'rgba(255,255,255,0.38)' }, initial: { color: 'rgba(255,255,255,0.18)' } }}
          transition={{ duration: 0.2 }}
          style={{ color: 'rgba(255,255,255,0.18)' }}
        >
          {role.sub}
        </motion.p>
      </div>

      {/* Arrow */}
      <motion.div
        className="relative z-10 flex-shrink-0"
        variants={{ hovered: { x: 3, opacity: 1 }, initial: { x: 0, opacity: 0.25 } }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          variants={{ hovered: { color: '#C72820' }, initial: { color: '#504550' } }}
          style={{ color: '#504550' }}
        >
          <ArrowRight size={13} strokeWidth={2.5} />
        </motion.div>
      </motion.div>
    </motion.button>
  );
}

export default function RolePickerPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: '#060408' }}
    >
      {/* Top radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 100% 55% at 50% -5%, rgba(199,40,32,0.11) 0%, transparent 60%)',
        }}
      />
      {/* Bottom warm shadow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% 110%, rgba(30,8,12,0.7) 0%, transparent 65%)',
        }}
      />

      {/* Glass card */}
      <motion.div
        className="w-full max-w-[390px] relative rounded-[28px] p-8"
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.65, ease }}
        style={{
          background:
            'linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.6), 0 40px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        {/* BETA badge */}
        <motion.div
          className="absolute top-5 right-5 flex items-center gap-1.5 px-3 py-1 rounded-full"
          initial={{ opacity: 0, scale: 0.75, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.65, ease }}
          style={{
            background: 'rgba(199,40,32,0.13)',
            border: '1px solid rgba(199,40,32,0.28)',
            boxShadow: '0 0 12px rgba(199,40,32,0.06)',
          }}
        >
          <motion.span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#C72820' }}
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span
            className="text-[10px] font-bold tracking-[0.18em] uppercase"
            style={{ color: '#E87068' }}
          >
            Beta
          </span>
        </motion.div>

        {/* Logo */}
        <motion.div
          className="mb-7"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease }}
        >
          <h1 className="text-[21px] font-black tracking-[0.24em] uppercase mb-5 select-none">
            <span style={{ color: '#f0ecee' }}>RED</span>
            <span style={{ color: '#C72820' }}>BOX</span>
          </h1>
          <div className="flex items-center gap-3">
            <div
              className="h-px flex-1"
              style={{
                background:
                  'linear-gradient(to right, rgba(199,40,32,0.25), rgba(255,255,255,0.06))',
              }}
            />
            <span
              className="text-[9px] tracking-[0.28em] font-semibold uppercase"
              style={{ color: '#3a3035' }}
            >
              Staff Portal
            </span>
            <div
              className="h-px flex-1"
              style={{
                background:
                  'linear-gradient(to left, rgba(199,40,32,0.25), rgba(255,255,255,0.06))',
              }}
            />
          </div>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          className="text-[10.5px] tracking-[0.26em] font-semibold uppercase mb-5"
          style={{ color: '#403840' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.18, ease }}
        >
          Siapakah Anda?
        </motion.p>

        {/* Role buttons */}
        <div className="flex flex-col gap-2.5">
          {roles.map((role, i) => (
            <RoleButton key={role.num} role={role} index={i} />
          ))}
        </div>

        {/* Footer */}
        <motion.p
          className="text-center text-[10px] mt-8 tracking-[0.08em]"
          style={{ color: '#252028' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.72 }}
        >
          © 2026 RedBox Barbershop
        </motion.p>
      </motion.div>
    </div>
  );
}
