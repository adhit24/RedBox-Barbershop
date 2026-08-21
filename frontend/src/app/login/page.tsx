'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';

const ease = [0.16, 1, 0.3, 1] as const;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleIntent = searchParams.get('role'); // 'owner' | 'admin' | null

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
      .select('role, name')
      .eq('id', user.id)
      .single();

    const actualRole = profile?.role;

    // Kapster dengan akun Supabase → barber portal
    if (actualRole === 'barber') {
      sessionStorage.setItem('redbox:post-login-transition', JSON.stringify({ role: 'barber', name: profile?.name || null }));
      router.push('/barber/schedule');
      return;
    }

    // Admin/kasir mencoba jalur Owner → tolak
    if (roleIntent === 'owner' && actualRole !== 'owner') {
      await supabase.auth.signOut();
      setError('Akun ini tidak memiliki akses Owner. Silakan gunakan jalur Kasir / Admin.');
      setLoading(false);
      return;
    }

    // Owner → selalu ke owner dashboard (akses penuh sudah di sana)
    if (actualRole === 'owner') {
      sessionStorage.setItem('redbox:post-login-transition', JSON.stringify({ role: 'owner', name: profile?.name || null }));
      router.push('/owner/dashboard');
      return;
    }

    // branch_admin → admin dashboard
    sessionStorage.setItem('redbox:post-login-transition', JSON.stringify({ role: 'branch_admin', name: profile?.name || null }));
    router.push('/admin/dashboard');
  }

  const roleLabel = roleIntent === 'owner' ? 'Owner' : roleIntent === 'admin' ? 'Kasir / Admin' : null;

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
        {/* BETA badge */}
        <motion.div
          className="absolute top-0 right-0 flex items-center gap-1.5 px-3 py-1 rounded-full"
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
            BETA 1.2
          </span>
        </motion.div>

        {/* Logo + brand */}
        <motion.div
          className="flex flex-col items-center mb-10"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <div className="relative mb-5 h-[86px] w-[86px]">
            <Image
              src="/Brand_assets/logo_transparant.png"
              alt="RedBox"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div className="relative h-[38px] w-full max-w-[320px]">
            <Image src="/Brand_assets/logo_font.png" alt="RedBox Barbershop" fill className="object-contain" priority sizes="320px" />
          </div>
          <p className="mt-6 text-[22px] font-semibold tracking-[-0.02em] text-[#F5EEEE]">Selamat datang kembali</p>
          <p className="mt-2 max-w-[280px] text-center text-[12px] leading-relaxed text-[#786D6F]">Masuk untuk melanjutkan ke sistem RedBox.</p>
          <p
            className="mt-5 text-[10px] tracking-[0.28em] font-semibold uppercase"
            style={{ color: '#7A6A6D' }}
          >
            {roleLabel ?? 'Staff Dashboard'}
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
            {loading ? <><Loader2 size={16} className="animate-spin" /><span>Memproses...</span></> : <><span>Masuk</span><ArrowRight size={15} /></>}
          </motion.button>
        </motion.form>

        {/* Back to role picker */}
        <motion.button
          onClick={() => router.push('/')}
          className="w-full text-center text-[11px] mt-5 tracking-[0.08em] transition-colors cursor-pointer"
          style={{ color: '#3A3033' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          whileHover={{ color: '#7A6A6D' } as never}
        >
          ← Ganti role
        </motion.button>

        {/* Footer */}
        <motion.p
          className="text-center text-[10px] mt-4"
          style={{ color: '#2A2428' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          RedBox Barbershop &mdash; Internal System
        </motion.p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
