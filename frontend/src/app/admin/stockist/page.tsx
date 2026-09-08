'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@/hooks/useUser';
import type { AppUser } from '@/hooks/useUser';
import Link from 'next/link';
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getTransfer,
  getAssetDashboard,
  getServiceUsage,
  getMokaSyncStatus,
  type InventoryBalance,
  type StockTransfer,
  type StockTransferItem,
  type StockistAssetDashboard,
  type AssetLocationSummary,
  type ServiceUsage,
  type MokaSyncOutletStatus
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { LocationCard } from '@/components/stockist/LocationCard';
import { ListRow, type ListRowData } from '@/components/stockist/ListRow';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';
import { LocationDrillDownContent } from '@/components/stockist/LocationDrillDownContent';
import { QuickActionGrid } from '@/components/stockist/QuickActionGrid';
import { ProductAttentionRow, type ProductAttentionRowData } from '@/components/stockist/ProductAttentionRow';
import { staggerContainer, fadeSlideItem } from '@/lib/stockist/motion';
import { formatCurrency } from '@/lib/stockist/format';
import { getKnownProductImage } from '@/lib/stockist/productImage';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

// Approximation pending real per-product-category expected-duration data
// (backend has no such field yet — only `opened_at`). Generic thresholds
// applied uniformly to every active barang pemakaian, not the true
// "fleksibel per jenis barang" the design brief asks for; documented here
// as a known simplification, not a precise estimate.
const USAGE_CHECK_THRESHOLD_DAYS = 14;
const USAGE_OVERDUE_THRESHOLD_DAYS = 30;

type UsageEstimateStatus = 'NORMAL' | 'PERLU_DICEK' | 'MELEWATI_ESTIMASI';

function daysActive(openedAt: string): number {
  return Math.floor((Date.now() - new Date(openedAt).getTime()) / 86_400_000);
}

function usageEstimateStatus(days: number): UsageEstimateStatus {
  if (days >= USAGE_OVERDUE_THRESHOLD_DAYS) return 'MELEWATI_ESTIMASI';
  if (days >= USAGE_CHECK_THRESHOLD_DAYS) return 'PERLU_DICEK';
  return 'NORMAL';
}

const getGreeting = () => {
  const hr = new Date().getHours();
  if (hr < 12) return 'Selamat pagi';
  if (hr < 17) return 'Selamat siang';
  return 'Selamat malam';
};

export default function StockistDashboard() {
  const { user } = useUser();
  if (!user) return null;
  return user.role === 'owner' ? <OwnerCommandCenter user={user} /> : <BranchAdminDashboard user={user} />;
}

// ---------------------------------------------------------------------------
// Owner: Command Center
//
// Read-only, company-wide, primarily link-out — the owner nav collapsed to
// a single tab (see layout.tsx), so this screen is the sole hub for reaching
// every other stockist page. It never mutates data itself. KPI drill-down
// (location SKU breakdown, full attention list, full transfer list) opens
// in a BottomSheet for a quick look; every sheet still offers a link-out to
// the full page for taking action. Sourced entirely from the company-wide
// `assets` endpoint — never mixes warehouse and branch figures into one
// number, and never scopes to a single "selected" location the way the old
// per-branch dropdown did.
// ---------------------------------------------------------------------------

type DrillDown =
  | { type: 'location'; location: AssetLocationSummary }
  | { type: 'attention' }
  | null;

function toAttentionRows(items: StockistAssetDashboard['attention_items']): ListRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    href: '/admin/stockist/products',
    icon: item.reason === 'OUT_OF_STOCK' ? 'error' : 'inventory_2',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    title: item.product_name,
    subtitle: `${item.product_sku} · ${item.location_name}`,
    trailing: item.reason === 'OUT_OF_STOCK' ? 'Habis' : `${item.quantity} tersisa`,
  }));
}

function locationBarColorClass(location: AssetLocationSummary): string {
  if (location.type === 'warehouse') return 'bg-primary-container';
  const name = location.location_name;
  if (name.includes('Bypass')) return 'bg-accent-soft';
  if (name.includes('CSB')) return 'bg-info';
  if (name.includes('Samadikun')) return 'bg-warning';
  if (name.includes('Sumber')) return 'bg-success';
  if (name.includes('Tegal')) return 'bg-text-muted';
  return 'bg-primary-container';
}

