'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, PackageCheck, ClipboardList, History, LayoutDashboard, Building2, Lightbulb } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';
import { PremiumLoginTransition, type PremiumRole } from '@/components/auth/PremiumLoginTransition';

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
  const [transition, setTransition] = useState<{ role: PremiumRole; name?: string | null } | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/admin/stockist/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const readTransition = () => {
      try {
      const stored = sessionStorage.getItem('redbox:post-login-transition');
      if (stored) setTransition(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem('redbox:post-login-transition');
      }
    };
    readTransition();
    window.addEventListener('redbox:login-complete', readTransition);
    return () => window.removeEventListener('redbox:login-complete', readTransition);
  }, [user?.id, loading]);

  useEffect(() => {
    if (!transition || loading || !user) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem('redbox:post-login-transition');
      setTransition(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [transition, loading, user]);

  // The login page is rendered inside this layout. Keep children visible while
  // auth is unresolved or absent; middleware still protects server requests,
  // and the client redirect above protects in-app navigation.
  if (loading || !user) return <>{children}</>;

  if (transition) {
    return <PremiumLoginTransition role={transition.role} userName={transition.name || user.name} />;
  }

  const isOwner = user.role === 'owner';

  const ownerTabs: BottomNavItem[] = [
    { label: 'Ringkasan', href: '/admin/stockist', icon: LayoutDashboard },
    { label: 'Cabang', href: '/admin/stockist/branch-stock', icon: Building2, activePrefixes: ['/admin/stockist/branch-stock', '/admin/stockist/branches'] },
    { label: 'Insight', href: '/admin/stockist/insights', icon: Lightbulb }
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
