'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBarberSession } from '@/hooks/useBarberSession';
import { BottomNav } from '@/components/BottomNav';
import { LogOut, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';

const BARBER_NAV = [
  { href: '/barber/home',        label: 'Home',    icon: '🏠' },
  { href: '/barber/schedule',    label: 'Jadwal',  icon: '📅' },
  { href: '/barber/leaderboard', label: 'Ranking', icon: '🏆' },
  { href: '/barber/feed',        label: 'Feed',    icon: '📣' },
  { href: '/barber/profile',     label: 'Saya',    icon: '👤' },
];

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  const { data, loading, refresh, signOut } = useBarberSession();
  const router = useRouter();
  const pathname = usePathname();
  const [impersonating, setImpersonating] = useState(false);
  const [routeChecked, setRouteChecked] = useState(false);
  useEffect(() => {
    setImpersonating(document.cookie.split('; ').some(c => c.startsWith('redbox_impersonator=owner')));
  }, []);

  async function exitImpersonation() {
    await fetch('/api/barber/auth/logout', { method: 'POST' }).catch(() => {});
    // marker non-httpOnly: hapus juga dari client untuk jaga-jaga
    document.cookie = 'redbox_impersonator=; Max-Age=0; path=/';
    window.location.href = '/owner/kapster';
  }

  const isPublicBarberPage = pathname === '/barber/login' || pathname === '/barber/setup';

  // The layout stays mounted when OTP login navigates to setup/home. Re-check
  // the session for every protected route so the login page's initial null
  // result cannot be reused after the session cookie has been set.
  useEffect(() => {
    if (isPublicBarberPage) {
      // Reset the protected-route gate when returning to the public auth flow.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRouteChecked(false);
      return;
    }

    let cancelled = false;
    // Gate protected content until this route has a fresh session check.
    setRouteChecked(false);
    void refresh().finally(() => {
      if (!cancelled) setRouteChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isPublicBarberPage, pathname, refresh]);

  useEffect(() => {
    if (loading || !routeChecked || isPublicBarberPage) return;
    if (!data) {
      router.replace('/barber/login');
      return;
    }
    if (!data.profile?.setup_completed) {
      router.replace('/barber/setup');
    }
  }, [data, loading, router, isPublicBarberPage, routeChecked]);

  if (isPublicBarberPage) {
    return <>{children}</>;
  }

  if (loading || (!isPublicBarberPage && !routeChecked)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#070508' }}>
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

  if (!data || !data.profile?.setup_completed) {
    return null;
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: '#070508' }}>
      {impersonating && (
        <button
          onClick={exitImpersonation}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold cursor-pointer"
          style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068', borderBottom: '1px solid rgba(199,40,32,0.25)' }}
        >
          <ArrowLeft size={13} />
          Mode Owner — Kembali ke Owner
        </button>
      )}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2.5 flex justify-between items-center"
        style={{ background: 'rgba(8,5,9,0.96)', borderColor: '#201618' }}
      >
        <div className="flex items-center gap-3">
          {data.profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.profile.avatar_url}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
              style={{ border: '2px solid #261E20' }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{
                background: 'rgba(199,40,32,0.15)',
                border: '1px solid rgba(199,40,32,0.25)',
                color: '#E87068',
              }}
            >
              {data.barber.name[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div>
            <h1 className="font-bold text-sm" style={{ color: '#F0EAEB' }}>
              {data.barber.name}
            </h1>
            <p className="text-[10px] capitalize font-medium" style={{ color: '#C72820' }}>
              {data.barber.branch}
            </p>
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
      <BottomNav items={BARBER_NAV} />
    </div>
  );
}
