'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import Link from 'next/link';
import {
  listProducts,
  getInventorySummary,
  listTransfers,
  getAssetDashboard,
  type InventoryBalance,
  type StockTransfer,
  type StockistAssetDashboard
} from '@/lib/stockistApi';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

export default function StockistDashboard() {
  const { user } = useUser();
  
  const [branch, setBranch] = useState<string>('');
  const [products, setProducts] = useState<any[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetDashboard, setAssetDashboard] = useState<StockistAssetDashboard | null>(null);
  const [assetLoading, setAssetLoading] = useState(true);

  // Set branch when user profile is loaded
  useEffect(() => {
    if (user) {
      setBranch(user.role === 'owner' ? 'warehouse' : (user.branch || 'warehouse'));
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    getAssetDashboard()
      .then(setAssetDashboard)
      .catch(() => setAssetDashboard(null))
      .finally(() => setAssetLoading(false));
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

  if (!user) return null;

  // Calculate stats
  const isOwner = user.role === 'owner';
  const qtyByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  
  // Filter low stock products
  const lowStockItems = products.map(p => {
    const qty = qtyByProduct.get(p.id) ?? 0;
    return { ...p, qty, isLow: qty <= p.minimum_stock };
  }).filter(item => item.isLow);

  // Calculate total stock qty
  const totalStock = balances.reduce((sum, b) => sum + b.quantity, 0);

  // GET /transfers already scopes results server-side (branch_admin only ever
  // receives transfers destined for their own branch), so no further branch
  // comparison is needed here — `branch` is a slug and can never equal a
  // transfer's location UUID.
  const activeTransfersCount = transfers.filter(t => t.status === 'SENT').length;

  // Map image based on SKU/name for premium aesthetic
  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/uploads/clay.jpeg';
    if (lowerName.includes('oil')) return '/uploads/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/uploads/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/uploads/psyi.jpeg';
    return '/uploads/E_left_here.jpeg';
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
  };

  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Selamat pagi';
    if (hr < 17) return 'Selamat siang';
    return 'Selamat malam';
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

      {assetLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assetDashboard && (
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Dashboard Aset Stok</h3>
            <p className="text-[11px] text-text-muted px-1 mt-1">Ringkasan nilai dan risiko stok yang perlu dipahami cepat.</p>
          </div>

          {isOwner && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                ['Total Nilai Aset Stok', assetDashboard.total_asset_value],
                ['Nilai Stok Gudang Pusat', assetDashboard.warehouse_asset_value],
                ['Nilai Stok Semua Cabang', assetDashboard.branch_asset_value],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-surface-elevated border border-border-base rounded-xl p-4 min-h-[96px]">
                  <span className="text-[11px] text-text-muted">{label}</span>
                  <div className="text-[20px] font-bold text-text-primary font-display tabular-nums mt-2">
                    {formatCurrency(value as number)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isOwner && (
            <div className="bg-surface-elevated border border-border-base rounded-xl p-4">
              <span className="text-[11px] text-text-muted">Lokasi Anda</span>
              <div className="text-[20px] font-bold text-text-primary font-display mt-2">
                {assetDashboard.asset_by_location[0]?.location_name || 'Cabang'}
              </div>
              <span className="text-[11px] text-text-muted">Ringkasan operasional tanpa nilai beli</span>
            </div>
          )}

          <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[13px] font-semibold text-text-primary">Aset per Lokasi</h4>
              <span className="text-[10px] text-text-muted">{assetDashboard.asset_by_location.length} lokasi</span>
            </div>
            {assetDashboard.asset_by_location.map((loc) => (
              <Link key={loc.location_id} href={isOwner ? `/admin/stockist/branch-stock?location=${loc.location_id}` : '/admin/stockist/branch-stock'} className="flex items-center justify-between gap-3 border-t border-border-base pt-3 hover:text-primary-container">
                <div>
                  <div className="text-[12px] font-semibold text-text-primary">{loc.location_name}</div>
                  <div className="text-[10px] text-text-muted">{loc.sku_count} SKU · {loc.low_stock_count} perlu perhatian</div>
                </div>
                <div className="text-right">
                  {isOwner && <div className="text-[13px] font-bold text-text-primary tabular-nums">{formatCurrency(loc.total_asset_value as number)}</div>}
                  <div className="text-[10px] text-text-muted">{loc.total_quantity.toLocaleString('id-ID')} unit</div>
                </div>
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href={isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock'} className="bg-surface-elevated border border-danger/30 rounded-xl p-4">
              <span className="text-[11px] text-danger font-semibold">Barang Perlu Perhatian</span>
              <div className="text-[24px] font-bold text-danger font-display mt-1">{assetDashboard.attention_items.length}</div>
              <span className="text-[10px] text-text-muted">berdasarkan stok minimum</span>
            </Link>
            <Link href="/admin/stockist/transfers" className="bg-surface-elevated border border-border-base rounded-xl p-4">
              <span className="text-[11px] text-text-muted font-semibold">Transfer Berjalan</span>
              <div className="text-[24px] font-bold text-text-primary font-display mt-1">{assetDashboard.active_transfers.length}</div>
              <span className="text-[10px] text-text-muted">belum selesai diterima</span>
            </Link>
          </div>

          {assetDashboard.attention_items.length > 0 && (
            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2">
              {assetDashboard.attention_items.slice(0, 3).map((item) => (
                <div key={`${item.location_id}-${item.product_id}`} className="flex justify-between text-[11px]">
                  <span className="text-text-secondary">{item.product_name} · {item.location_name}</span>
                  <span className="text-danger font-semibold">{item.reason === 'OUT_OF_STOCK' ? 'Habis' : 'Menipis'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Owner Branch Selector */}
      {isOwner && (
        <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2">
          <label className="text-[12px] font-semibold text-text-secondary">Pilih Lokasi Inventori</label>
          <select 
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full bg-[#171415] border border-border-base rounded-lg text-text-primary px-3 py-2 text-sm focus:outline-none focus:border-primary-container"
          >
            <option value="warehouse">Gudang Pusat (Main Warehouse)</option>
            <option value="bypass">Cabang Bypass</option>
            <option value="sumber">Cabang Sumber</option>
            <option value="samadikun">Cabang Samadikun</option>
            <option value="csb">Cabang CSB Mall</option>
            <option value="tegal">Cabang Tegal</option>
          </select>
        </section>
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
          {/* Low Stock Alert Card */}
          <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden shadow-lg">
            <div className="absolute inset-0 border border-primary-container/20 rounded-xl pointer-events-none"></div>
            <div className="absolute top-0 left-0 w-1 h-full bg-danger"></div>
            
            <div className="flex justify-between items-center pl-2">
              <div className="flex items-center gap-2 text-danger font-semibold text-[14px] font-display">
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                Stok Menipis ({lowStockItems.length})
              </div>
              {lowStockItems.length > 0 && (
                <Link 
                  href={isOwner ? '/admin/stockist/products' : '/admin/stockist/branch-stock'} 
                  className="text-text-muted text-[11px] hover:text-text-primary transition-colors"
                >
                  Lihat Semua
                </Link>
              )}
            </div>

            <div className="flex flex-col gap-2 pl-2">
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

          {/* Raw quantity is retained only for branch operations; owner sees asset value above. */}
          {!isOwner && <section className="grid grid-cols-2 gap-3">
            {/* Total Stok */}
            <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col justify-between min-h-[96px]">
              <div className="text-text-muted text-[12px] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">inventory_2</span> 
                Total Stok
              </div>
              <div className="text-[26px] font-bold text-text-primary tabular-nums font-display leading-none mt-2">
                {totalStock.toLocaleString('id-ID')}
              </div>
            </div>

            {/* Active Orders */}
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
          </section>}

          {/* Quick Actions */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase px-1">Aksi Cepat</h3>
            
            <div className="flex flex-col gap-2">
              {/* Primary action: owner pushes stock out ad-hoc, branch_admin
                  asks for restock — POST /transfers is owner-only, so a
                  branch_admin must never land on that form directly. */}
              {isOwner ? (
                <Link
                  href="/admin/stockist/transfers/new"
                  className="bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-[14px] h-[48px] rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg border border-[#302728]"
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>add_shopping_cart</span>
                  Buat Transfer Restok
                </Link>
              ) : (
                <Link
                  href="/admin/stockist/requests/new"
                  className="bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-[14px] h-[48px] rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg border border-[#302728]"
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>add_shopping_cart</span>
                  Ajukan Permintaan Stok
                </Link>
              )}

              <div className="grid grid-cols-2 gap-2">
                {isOwner ? (
                  <Link
                    href="/admin/stockist/products"
                    className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_box</span>
                    Tambah Produk
                  </Link>
                ) : (
                  <Link
                    href="/admin/stockist/transfers"
                    className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">call_received</span>
                    Terima Transfer
                  </Link>
                )}

                {isOwner ? (
                  <Link
                    href="/admin/stockist/requests?status=NEEDS_ACTION"
                    className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">fact_check</span>
                    Tinjau Permintaan
                  </Link>
                ) : (
                  <Link
                    href="/admin/stockist/requests"
                    className="bg-surface-elevated border border-border-base text-text-primary font-semibold text-[13px] h-[48px] rounded-lg flex items-center justify-center gap-1.5 active:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">list_alt</span>
                    Riwayat Permintaan
                  </Link>
                )}
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
