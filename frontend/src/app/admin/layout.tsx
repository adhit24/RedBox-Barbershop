'use client';
import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { AdminNav } from '@/components/AdminNav';
import { LogOut, ChevronLeft, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import type { AppUser } from '@/hooks/useUser';

function AdminShell({ children, user, signOut, signingOut }: {
  children: React.ReactNode;
  user: AppUser | null;
  signOut: () => Promise<void>;
  signingOut: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const readonly = searchParams.get('readonly') === 'true';

  return (
    <div className="min-h-dvh pb-20" style={{ background: '#070508' }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2.5 flex justify-between items-center"
        style={{ background: 'rgba(8,5,9,0.96)', borderColor: '#201618' }}
      >
        <div className="flex items-center gap-2.5">
          {readonly && (
            <button
              onClick={() => router.push('/owner/dashboard')}
              className="p-1.5 -ml-1.5 rounded-xl transition-all active:scale-95 cursor-pointer"
              style={{ color: '#5A4E50' }}
              aria-label="Kembali ke Owner Dashboard"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div className="relative w-7 h-7 shrink-0">
            <Image src="/redbox-logo.png" alt="RedBox" fill className="object-contain" />
          </div>
          <div>
            <h1
              className="font-bold text-[13px] tracking-widest uppercase"
              style={{ color: '#F0EAEB' }}
            >
              RedBox Staff
            </h1>
            {user?.branch && (
              <p className="text-[10px] capitalize font-medium" style={{ color: '#C72820' }}>
                {user.branch}
              </p>
            )}
          </div>
        </div>

        {readonly ? (
          <span
            className="text-[10px] px-2.5 py-1 rounded-full font-medium"
            style={{
              background: '#1C1416',
              color: '#5A4E50',
              border: '1px solid #261E20',
            }}
          >
            Read-only
          </span>
        ) : (
          <button
            onClick={signOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            style={{ color: signingOut ? '#C72820' : '#4A3E40' }}
            aria-label="Keluar"
          >
            {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
            <span className="text-xs font-medium">{signingOut ? 'Keluar...' : 'Keluar'}</span>
          </button>
        )}
      </header>

      <main>{children}</main>
      {!readonly && <AdminNav />}
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, signingOut } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role === 'owner') router.replace('/owner/dashboard');
    if (!loading && user && user.role === 'barber') router.replace('/barber/schedule');
  }, [user, loading, router]);

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
    <Suspense>
      <AdminShell user={user} signOut={signOut} signingOut={signingOut}>
        {children}
      </AdminShell>
    </Suspense>
  );
}
