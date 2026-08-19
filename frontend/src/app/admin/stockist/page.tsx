'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import type { AppUser } from '@/hooks/useUser';
import Link from 'next/link';
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getDashboardOverview,
  type InventoryBalance,
  type StockTransfer,
  type DashboardOverview
} from '@/lib/stockistApi';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

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
// Read-only, company-wide, link-out only — the owner nav collapsed to a
// single tab (see layout.tsx), so this screen is the sole hub for reaching
// every other stockist page. It never mutates data itself; everything
// actionable is a Link to the page that owns that action. Sourced entirely
// from the company-wide `overview` endpoint — never mixes warehouse and
// branch figures into one number, and never scopes to a single "selected"
// location the way the old per-branch dropdown did.
// ---------------------------------------------------------------------------

function OwnerCommandCenter({ user }: { user: AppUser }) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getDashboardOverview(), listTransfers()])
      .then(([overviewData, transfersData]) => {
        setOverview(overviewData);
        setTransfers(transfersData.transfers);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat command center');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <section className="flex flex-col gap-1">
        <h2 className="text-[22px] font-bold text-text-primary leading-tight font-display">
          {getGreeting()}, {user.name}
        </h2>
        <div className="flex items-center gap-3 text-text-muted text-[12px] font-medium font-body-secondary">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">apartment</span>
            Semua lokasi
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
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : overview ? (
        <>
          <AttentionPanel overview={overview} />
          <LocationSnapshot overview={overview} transfers={transfers} />
          <TopRequestedPanel overview={overview} />
          <ManagePanel />
        </>
      ) : null}
    </div>
  );
}

type AttentionRow = {
  key: string;
  href: string;
  icon: string;
  severity: 'danger' | 'warning';
  title: string;
  subtitle: string;
  trailing: string;
};