function toProductAttentionRows(items: StockistAssetDashboard['attention_items']): ProductAttentionRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    name: item.product_name,
    meta: `${item.product_sku} · ${item.location_name}`,
    statusLabel: item.reason === 'OUT_OF_STOCK' ? 'Habis' : 'Menipis',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    trailing: String(item.quantity),
    trailingUnit: 'pcs',
    href: '/admin/stockist/products',
  }));
}

type MokaSyncSummary = {
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  lastSyncAt: string | null;
  processed: number;
  unmapped: number;
  errors: number;
};

function summarizeMokaSync(outlets: MokaSyncOutletStatus[]): MokaSyncSummary {
  if (outlets.length === 0) return { status: null, lastSyncAt: null, processed: 0, unmapped: 0, errors: 0 };
  const statuses = outlets.map((o) => o.last_status);
  const status: MokaSyncSummary['status'] = statuses.includes('FAILED')
    ? 'FAILED'
    : statuses.includes('PARTIAL')
    ? 'PARTIAL'
    : statuses.every((s) => s === 'SUCCESS') ? 'SUCCESS' : (statuses.find((s) => s) ?? null);
  const timestamps = outlets.map((o) => o.last_successful_sync_at).filter(Boolean) as string[];
  const lastSyncAt = timestamps.length
    ? timestamps.reduce((latest, t) => (new Date(t) > new Date(latest) ? t : latest))
    : null;
  return {
    status,
    lastSyncAt,
    processed: outlets.reduce((sum, o) => sum + o.sales_applied, 0),
    unmapped: outlets.reduce((sum, o) => sum + o.unmapped_items, 0),
    errors: outlets.filter((o) => o.last_status === 'FAILED').length,
  };
}

