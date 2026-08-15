'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { motion } from 'framer-motion';

export default function StockistLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        throw new Error('Email atau password salah');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Login gagal');
      }

      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      const actualRole = profile?.role;

      if (actualRole !== 'owner' && actualRole !== 'branch_admin') {
        await supabase.auth.signOut();
        throw new Error('Akun Anda tidak memiliki akses ke aplikasi Stockist');
      }

      // Successful login -> Redirect to stockist home
      router.replace('/admin/stockist');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden bg-surface-container-lowest text-text-primary max-w-[430px] mx-auto border-x border-border-base shadow-[0_4px_24px_rgba(0,0,0,0.6)]">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary-container/10 via-transparent to-transparent"></div>
      
      <div className="w-full relative z-10 flex flex-col gap-6 p-6 rounded-2xl bg-surface-elevated border border-border-base shadow-lg">
        {/* Header */}
        <div className="text-center flex flex-col gap-1">
          <span className="material-symbols-outlined text-[36px] text-primary-container animate-pulse">inventory_2</span>
          <h1 className="text-[20px] font-black tracking-widest uppercase font-display mt-2">
            RED<span className="text-primary-container">BOX</span> STOCKIST
          </h1>
          <p className="text-[11px] text-text-muted">Aplikasi logistik &amp; distribusi cabang</p>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger text-danger text-[12px] rounded-lg p-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Email Admin</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">mail</span>
              <input
                type="email"
                placeholder="admin@redbox.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
                required
              />
            </div>
          </div>

          {/* Password input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Kata Sandi</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">lock</span>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#171415] border border-border-base text-text-primary text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container placeholder:text-text-muted"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728] mt-2"
          >
            <span className="material-symbols-outlined text-[18px]">login</span>
            {loading ? 'Masuk...' : 'Masuk Aplikasi'}
          </button>
        </form>

        <p className="text-center text-[10px] text-text-muted font-mono mt-2">
          © 2026 RedBox Barbershop
        </p>
      </div>
    </div>
  );
}
