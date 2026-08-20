'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, PackageCheck, ClipboardList, History, ArrowLeft } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const pathname = usePathname() || '';

  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/admin/stockist/login');
    }
  }, [user, loading, router]);

  // The login page is rendered inside this layout. Keep children visible while
  // auth is unresolved or absent; middleware still protects server requests,
  // and the client redirect above protects in-app navigation.
  if (loading || !user) return <>{children}</>;

  const isOwner = user.role === 'owner';

  // Owner gets a single command-center destination — no flow/technical tabs
  // (Produk, Gudang, Transfer, Permintaan) cluttering the nav. Those pages
  // still exist and are reachable via links inside the command center; this
  // one tab just doubles as the "back to command center" anchor when owner
  // is a level deep on one of those pages.
  const isCommandCenterHome = pathname === '/admin/stockist';
  const ownerTabs: BottomNavItem[] = [
    { label: 'Command Center', href: '/admin/stockist', icon: isCommandCenterHome ? Home : ArrowLeft }
  ];

  const branchAdminTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/branch-stock', icon: Boxes },
    { label: 'Barang Masuk', href: '/admin/stockist/transfers', icon: PackageCheck },
    { label: 'Permintaan', href: '/admin/stockist/requests', icon: ClipboardList },
    { label: 'Riwayat', href: '/admin/stockist/ledger', icon: History }
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="bg-surface-container-lowest text-text-primary antialiased min-h-screen">
      {/* TopAppBar */}
      <header className="bg-surface-dim fixed top-0 w-full z-50 flex justify-between items-center px-4 h-[48px] shadow-[0_4px_24px_rgba(0,0,0,0.6)] max-w-[430px] left-1/2 -translate-x-1/2 border-b border-border-base">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary-container text-[20px] ml-1">inventory_2</span>
          <span className="font-bold text-[15px] tracking-wider uppercase text-text-primary">
            RedBox Stockist
          </span>
        </div>
        <div className="flex items-center gap-2">
          {user.role === 'owner' && (
            <span className="text-[9px] bg-primary-container/20 text-accent-soft px-2 py-0.5 rounded font-semibold tracking-wide uppercase border border-primary-container/30">
              Owner
            </span>
          )}
          {user.role === 'branch_admin' && (
            <span className="text-[9px] bg-primary-container/20 text-accent-soft px-2 py-0.5 rounded font-semibold tracking-wide uppercase border border-primary-container/30">
              {BRANCH_NAMES[user.branch || ''] || user.branch}
            </span>
          )}
          <button 
            onClick={() => {
              if (confirm('Keluar dari aplikasi?')) {
                signOut();
                router.replace('/admin/stockist/login');
              }
            }}
            className="text-text-muted hover:text-text-primary transition-colors flex items-center justify-center w-8 h-8 rounded-full"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="pt-[calc(48px+16px)] pb-[calc(70px+24px)] px-4 w-full max-w-[430px] mx-auto min-h-screen flex flex-col gap-4">
        {children}
      </main>

      {/* BottomNavBar */}
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
      </div>
    </MotionConfig>
  );
}