const MOKA_SYNC_STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Berhasil', PARTIAL: 'Perlu Perhatian', FAILED: 'Gagal', RUNNING: 'Berjalan',
};

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'Belum pernah';
  const date = new Date(iso);
  return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} WIB`;
}

function OwnerCommandCenter({ user }: { user: AppUser }) {
  const [assets, setAssets] = useState<StockistAssetDashboard | null>(null);
  const [activeProductCount, setActiveProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);
  const [mokaSync, setMokaSync] = useState<MokaSyncOutletStatus[] | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getAssetDashboard(), listProducts()])
      .then(([assetData, productData]) => {
        setAssets(assetData);
        setActiveProductCount(productData.products.filter((product) => product.is_active).length);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat command center');
      })
      .finally(() => setLoading(false));

    // Secondary, non-blocking — Moka sync status must never break the
    // asset dashboard itself if this call fails.
    getMokaSyncStatus().then((data) => setMokaSync(data.outlets)).catch(() => setMokaSync([]));
  }, []);

  const totalStockUnits = assets ? assets.asset_by_location.reduce((sum, l) => sum + l.total_quantity, 0) : 0;
  const maxLocationValue = assets ? Math.max(0, ...assets.asset_by_location.map((l) => l.total_asset_value ?? 0)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="text-[22px] font-bold text-text-primary leading-tight font-display">
          {getGreeting()}, {user.name}
        </h2>
        <div className="flex items-center gap-3 text-text-muted text-[12px] font-medium font-body-secondary">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">apartment</span>
            Dashboard Aset Stok · Semua lokasi
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </section>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <SkeletonCard className="min-h-[120px]" />
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonCard className="min-h-[220px]" />
        </div>
      ) : assets ? (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="flex flex-col gap-6">
          <motion.div variants={fadeSlideItem}>
            {/* heroTrend intentionally omitted — the API has no period-over-period
                delta to show a real percentage; do not fabricate one if a future
                change reintroduces this prop. heroStats below are real, already-
                fetched numbers, not fabricated. */}
            <StatCard
              label="Aset Stok RedBox"
              value={assets.total_asset_value ?? 0}
              formatter={formatCurrency}
              variant="hero"
              hint="Total nilai stok aktif di seluruh jaringan RedBox."
              heroStats={[
                { label: 'Lokasi', value: String(assets.asset_by_location.length) },
                { label: 'SKU aktif', value: String(activeProductCount) },
                { label: 'Unit', value: totalStockUnits.toLocaleString('id-ID') },
              ]}
            />
          </motion.div>

          <motion.div variants={fadeSlideItem} className="grid grid-cols-2 gap-3">
            <StatCard label="Total Produk" value={activeProductCount} icon="category" tint="info" hint="SKU aktif" href="/admin/stockist/products" />
            <StatCard label="Total Stok" value={totalStockUnits} icon="inventory_2" tint="success" hint="unit di semua lokasi" href="/admin/stockist/warehouse" />
            <StatCard
              label="Produk Menipis"
              value={assets.attention_items.filter((item) => item.location_name === 'Gudang Pusat').length}
              icon="warning"
              tint="warning"
              hint="perlu restock"
              href="/admin/stockist/warehouse?filter=MENIPIS"
            />
            <StatCard
              label="Transfer Berjalan"
              value={assets.active_transfers.length}
              icon="local_shipping"
              tint="danger"
              hint="belum diterima"
              href="/admin/stockist/transfers"
            />
          </motion.div>

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <h3 className="text-[13px] font-bold text-text-primary px-1">Aksi cepat</h3>
            <QuickActionGrid
              actions={[
                { key: 'receive', href: '/admin/stockist/warehouse', icon: 'move_to_inbox', label: 'Terima Barang' },
                { key: 'transfer', href: '/admin/stockist/transfers/new', icon: 'send', label: 'Buat Transfer' },
                { key: 'ledger', href: '/admin/stockist/ledger', icon: 'receipt_long', label: 'Lihat Ledger' },
                { key: 'branch-stock', href: '/admin/stockist/branch-stock', icon: 'storefront', label: 'Stok Cabang' },
              ]}
            />
          </motion.section>

          {mokaSync && mokaSync.length > 0 && (() => {
            const summary = summarizeMokaSync(mokaSync);
            const tone = summary.status === 'FAILED' ? 'danger' : summary.status === 'PARTIAL' ? 'warning' : 'success';
            const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-success';
            return (
              <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
                <Link
                  href="/admin/stockist/moka-sync"
                  className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2.5 active:scale-[0.99] transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">sync</span>
                      Sinkronisasi Moka
                    </h3>
                    <span className={`text-[11px] font-semibold ${toneClass}`}>
                      {summary.status ? MOKA_SYNC_STATUS_LABEL[summary.status] : 'Belum sync'}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted">Last Sync: {formatSyncTime(summary.lastSyncAt)}</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[16px] font-bold text-text-primary tabular-nums">{summary.processed}</div>
                      <div className="text-[9px] text-text-muted uppercase tracking-wide">Diproses</div>
                    </div>
                    <div>
                      <div className={`text-[16px] font-bold tabular-nums ${summary.unmapped > 0 ? 'text-warning' : 'text-text-primary'}`}>{summary.unmapped}</div>
                      <div className="text-[9px] text-text-muted uppercase tracking-wide">Unmapped</div>
                    </div>
                    <div>
                      <div className={`text-[16px] font-bold tabular-nums ${summary.errors > 0 ? 'text-danger' : 'text-text-primary'}`}>{summary.errors}</div>
                      <div className="text-[9px] text-text-muted uppercase tracking-wide">Errors</div>
                    </div>
                  </div>
                </Link>
              </motion.section>
            );
          })()}

          <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-[13px] font-bold text-text-primary">Perlu perhatian</h3>
              {assets.attention_items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDrillDown({ type: 'attention' })}
                  className="text-[11px] font-semibold text-primary-container"
                >
                  Lihat semua
                </button>
              )}
            </div>
            {assets.attention_items.length === 0 ? (
              <EmptyState icon="check_circle" title="Semua terkendali" subtitle="Tidak ada yang perlu ditindaklanjuti sekarang." />
            ) : (
              <div className="flex flex-col gap-2.5">
                {toProductAttentionRows(assets.attention_items.slice(0, 3)).map((row) => (
                  <ProductAttentionRow key={row.key} row={row} />
                ))}
              </div>
            )}
          </motion.section>

          {assets.asset_by_location.length > 0 ? (
            <motion.section variants={fadeSlideItem} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[13px] font-bold text-text-primary">Aset per lokasi</h3>
                <span className="text-[10px] text-text-muted">{assets.asset_by_location.length} lokasi</span>
              </div>
              <div className="bg-surface-elevated border border-border-base rounded-xl p-1 divide-y divide-border-base">
                {assets.asset_by_location.map((location) => (
                  <LocationCard
                    key={location.location_id}
                    location={location}
                    formatValue={formatCurrency}
                    maxValue={maxLocationValue}
                    barColorClass={locationBarColorClass(location)}
                    onSelect={() => setDrillDown({ type: 'location', location })}
                  />
                ))}
              </div>
            </motion.section>
          ) : null}
        </motion.div>
      ) : null}

      <BottomSheet
        open={drillDown?.type === 'location'}
        onClose={() => setDrillDown(null)}
        title={drillDown?.type === 'location' ? drillDown.location.location_name : ''}
      >
        {drillDown?.type === 'location' && (
          <LocationDrillDownContent locationId={drillDown.location.location_id} locationName={drillDown.location.location_name} />
        )}
      </BottomSheet>

      <BottomSheet open={drillDown?.type === 'attention'} onClose={() => setDrillDown(null)} title="Barang Perlu Perhatian">
        {assets && assets.attention_items.length > 0 ? (
          <div className="flex flex-col divide-y divide-border-base -m-4">
            {toAttentionRows(assets.attention_items).map((row) => (
              <ListRow key={row.key} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check_circle" title="Semua terkendali" subtitle="Tidak ada yang perlu ditindaklanjuti sekarang." />
        )}
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branch admin: Beranda (unchanged from prior behavior)
// ---------------------------------------------------------------------------

function formatTransferSentAt(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${datePart} · ${timePart} WIB`;
}

