'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { OwnerNav } from '@/components/OwnerNav';
import { LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { PremiumLoginTransition, type PremiumRole } from '@/components/auth/PremiumLoginTransition';

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const [transition, setTransition] = useState<{ role: PremiumRole; name?: string | null } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role !== 'owner') router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('redbox:post-login-transition');
      if (stored) setTransition(JSON.parse(stored));
    } catch {
      sessionStorage.removeItem('redbox:post-login-transition');
    }
  }, []);

  useEffect(() => {
    if (!transition || loading || !user) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem('redbox:post-login-transition');
      setTransition(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [transition, loading, user]);

  if (transition && user) {
    return <PremiumLoginTransition role={transition.role} userName={transition.name || user.name} />;
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#070508' }}>
        <div className="flex flex-col items-center gap-4">
          <motion.div
            className="relative w-12 h-12"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            <Image src="/redbox-logo.png" alt="RedBox" fill className="object-contain" />
          </motion.div>
          <motion.div
            className="w-5 h-px rounded-full"
            style={{ background: '#C72820' }}
            animate={{ scaleX: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-20" style={{ background: '#070508' }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2.5 flex justify-between items-center"
        style={{ background: 'rgba(8,5,9,0.96)', borderColor: '#201618' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative w-7 h-7 shrink-0">
            <Image src="/redbox-logo.png" alt="RedBox" fill className="object-contain" />
          </div>
          <div>
            <h1
              className="font-bold text-[13px] tracking-widest uppercase"
              style={{ color: '#F0EAEB' }}
            >
              RedBox Owner
            </h1>
            {user?.name && (
              <p className="text-[10px] font-medium" style={{ color: '#C72820' }}>
                {user.name}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 transition-colors cursor-pointer"
          style={{ color: '#4A3E40' }}
          aria-label="Keluar"
        >
          <LogOut size={15} />
          <span className="text-xs font-medium">Keluar</span>
        </button>
      </header>

      <main>{children}</main>
      <OwnerNav />
    </div>
  );
}
