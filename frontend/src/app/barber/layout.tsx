'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { usePush } from '@/hooks/usePush';
import { BottomNav } from '@/components/BottomNav';

const BARBER_NAV = [
  { href: '/barber/schedule',      label: 'Jadwal',    icon: '📅' },
  { href: '/barber/home-service',  label: 'Home Svc',  icon: '🏠' },
  { href: '/barber/notifications', label: 'Notifikasi', icon: '🔔' },
];

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  usePush();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role !== 'barber') router.replace('/admin/dashboard');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Memuat...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-gray-900">{user?.name ?? 'Barber'}</h1>
          <p className="text-xs text-gray-500 capitalize">{user?.branch}</p>
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