function BranchAdminDashboard({ user }: { user: AppUser }) {
  const [branch, setBranch] = useState<string>('');
  const [products, setProducts] = useState<any[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [activeUsages, setActiveUsages] = useState<ServiceUsage[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<StockTransfer | null>(null);
  const [pendingItems, setPendingItems] = useState<StockTransferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBranch(user.branch || 'warehouse');
  }, [user]);

  useEffect(() => {
    if (!branch) return;
    setLoading(true);
    Promise.all([
      listProducts(),
      getInventorySummary(branch),
      listTransfers(),
      getServiceUsage(branch)
    ])
      .then(([{ products }, { balances }, { transfers }, serviceData]) => {
        setProducts(products);
        setBalances(balances);
        setTransfers(transfers);
        setActiveUsages(serviceData.usages.filter((u) => u.status === 'IN_USE' && u.branch === branch));
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat data dashboard');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [branch]);

  useEffect(() => {
    const sent = transfers
      .filter((t) => t.status === 'SENT')
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    const latest = sent[0] ?? null;
    setPendingTransfer(latest);
    if (!latest) {
      setPendingItems([]);
      return;
    }
    getTransfer(latest.id)
      .then(({ items }) => setPendingItems(items))
      .catch(() => setPendingItems([]));
  }, [transfers]);

  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  const lowStockItems = products.map(p => {
    const qty = qtyByProduct.get(p.id) ?? 0;
    return { ...p, qty, isLow: qty <= p.minimum_stock };
  }).filter(item => item.isLow);

  const totalStock = balances.reduce((sum, b) => sum + b.quantity, 0);

  const usagesWithEstimate = activeUsages
    .map((usage) => {
      const days = daysActive(usage.opened_at);
      return { ...usage, days, estimateStatus: usageEstimateStatus(days) };
    })
    .sort((a, b) => b.days - a.days);
  const usagesNeedingCheck = usagesWithEstimate.filter((u) => u.estimateStatus !== 'NORMAL');

  const getProductImage = (sku: string, name: string) => getKnownProductImage(name) ?? '/api/stockist/product-image/E_left_here.jpeg';

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Greeting Section */}
      <section className="flex flex-col gap-1">
        <h2 className="text-[22px] font-bold text-text-primary leading-tight font-display">
          {getGreeting()}, {user.name}
        </h2>
        <div className="flex items-center gap-3 text-text-muted text-[12px] font-medium font-body-secondary">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">storefront</span>
            {BRANCH_NAMES[branch] || branch}
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </section>

      {!loading && pendingTransfer && (
        <Link
          href={`/admin/stockist/transfers/${pendingTransfer.id}`}
          className="flex flex-col gap-3 rounded-[20px] bg-primary-container p-4 text-white active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">local_shipping</span>
            <span className="flex-1 text-[14px] font-semibold">1 kiriman menunggu konfirmasi</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl bg-white/[0.12] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-bold">{pendingTransfer.transfer_number}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">Dikirim</span>
            </div>
            <span className="text-[12px] text-white/90">
              {pendingTransfer.source_name || 'Gudang Pusat'} → {pendingTransfer.destination_name || BRANCH_NAMES[branch] || branch} · {pendingItems.length} item · {pendingItems.reduce((sum, item) => sum + item.quantity_sent, 0)} pcs
            </span>
            <span className="text-[11px] text-white/70">
              Dikirim {formatTransferSentAt(pendingTransfer.sent_at)}
            </span>
          </div>
        </Link>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <section className="grid grid-cols-2 gap-3">
            <div className="bg-tint-success border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-secondary text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-success">inventory_2</span>
                Stok cabang (unit)
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalStock.toLocaleString('id-ID')}
              </div>
            </div>

            <div className="bg-tint-warning border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-secondary text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-warning">warning</span>
                Perlu restock
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {lowStockItems.length}
              </div>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>
            <QuickActionGrid
              actions={[
                { key: 'konfirmasi-kiriman', href: '/admin/stockist/transfers', icon: 'task_alt', label: 'Konfirmasi Kiriman' },
                { key: 'lihat-stok', href: '/admin/stockist/branch-stock', icon: 'boxes', label: 'Lihat Stok' },
                { key: 'stock-opname', href: '/admin/stockist/stock-opname', icon: 'checklist', label: 'Stock Opname' },
                { key: 'minta-stok', href: '/admin/stockist/requests/new', icon: 'add_shopping_cart', label: 'Minta Stok' },
              ]}
            />
          </section>

          {/* Low Stock Alert Card */}
          <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-danger font-semibold text-[14px] font-display">
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                Stok menipis di cabang
              </div>
              {lowStockItems.length > 0 && (
                <Link
                  href="/admin/stockist/branch-stock"
                  className="text-text-muted text-[11px] hover:text-text-primary transition-colors"
                >
                  Lihat Semua
                </Link>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {lowStockItems.length === 0 ? (
                <p className="text-success text-xs flex items-center gap-1.5 py-1">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Semua stok dalam batas aman.
                </p>
              ) : (
                lowStockItems.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex justify-between items-center bg-surface-container-low p-2 rounded-lg border border-border-base">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface-container rounded-lg border border-border-base flex items-center justify-center overflow-hidden">
                        <img
                          className="w-full h-full object-cover opacity-85 mix-blend-luminosity"
                          src={getProductImage(item.sku, item.name)}
                          alt={item.name}
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-text-primary leading-tight">{item.name}</span>
                        <span className="text-[10px] text-text-muted mt-0.5 font-mono">{item.sku} · min {item.minimum_stock} pcs</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[16px] font-bold text-danger font-display tabular-nums">{item.qty}</span>
                      <span className="text-[9px] text-danger/80 font-medium uppercase tracking-wider">Sisa ({item.unit})</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Barang Pemakaian Aktif */}
          <Link
            href="/admin/stockist/branch-stock?openUsage=1"
            className="border border-border-base rounded-xl p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-text-primary font-semibold text-[14px] font-display">
                <span className="material-symbols-outlined text-[18px] text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>timelapse</span>
                Stok Pemakaian
              </div>
              <span className="text-text-muted text-[11px]">Lihat Detail</span>
            </div>

            {usagesWithEstimate.length === 0 ? (
              <p className="text-text-muted text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">info</span>
                Belum ada barang pemakaian aktif
              </p>
            ) : (
              <>
                <p className={`text-[12px] flex items-center gap-1.5 ${usagesNeedingCheck.length > 0 ? 'text-warning' : 'text-success'}`}>
                  <span className="material-symbols-outlined text-[14px]">
                    {usagesNeedingCheck.length > 0 ? 'error' : 'check_circle'}
                  </span>
                  {usagesWithEstimate.length} produk sedang digunakan
                  {usagesNeedingCheck.length > 0
                    ? ` · ${usagesNeedingCheck.length} perlu dicek`
                    : ' · semua dalam estimasi normal'}
                </p>

                <div className="flex flex-col gap-2">
                  {usagesWithEstimate.slice(0, 3).map((usage) => (
                    <div key={usage.id} className="flex justify-between items-center bg-surface-container-low p-2 rounded-lg border border-border-base">
                      <span className="text-[12px] font-medium text-text-primary truncate">{usage.product_name}</span>
                      <span className={`text-[11px] font-semibold shrink-0 ml-2 ${
                        usage.estimateStatus === 'MELEWATI_ESTIMASI' ? 'text-danger'
                          : usage.estimateStatus === 'PERLU_DICEK' ? 'text-warning'
                          : 'text-text-muted'
                      }`}>
                        Aktif {usage.days} hari
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Link>
        </>
      )}
    </div>
  );
}
