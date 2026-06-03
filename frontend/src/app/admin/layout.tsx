'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { AdminNav } from '@/components/AdminNav';
import { LogOut, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const readonly = searchParams.get('readonly') === 'true';

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#020617] flex items-center justify-center">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-slate-500 text-sm"
        >
          Memuat...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#020617] pb-20">
      <header className="bg-[#0A0F1E]/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-2">
          {readonly && (
            <button onClick={() => router.push('/owner/dashboard')}
              className="p-1.5 -ml-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer active:scale-95"
              aria-label="Kembali ke Owner Dashboard">
              <ChevronLeft size={18} />
            </button>
          )}
          <div>
            <h1 className="font-bold text-white text-sm tracking-wide">REDBOX STAFF</h1>
            {user?.branch && (
              <p className="text-[11px] text-green-400 capitalize font-medium">{user.branch}</p>
            )}
          </div>
        </div>
        {readonly ? (
          <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
            Read-only
          </span>
        ) : (
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            aria-label="Keluar"
          >
            <LogOut size={16} />
            <span className="text-xs">Keluar</span>
          </button>
        )}
      </header>

      <main>{children}</main>
      {!readonly && <AdminNav />}
    </div>
  );
}
