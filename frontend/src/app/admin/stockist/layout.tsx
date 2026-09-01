'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUser } from '@/hooks/useUser';
import { MotionConfig } from 'framer-motion';
import { Home, Boxes, Truck, User, PackageCheck } from 'lucide-react';
import { BottomNavBar, type BottomNavItem } from '@/components/ui/bottom-nav-bar';
import { PremiumLoginTransition, type PremiumRole } from '@/components/auth/PremiumLoginTransition';
import { useStockistTheme } from '@/lib/stockist/useTheme';
import { useUnreadNotificationCount, refreshUnreadCount } from '@/lib/stockist/useUnreadNotifications';
import { ToastHost } from '@/components/stockist/ToastHost';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

// Ordered longest-prefix-first so a more specific route (e.g. "/branch-stock/all")
// matches before a shorter one ("/branch-stock") that would otherwise shadow it.
const HEADER_ROUTES: Array<{ prefix: string; title: string; subtitle?: string }> = [
  { prefix: '/admin/stockist/branch-stock/all', title: 'Semua Stok', subtitle: 'Sebaran per produk' },
  { prefix: '/admin/stockist/branch-stock', title: 'Stok Cabang' },
  { prefix: '/admin/stockist/branches', title: 'Stok Cabang' },
  { prefix: '/admin/stockist/products', title: 'Produk', subtitle: 'Master produk RedBox' },
  { prefix: '/admin/stockist/warehouse', title: 'Gudang Pusat', subtitle: 'Stok pusat & penerimaan' },
  { prefix: '/admin/stockist/transfers', title: 'Transfer' },
  { prefix: '/admin/stockist/requests', title: 'Permintaan Stok' },
  { prefix: '/admin/stockist/returns', title: 'Retur Barang' },
  { prefix: '/admin/stockist/stock-opname', title: 'Stock Opname' },
  { prefix: '/admin/stockist/ledger', title: 'Inventory Ledger' },
  { prefix: '/admin/stockist/insights', title: 'Insight' },
  { prefix: '/admin/stockist/notifications', title: 'Notifikasi' },
  { prefix: '/admin/stockist/profile', title: 'Profil' },
  { prefix: '/admin/stockist/stok', title: 'Stok', subtitle: 'Pilih area yang mau dibuka' },
];

function headerFor(pathname: string, isOwner: boolean, branchLabel: string | null): { title: string; subtitle: string | null; canBack: boolean } {
  if (pathname === '/admin/stockist') {
    return { title: 'Beranda', subtitle: isOwner ? 'Semua lokasi' : branchLabel, canBack: false };
  }
  const match = HEADER_ROUTES.find((r) => pathname.startsWith(r.prefix));
  return { title: match?.title ?? 'RedBox Stockist', subtitle: match?.subtitle ?? null, canBack: true };
}

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useUser();
  const router = useRouter();
  const pathname = usePathname() || '';
  const { theme } = useStockistTheme();
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

  const unreadCount = useUnreadNotificationCount();
  useEffect(() => {
    if (loading || !user) return;
    refreshUnreadCount();
  }, [loading, user]);

  // The login page is rendered inside this layout. Keep children visible while
  // auth is unresolved or absent; middleware still protects server requests,
  // and the client redirect above protects in-app navigation.
  if (loading || !user) {
    return <div data-theme={theme}>{children}</div>;
  }

  if (transition) {
    return (
      <div data-theme={theme}>
        <PremiumLoginTransition role={transition.role} userName={transition.name || user.name} theme={theme} />
      </div>
    );
  }

  const isOwner = user.role === 'owner';
  const branchLabel = user.role === 'branch_admin' ? (BRANCH_NAMES[user.branch || ''] || user.branch || null) : null;

  const ownerTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/stok', icon: Boxes },
    { label: 'Transfer', href: '/admin/stockist/transfers', icon: Truck },
    { label: 'Profil', href: '/admin/stockist/profile', icon: User }
  ];

  const branchAdminTabs: BottomNavItem[] = [
    { label: 'Beranda', href: '/admin/stockist', icon: Home },
    { label: 'Stok', href: '/admin/stockist/branch-stock', icon: Boxes },
    { label: 'Masuk', href: '/admin/stockist/transfers', icon: PackageCheck },
    { label: 'Profil', href: '/admin/stockist/profile', icon: User }
  ];

  const header = headerFor(pathname, isOwner, branchLabel);
  const searchHref = isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock/all';

  return (
    <div data-theme={theme}>
    <MotionConfig reducedMotion="user">
      <div className="bg-surface-container-lowest text-text-primary antialiased min-h-screen">
      {/* TopAppBar */}
      <header
        className="bg-surface-dim fixed top-0 w-full z-50 flex items-center gap-3 px-4 h-[56px] max-w-[430px] left-1/2 -translate-x-1/2 border-b border-border-base"
        style={{ boxShadow: 'var(--shadow2)' }}
      >
        {header.canBack ? (
          <button
            onClick={() => router.back()}
            aria-label="Kembali"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-primary"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative h-[28px] w-[134px] max-w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-black/5">
            <Image
              src="/Brand_assets/wordmark_hitam.png"
              alt="RedBox Barbershop"
              fill
              priority
              className="object-contain px-1.5"
              sizes="134px"
            />
          </div>
          <span className="mt-0.5 truncate text-[10px] font-semibold leading-tight text-text-muted">
            {header.title}{header.subtitle ? ` · ${header.subtitle}` : ''}
          </span>
        </div>
        <button
          onClick={() => router.push(searchHref)}
          aria-label="Cari produk"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">search</span>
        </button>
        <button
          onClick={() => router.push('/admin/stockist/notifications')}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-secondary"
        >
          <span className="material-symbols-outlined text-[19px]">notifications</span>
          {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary-container border border-surface-elevated" />}
        </button>
      </header>

      {/* Main Container */}
      <main className="pt-[calc(56px+16px)] pb-[calc(70px+24px)] px-4 w-full max-w-[430px] mx-auto min-h-screen flex flex-col gap-4">
        {children}
      </main>

      {/* BottomNavBar */}
      <BottomNavBar items={isOwner ? ownerTabs : branchAdminTabs} />
      </div>
    </MotionConfig>
    <ToastHost />
    </div>
  );
}
