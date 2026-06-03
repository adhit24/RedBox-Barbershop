'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';

const ease = [0.16, 1, 0.3, 1] as const; // expo ease-out

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Email atau password salah');
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Login gagal'); setLoading(false); return; }

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'barber') {
      router.push('/barber/schedule');
    } else {
      router.push('/admin/dashboard');
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: '#070508' }}
    >
      {/* Ambient red glow — top center */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 45% at 50% -5%, rgba(200,30,20,0.13) 0%, transparent 70%)',
        }}
      />
      {/* Subtle noise texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
        }}
      />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Logo + brand */}
        <motion.div
          className="flex flex-col items-center mb-10"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <div className="w-20 h-20 mb-5 relative">
            <Image
              src="/redbox-logo.png"
              alt="RedBox"
              fill
              className="object-contain"
              priority
            />
          </div>
          <p
            className="text-[11px] tracking-[0.28em] font-semibold uppercase"
            style={{ color: '#7A6A6D' }}
          >
            Staff Dashboard
          </p>
          {/* Thin divider */}
          <div
            className="mt-4 w-10 h-px"
            style={{ background: 'rgba(200,30,20,0.5)' }}
          />
        </motion.div>

        {/* Form */}
        <motion.form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease, delay: 0.12 }}
        >
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-[11px] tracking-[0.12em] uppercase font-semibold"
              style={{ color: '#5A4E50' }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="nama@redboxbarbershop.com"
              className="w-full rounded-xl px-4 py-3.5 text-sm outline-none transition-all duration-200 placeholder:text-[#3A3033]"
              style={{
                background: '#130E10',
                border: '1px solid #261E20',
                color: '#F0EAEB',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = '#C72820';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(199,40,32,0.10)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = '#261E20';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[11px] tracking-[0.12em] uppercase font-semibold"
              style={{ color: '#5A4E50' }}
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••••"
                className="w-full rounded-xl px-4 py-3.5 pr-12 text-sm outline-none transition-all duration-200 placeholder:text-[#3A3033]"
                style={{
                  background: '#130E10',
                  border: '1px solid #261E20',
                  color: '#F0EAEB',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = '#C72820';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(199,40,32,0.10)';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = '#261E20';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
                style={{ color: '#5A4E50' }}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs font-medium rounded-lg px-3.5 py-2.5"
                style={{
                  background: 'rgba(199,40,32,0.12)',
                  border: '1px solid rgba(199,40,32,0.25)',
                  color: '#F07068',
                }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold tracking-wide transition-all duration-200 mt-1 disabled:opacity-60"
            style={{
              background: loading ? '#8A1E18' : '#C72820',
              color: '#FFF0EF',
            }}
            whileTap={{ scale: 0.98 }}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <span>Masuk</span>
                <ArrowRight size={15} />
              </>
            )}
          </motion.button>
        </motion.form>

        {/* Footer */}
        <motion.p
          className="text-center text-[10px] mt-8"
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
