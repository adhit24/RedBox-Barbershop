'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { AdminNav } from '@/components/AdminNav';
import { LogOut } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();

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
      {/* Header */}
      <header className="bg-[#0A0F1E]/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div>
          <h1 className="font-bold text-white text-sm tracking-wide">REDBOX STAFF</h1>
          {user?.branch && (
            <p className="text-[11px] text-green-400 capitalize font-medium">{user.branch}</p>
          )}
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
          aria-label="Keluar"
        >
          <LogOut size={16} />
          <span className="text-xs">Keluar</span>
        </button>
      </header>

      <main>{children}</main>
      <AdminNav />
    </div>
  );
}
