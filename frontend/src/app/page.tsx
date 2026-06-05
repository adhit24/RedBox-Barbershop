'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

const ease = [0.16, 1, 0.3, 1] as const;

const roles = [
  { num: 1, label: 'OWNER', href: '/login' },
  { num: 2, label: 'KASIR / ADMIN', href: '/login' },
  { num: 3, label: 'KAPSTER', href: '/barber/login' },
] as const;

export default function RolePickerPage() {
  const router = useRouter();

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: '#070508' }}
    >
      {/* Ambient red glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 45% at 50% -5%, rgba(200,30,20,0.13) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Logo */}
        <motion.div
          className="flex flex-col items-center mb-10"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <p className="text-2xl font-bold tracking-[0.18em] uppercase">
            <span style={{ color: '#FFFFFF' }}>RED</span>
            <span style={{ color: '#C72820' }}>BOX</span>
          </p>
          <div
            className="mt-4 w-10 h-px"
            style={{ background: 'rgba(200,30,20,0.5)' }}
          />
        </motion.div>

        {/* Subtitle */}
        <motion.p
          className="text-center text-[11px] tracking-[0.28em] font-semibold uppercase mb-6"
          style={{ color: '#777' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1, ease }}
        >
          Siapakah Anda?
        </motion.p>

        {/* Role buttons */}
        <motion.div
          className="flex flex-col gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease, delay: 0.15 }}
        >
          {roles.map((role) => (
            <button
              key={role.num}
              onClick={() => router.push(role.href)}
              className="w-full flex items-center gap-4 rounded-xl px-5 py-4 text-sm font-semibold tracking-[0.12em] uppercase transition-all duration-200 text-left"
              style={{ background: 'transparent', border: '1px solid #2a2a2a', color: '#ccc' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#C72820';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#2a2a2a';
                e.currentTarget.style.color = '#ccc';
              }}
            >
              <span
                className="flex items-center justify-center w-7 h-7 rounded-full text-xs flex-shrink-0"
                style={{ border: '1px solid #333', color: '#555' }}
              >
                {role.num}
              </span>
              {role.label}
            </button>
          ))}
        </motion.div>

        {/* Footer */}
        <motion.p
          className="text-center text-[10px] mt-10"
          style={{ color: '#3A3033' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          RedBox Barbershop &mdash; Internal System
        </motion.p>
      </div>
    </div>
  );
}
