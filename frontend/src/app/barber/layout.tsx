'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBarberSession } from '@/hooks/useBarberSession';
import { BottomNav } from '@/components/BottomNav';

const BARBER_NAV = [
  { href: '/barber/home',        label: 'Home',    icon: '🏠' },
  { href: '/barber/schedule',    label: 'Jadwal',  icon: '📅' },
  { href: '/barber/leaderboard', label: 'Ranking', icon: '🏆' },
  { href: '/barber/feed',        label: 'Feed',    icon: '📣' },
  { href: '/barber/profile',     label: 'Saya',    icon: '👤' },
];

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  const { data, loading, signOut } = useBarberSession();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicBarberPage = pathname === '/barber/login' || pathname === '/barber/setup';

  useEffect(() => {
    if (loading || isPublicBarberPage) return;
    if (!data) {
      router.replace('/barber/login');
      return;
    }
    if (!data.profile?.setup_completed) {
      router.replace('/barber/setup');
    }
  }, [data, loading, router, isPublicBarberPage]);

  if (isPublicBarberPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Memuat...</div>
      </div>
    );
  }

  if (!data || !data.profile?.setup_completed) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {data.profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.profile.avatar_url}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">👤</div>
          )}
          <div>
            <h1 className="font-bold text-gray-900">{data.barber.name}</h1>
            <p className="text-xs text-gray-500 capitalize">{data.barber.branch}</p>
          </div>
        </div>
        <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-700">
          Keluar
        </button>
      </header>
      <main>{children}</main>
      <BottomNav items={BARBER_NAV} />
    </div>
  );
}
