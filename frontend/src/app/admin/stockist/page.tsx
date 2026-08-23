'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useUser } from '@/hooks/useUser';
import { useStockistTheme } from '@/lib/stockist/useTheme';
import type { AppUser } from '@/hooks/useUser';
import Link from 'next/link';
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getAssetDashboard,
  getServiceUsage,
  type InventoryBalance,
  type StockTransfer,
  type StockistAssetDashboard,
  type AssetLocationSummary,
  type ServiceUsage
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { LocationCard } from '@/components/stockist/LocationCard';
import { ListRow, type ListRowData } from '@/components/stockist/ListRow';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';
import { HorizontalBarChart } from '@/components/stockist/HorizontalBarChart';
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
  | { type: 'transfers' }
  | null;

function toAttentionRows(items: StockistAssetDashboard['attention_items']): ListRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    href: '/admin/stockist/products',
    icon: item.reason === 'OUT_OF_STOCK' ? 'error' : 'inventory_2',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    title: item.product_name,
    subtitle: item.location_name,
    trailing: item.reason === 'OUT_OF_STOCK' ? 'Habis' : `${item.quantity} tersisa`,
  }));
}

function toProductAttentionRows(items: StockistAssetDashboard['attention_items']): ProductAttentionRowData[] {
  return items.map((item) => ({
    key: `${item.location_id}-${item.product_id}`,
    name: item.product_name,
    meta: item.location_name,
    statusLabel: item.reason === 'OUT_OF_STOCK' ? 'Habis' : 'Menipis',
    severity: item.reason === 'OUT_OF_STOCK' ? 'danger' : 'warning',
    trailing: String(item.quantity),
    trailingUnit: 'pcs',
    href: '/admin/stockist/products',
  }));
}

function toTransferRows(transfers: StockTransfer[]): ListRowData[] {
  return transfers.map((t) => ({
    key: t.id,
    href: `/admin/stockist/transfers/${t.id}`,
    icon: 'local_shipping',
    severity: 'neutral',
    title: t.transfer_number,
    subtitle: `${t.source_name ?? t.source_location_id} → ${t.destination_name ?? t.destination_location_id}`,
    trailing: t.status === 'SENT' ? 'Dikirim' : 'Diterima',
  }));
}

function OwnerCommandCenter({ user }: { user: AppUser }) {
  const [assets, setAssets] = useState<StockistAssetDashboard | null>(null);
  const [activeProductCount, setActiveProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  const { theme } = useStockistTheme();

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
            {/* No heroTrend/heroStats here — the API has no period-over-period delta or
                duplicate breakdown data; the KPI grid below already covers Lokasi/SKU/Unit. */}
            <StatCard
              label="Aset Stok RedBox"
              value={assets.total_asset_value ?? 0}
              formatter={formatCurrency}
              variant="hero"
              hint="Total nilai stok aktif di seluruh jaringan RedBox."
            />
          </motion.div>

          <motion.div variants={fadeSlideItem} className="grid grid-cols-2 gap-3">
            <StatCard label="Total Produk" value={activeProductCount} icon="category" tint="info" hint="SKU aktif" />
            <StatCard label="Total Stok" value={totalStockUnits} icon="inventory_2" tint="success" hint="unit di semua lokasi" />
            <StatCard
              label="Perlu Perhatian"
              value={assets.attention_items.length}
              icon="warning"
              tint="warning"
              hint="perlu restock"
              onClick={() => setDrillDown({ type: 'attention' })}
            />
            <StatCard
              label="Transfer Berjalan"
              value={assets.active_transfers.length}
              icon="local_shipping"
              tint="danger"
              hint="belum diterima"
              onClick={() => setDrillDown({ type: 'transfers' })}
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
              <div className="bg-surface-elevated border border-border-base rounded-xl p-3">
                <HorizontalBarChart
                  data={assets.asset_by_location.map((location) => ({ name: location.location_name, value: location.total_asset_value ?? 0 }))}
                  theme={theme}
                />
                <div className="mt-3 border-t border-border-base pt-1 divide-y divide-border-base">
                  {assets.asset_by_location.map((location) => (
                    <LocationCard
                      key={location.location_id}
                      location={location}
                      formatValue={formatCurrency}
                      maxValue={maxLocationValue}
                      onSelect={() => setDrillDown({ type: 'location', location })}
                    />
                  ))}
                </div>
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

      <BottomSheet open={drillDown?.type === 'transfers'} onClose={() => setDrillDown(null)} title="Transfer Berjalan">
        {assets && assets.active_transfers.length > 0 ? (
          <div className="flex flex-col divide-y divide-border-base -m-4">
            {toTransferRows(assets.active_transfers).map((row) => (
              <ListRow key={row.key} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check_circle" title="Belum ada transfer berjalan" subtitle="Semua transfer sudah selesai." />
        )}
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branch admin: Beranda (unchanged from prior behavior)
// ---------------------------------------------------------------------------

function BranchAdminDashboard({ user }: { user: AppUser }) {
  const [branch, setBranch] = useState<string>('');
  const [products, setProducts] = useState<any[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [activeUsages, setActiveUsages] = useState<ServiceUsage[]>([]);
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

  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));

  const lowStockItems = products.map(p => {
    const qty = qtyByProduct.get(p.id) ?? 0;
    return { ...p, qty, isLow: qty <= p.minimum_stock };
  }).filter(item => item.isLow);

  const totalStock = balances.reduce((sum, b) => sum + b.quantity, 0);
  const activeTransfersCount = transfers.filter(t => t.status === 'SENT').length;

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
          {/* Low Stock Alert Card */}
          <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-danger font-semibold text-[14px] font-display">
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                Stok Menipis ({lowStockItems.length})
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
                        <span className="text-[10px] text-text-muted mt-0.5 font-mono">SKU: {item.sku}</span>
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

          {/* Stats Grid */}
          <section className="grid grid-cols-2 gap-3">
            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-muted text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                Total Stok
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalStock.toLocaleString('id-ID')}
              </div>
            </div>

            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-muted text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                Transfer Aktif
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2 flex items-baseline gap-2">
                {activeTransfersCount}
                <span className="text-[10px] text-warning font-semibold bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
                  Kirim
                </span>
              </div>
            </div>
          </section>

          {/* Barang Pemakaian Aktif */}
          <Link
            href="/admin/stockist/branch-stock?openUsage=1"
            className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 shadow-lg active:scale-[0.99] transition-transform"
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

          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>

            <div className="flex flex-col gap-2">
              <Link
                href="/admin/stockist/requests/new"
                className="bg-primary-container hover:bg-inverse-primary text-white font-bold text-[14px] h-[48px] rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg"
              >
                <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>add_shopping_cart</span>
                Ajukan Permintaan Stok
              </Link>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/admin/stockist/transfers"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">call_received</span>
                  Terima Transfer
                </Link>
                <Link
                  href="/admin/stockist/requests"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">list_alt</span>
                  Riwayat Permintaan
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/admin/stockist/stock-opname"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">checklist</span>
                  Stock Opname
                </Link>
                <Link
                  href="/admin/stockist/returns"
                  className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[44px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
                  Retur Barang
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
