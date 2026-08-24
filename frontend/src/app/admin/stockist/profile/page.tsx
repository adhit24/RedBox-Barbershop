'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { useStockistTheme } from '@/lib/stockist/useTheme';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

interface ProfileRow {
  key: string;
  icon: string;
  label: string;
  value: string;
  onClick?: () => void;
}

export default function ProfilePage() {
  const { user, signOut } = useUser();
  const router = useRouter();
  const { theme, toggleTheme } = useStockistTheme();
  if (!user) return null;

  const isOwner = user.role === 'owner';
  const branchLabel = user.role === 'branch_admin' ? (BRANCH_NAMES[user.branch || ''] || user.branch || '-') : null;
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const rows: ProfileRow[] = [
    {
      key: 'org',
      icon: 'apartment',
      label: isOwner ? 'Organisasi' : 'Cabang',
      value: isOwner ? 'RedBox Barbershop Indonesia' : `${branchLabel} · terkunci`,
    },
    { key: 'status', icon: 'verified_user', label: 'Status akun', value: 'Aktif · terverifikasi' },
    {
      key: 'theme',
      icon: theme === 'light' ? 'dark_mode' : 'light_mode',
      label: 'Tampilan',
      value: theme === 'light' ? 'Mode terang' : 'Mode gelap',
      onClick: toggleTheme,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border-base bg-surface-elevated p-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-container text-[16px] font-bold text-white">
          {initials}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold text-text-primary">{user.name}</span>
          <span className="truncate text-[11px] text-text-muted">{user.email}</span>
          <span className="mt-1 w-fit rounded-full bg-primary-container/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-container">
            {isOwner ? 'Owner' : branchLabel}
          </span>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border-base overflow-hidden rounded-2xl border border-border-base bg-surface-elevated">
        {rows.map((row) => {
          const content = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">{row.icon}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                <span className="text-[12px] font-semibold text-text-primary">{row.label}</span>
                <span className="truncate text-[11px] text-text-muted">{row.value}</span>
              </span>
            </>
          );
          return row.onClick ? (
            <button key={row.key} onClick={row.onClick} className="flex items-center gap-3 p-3.5 text-left hover:bg-surface-container-high transition-colors">
              {content}
            </button>
          ) : (
            <div key={row.key} className="flex items-center gap-3 p-3.5">
              {content}
            </div>
          );
        })}
      </div>

      {!isOwner && (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[12px] font-bold text-text-primary">Menu lainnya</span>
          <div className="flex flex-col divide-y divide-border-base overflow-hidden rounded-2xl border border-border-base bg-surface-elevated">
            <Link href="/admin/stockist/requests" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Permintaan Stok</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
            <Link href="/admin/stockist/ledger" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Riwayat Ledger</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
            <Link href="/admin/stockist/returns" className="flex items-center gap-3 p-3.5 hover:bg-surface-container-high transition-colors">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-text-secondary">
                <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
              </span>
              <span className="flex-1 text-[12px] font-semibold text-text-primary">Retur Barang</span>
              <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
            </Link>
          </div>
        </div>
      )}

      <button
        onClick={() => {
          if (confirm('Keluar dari aplikasi?')) {
            signOut();
            router.replace('/admin/stockist/login');
          }
        }}
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-danger/30 text-[13px] font-bold text-danger"
      >
        <span className="material-symbols-outlined text-[19px]">logout</span>
        Keluar
      </button>
    </div>
  );
}
