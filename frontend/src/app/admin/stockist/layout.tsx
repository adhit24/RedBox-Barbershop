'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import Link from 'next/link';

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
  const ownerTabs = [
    {
      label: 'Command Center',
      icon: isCommandCenterHome ? 'hub' : 'arrow_back',
      href: '/admin/stockist',
      active: isCommandCenterHome
    }
  ];

  const branchAdminTabs = [
    {
      label: 'Beranda',
      icon: 'home',
      href: '/admin/stockist',
      active: pathname === '/admin/stockist'
    },
    {
      label: 'Stok Saya',
      icon: 'inventory',
      href: '/admin/stockist/branch-stock',
      active: pathname.startsWith('/admin/stockist/branch-stock')
    },
    {
      label: 'Transfer',
      icon: 'receipt_long',
      href: '/admin/stockist/transfers',
      active: pathname.startsWith('/admin/stockist/transfers')
    },
    {
      label: 'Permintaan',
      icon: 'assignment',
      href: '/admin/stockist/requests',
      active: pathname.startsWith('/admin/stockist/requests')
    }
  ];

  const tabs = isOwner ? ownerTabs : branchAdminTabs;

  return (
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
      <nav className="bg-surface-container-highest fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] flex justify-around items-center px-4 py-2 z-50 rounded-t-xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)] border-t border-border-base">
        {isOwner ? (
          // Owner has one destination, not a tab bar — a wide anchor pill
          // that reads as "you're here" on the command center and "go back"
          // one level deep, rather than a lonely stacked icon mimicking a tab.
          <Link
            href={tabs[0].href}
            className={`flex items-center justify-center gap-2 rounded-full px-6 py-2 w-full transition-all duration-200 ${
              tabs[0].active
                ? 'text-primary-container font-bold bg-primary-container/10'
                : 'text-text-secondary hover:text-primary-container active:scale-95'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: tabs[0].active ? "'FILL' 1" : "'FILL' 0" }}>
              {tabs[0].icon}
            </span>
            <span className="text-[13px] tracking-tight font-semibold">{tabs[0].label}</span>
          </Link>
        ) : (
          tabs.map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              className={`flex flex-col items-center justify-center rounded-xl px-4 py-1.5 transition-all duration-200 min-w-[64px] ${
                tab.active
                  ? 'text-primary-container font-bold bg-primary-container/10 scale-95'
                  : 'text-text-secondary hover:text-primary-container active:scale-95'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: tab.active ? "'FILL' 1" : "'FILL' 0" }}>
                {tab.icon}
              </span>
              <span className="text-[10px] mt-0.5 tracking-tight font-medium">{tab.label}</span>
            </Link>
          ))
        )}
      </nav>
    </div>
  );
}