function AttentionPanel({ overview }: { overview: DashboardOverview }) {
  const totalLowStock = overview.locations.reduce((sum, l) => sum + l.low_stock_count, 0);

  const rows: AttentionRow[] = [];

  if (overview.pending_requests_count > 0) {
    rows.push({
      key: 'pending-requests',
      href: '/admin/stockist/requests?status=NEEDS_ACTION',
      icon: 'assignment_late',
      severity: 'warning',
      title: 'Permintaan menunggu keputusan',
      subtitle: 'Perlu ditinjau: setuju, tolak, atau penuhi sebagian',
      trailing: String(overview.pending_requests_count)
    });
  }

  overview.problem_shipments.slice(0, 3).forEach((s) => {
    rows.push({
      key: `shipment-${s.id}`,
      href: `/admin/stockist/transfers/${s.id}`,
      icon: 'report',
      severity: 'danger',
      title: `Selisih penerimaan · ${s.transfer_number}`,
      subtitle: `${s.source_name} → ${s.destination_name}`,
      trailing: ''
    });
  });

  if (totalLowStock > 0) {
    rows.push({
      key: 'low-stock',
      href: '/admin/stockist/products',
      icon: 'inventory_2',
      severity: 'warning',
      title: 'Stok menipis di beberapa lokasi',
      subtitle: 'Di bawah batas minimum yang ditetapkan per produk',
      trailing: `${totalLowStock} SKU`
    });
  }

  overview.top_discrepancies.slice(0, 3).forEach((d) => {
    rows.push({
      key: `opname-${d.stock_opname_id}-${d.product_name}`,
      href: `/admin/stockist/stock-opname/${d.stock_opname_id}`,
      icon: 'rule',
      severity: 'danger',
      title: `Selisih opname · ${d.product_name}`,
      subtitle: d.location_name,
      trailing: d.difference > 0 ? `+${d.difference}` : String(d.difference)
    });
  });

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Perlu Perhatian</h3>

      {rows.length === 0 ? (
        <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-success text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-text-primary">Semua terkendali</span>
            <span className="text-[11px] text-text-muted">Tidak ada yang perlu ditindaklanjuti sekarang.</span>
          </div>
        </div>
      ) : (
        <div className="bg-surface-elevated border border-border-base rounded-xl divide-y divide-border-base overflow-hidden">
          {rows.map((row) => (
            <Link
              key={row.key}
              href={row.href}
              className="flex items-center gap-3 p-3 hover:bg-surface-container-high active:bg-surface-container transition-colors"
            >
              <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${
                row.severity === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
              }`}>
                <span className="material-symbols-outlined text-[18px]">{row.icon}</span>
              </span>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] font-semibold text-text-primary leading-tight truncate">{row.title}</span>
                <span className="text-[11px] text-text-muted mt-0.5 truncate">{row.subtitle}</span>
              </div>
              {row.trailing && (
                <span className={`text-[13px] font-bold tabular-nums shrink-0 ${row.severity === 'danger' ? 'text-danger' : 'text-warning'}`}>
                  {row.trailing}
                </span>
              )}
              <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function LocationSnapshot({ overview, transfers }: { overview: DashboardOverview; transfers: StockTransfer[] }) {
  const totalStock = overview.locations.reduce((sum, l) => sum + l.total_quantity, 0);
  const activeTransfersCount = transfers.filter((t) => t.status === 'SENT').length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Semua Lokasi</h3>
        <span className="text-[11px] text-text-muted tabular-nums">
          {totalStock.toLocaleString('id-ID')} pcs · {activeTransfersCount} transfer aktif
        </span>
      </div>

      <div className="bg-surface-elevated border border-border-base rounded-xl divide-y divide-border-base overflow-hidden">
        {overview.locations.map((loc) => (
          <div key={loc.location_id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">
                {loc.type === 'warehouse' ? 'warehouse' : 'storefront'}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-text-primary truncate">{loc.location_name}</span>
                <span className="text-[10px] text-text-muted">{loc.sku_count} SKU aktif</span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex flex-col items-end">
                <span className="text-[15px] font-bold text-text-primary font-display tabular-nums leading-none">{loc.total_quantity.toLocaleString('id-ID')}</span>
                <span className="text-[9px] text-text-muted uppercase tracking-wide mt-0.5">Total Pcs</span>
              </div>
              {loc.low_stock_count > 0 && (
                <span className="text-[10px] font-semibold text-status-menipis bg-status-menipis/10 border border-status-menipis/30 px-2 py-1 rounded">
                  {loc.low_stock_count} menipis
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopRequestedPanel({ overview }: { overview: DashboardOverview }) {
  if (overview.top_requested_products.length === 0) return null;
  const max = Math.max(...overview.top_requested_products.map((p) => p.total_requested), 1);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Produk Paling Diminta</h3>
      <div className="bg-surface-elevated border border-border-base rounded-xl divide-y divide-border-base overflow-hidden">
        {overview.top_requested_products.map((p, i) => (
          <div key={p.product_id} className="flex items-center gap-3 p-3">
            <span className="text-[11px] font-mono text-text-muted w-4 shrink-0">{i + 1}</span>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <span className="text-[13px] text-text-secondary truncate">{p.product_name}</span>
              <div className="h-1 rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary-container"
                  style={{ width: `${Math.max(8, (p.total_requested / max) * 100)}%` }}
                />
              </div>
            </div>
            <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">{p.total_requested}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const MANAGE_LINKS = [
  { href: '/admin/stockist/products', icon: 'inventory', label: 'Produk' },
  { href: '/admin/stockist/warehouse', icon: 'warehouse', label: 'Gudang' },
  { href: '/admin/stockist/transfers', icon: 'receipt_long', label: 'Transfer' },
  { href: '/admin/stockist/requests', icon: 'assignment', label: 'Permintaan' },
  { href: '/admin/stockist/stock-opname', icon: 'checklist', label: 'Stock Opname' },
  { href: '/admin/stockist/returns', icon: 'keyboard_return', label: 'Retur' }
];

function ManagePanel() {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Kelola</h3>
      <div className="grid grid-cols-3 gap-2">
        {MANAGE_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-surface-elevated border border-border-base rounded-xl py-4 flex flex-col items-center justify-center gap-1.5 hover:border-primary-container active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-text-secondary text-[22px]">{item.icon}</span>
            <span className="text-[11px] font-medium text-text-secondary text-center leading-tight">{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
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
      listTransfers()
    ])
      .then(([{ products }, { balances }, { transfers }]) => {
        setProducts(products);
        setBalances(balances);
        setTransfers(transfers);
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

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/uploads/clay.jpeg';
    if (lowerName.includes('oil')) return '/uploads/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/uploads/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/uploads/psyi.jpeg';
    return '/uploads/E_left_here.jpeg';
  };

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

          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>

            <div className="flex flex-col gap-2">
              <Link
                href="/admin/stockist/requests/new"
                className="bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-[14px] h-[48px] rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg border border-[#302728]"
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
