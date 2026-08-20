'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import {
  listProducts, getInventorySummary, getServiceUsage, getServiceUsagePicOptions,
  openServiceUsage, finishServiceUsage, listTransfers,
  type StockistProduct, type InventoryBalance, type ServiceUsage, type ServiceUsageItem, type StockTransfer,
} from '@/lib/stockistApi';
import { StatCard } from '@/components/stockist/StatCard';
import { BottomSheet } from '@/components/stockist/BottomSheet';
import { SkeletonCard } from '@/components/stockist/SkeletonCard';
import { EmptyState } from '@/components/stockist/EmptyState';

const BRANCH_NAMES: Record<string, string> = {
  warehouse: 'Gudang Pusat',
  bypass: 'Cabang Bypass',
  sumber: 'Cabang Sumber',
  samadikun: 'Cabang Samadikun',
  csb: 'Cabang CSB Mall',
  tegal: 'Cabang Tegal'
};

function BranchStockDashboard() {
  const { user } = useUser();
  const searchParams = useSearchParams() || new URLSearchParams();
  const router = useRouter();
  const isOwner = user?.role === 'owner';
  const branch = isOwner ? (searchParams.get('branch') || 'bypass') : (user?.branch || '');

  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [serviceItems, setServiceItems] = useState<ServiceUsageItem[]>([]);
  const [serviceUsages, setServiceUsages] = useState<ServiceUsage[]>([]);
  const [picOptions, setPicOptions] = useState<Array<{ id: string; name: string; role: 'branch_admin' | 'barber'; branch: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageSheetOpen, setUsageSheetOpen] = useState(false);
  const [openProduct, setOpenProduct] = useState<ServiceUsageItem | null>(null);
  const [openQuantity, setOpenQuantity] = useState(1);
  const [openPic, setOpenPic] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmFinishUsage, setConfirmFinishUsage] = useState<ServiceUsage | null>(null);

  async function refresh() {
    if (!branch) return;
    setLoading(true);
    try {
      const [{ products }, { balances }, serviceData, picData, { transfers }] = await Promise.all([
        listProducts(),
        getInventorySummary(branch),
        getServiceUsage(isOwner ? undefined : branch),
        getServiceUsagePicOptions(branch),
        listTransfers(),
      ]);
      setProducts(products);
      setBalances(balances);
      setServiceItems(serviceData.items);
      setServiceUsages(serviceData.usages);
      setPicOptions(picData.people);
      setOpenPic(picData.people[0]?.id || '');
      setTransfers(transfers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat stok cabang');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [branch]);

  if (!branch) {
    return (
      <div className="bg-surface-elevated border border-border-base rounded-xl p-6 text-center text-text-muted">
        Pilih cabang terlebih dahulu.
      </div>
    );
  }

  const quantityByProduct = new Map(balances.map((b) => [b.product_id, b.quantity]));
  const activeProducts = products.filter((p) => p.is_active);
  const outOfStock = activeProducts.filter((p) => (quantityByProduct.get(p.id) ?? 0) === 0);
  const lowStock = activeProducts
    .filter((p) => {
      const qty = quantityByProduct.get(p.id) ?? 0;
      return qty > 0 && qty <= p.minimum_stock;
    })
    .sort((a, b) => (quantityByProduct.get(a.id) ?? 0) - (quantityByProduct.get(b.id) ?? 0));

  // branch_admin's /transfers response is already scoped server-side to their
  // own destination_location_id. Owner's is not scoped per-branch (no
  // client-resolvable branch->location_id map without a new endpoint), so
  // for Owner this counts every active transfer system-wide.
  const incomingTransfers = transfers.filter((t) => t.status === 'SENT');

  const serviceItemsForBranch = serviceItems.filter((item) => item.branch === branch);
  const activeUsageCount = serviceItemsForBranch.filter((item) => item.in_use_quantity > 0).length;
  const activeUsagesForBranch = serviceUsages.filter((usage) => usage.status === 'IN_USE' && usage.branch === branch);

  async function handleMulaiPakai() {
    if (!openProduct) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await openServiceUsage({ product_id: openProduct.id, quantity: openQuantity, pic_user_id: openPic || undefined, notes: openNotes || undefined });
      setOpenProduct(null);
      setOpenQuantity(1);
      setOpenNotes('');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memulai pemakaian barang');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleTandaiHabis(usage: ServiceUsage) {
    setActionBusy(true);
    setActionError(null);
    try {
      await finishServiceUsage(usage.id);
      setConfirmFinishUsage(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menandai barang sebagai habis');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-[24px] font-bold text-text-primary font-display leading-tight">
            {isOwner ? 'Stok Cabang' : 'Stok Saya'}
          </h2>
          <p className="text-[12px] text-text-muted mt-1">
            {isOwner ? `Lokasi: ${BRANCH_NAMES[branch] || branch}` : `Cabang: ${BRANCH_NAMES[branch] || branch}`}
          </p>
        </div>
      </div>

      {isOwner && (
        <section className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-2 shadow-sm">
          <label className="text-[12px] font-semibold text-text-secondary">Pilih Cabang</label>
          <select
            value={branch}
            onChange={(e) => router.push(`/admin/stockist/branch-stock?branch=${encodeURIComponent(e.target.value)}`)}
            className="w-full bg-[#171415] border border-border-base rounded-lg text-text-primary px-3 py-2.5 text-sm focus:outline-none focus:border-primary-container"
          >
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
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Stok Habis"
            value={outOfStock.length}
            variant={outOfStock.length > 0 ? 'danger' : 'default'}
            hint="Perlu ditindaklanjuti."
            href={`/admin/stockist/branch-stock/all?status=OUT${isOwner ? `&branch=${branch}` : ''}`}
          />
          <StatCard
            label="Stok Menipis"
            value={lowStock.length}
            hint="Segera cek kebutuhan stok."
            href={`/admin/stockist/branch-stock/all?status=LOW${isOwner ? `&branch=${branch}` : ''}`}
          />
          <StatCard
            label="Barang Masuk"
            value={incomingTransfers.length}
            hint={incomingTransfers.length > 0 ? 'Menunggu pemeriksaan dan konfirmasi.' : 'Tidak ada barang masuk'}
            href="/admin/stockist/transfers"
          />
          <StatCard
            label="Barang Pemakaian"
            value={activeUsageCount}
            hint="Produk yang sedang digunakan di cabang."
            onClick={() => setUsageSheetOpen(true)}
          />
        </div>
      )}

      {!loading && (
        <StatCard
          label="Semua Stok"
          value={activeProducts.length}
          hint="Lihat seluruh inventory cabang."
          href={`/admin/stockist/branch-stock/all${isOwner ? `?branch=${branch}` : ''}`}
        />
      )}

      <BottomSheet open={usageSheetOpen} onClose={() => setUsageSheetOpen(false)} title="Barang Pemakaian">
        {actionError && (
          <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-2 mb-3">{actionError}</div>
        )}
        {serviceItemsForBranch.length === 0 ? (
          <EmptyState icon="check_circle" title="Tidak ada barang aktif" subtitle="Belum ada barang pemakaian yang sedang digunakan." />
        ) : (
          <div className="flex flex-col gap-3">
            {serviceItemsForBranch.map((item) => (
              <div key={item.id} className="rounded-lg border border-border-base bg-surface-container-low p-3 flex flex-col gap-2 text-[11px]">
                <span className="font-semibold text-text-primary text-[13px]">{item.name}</span>
                <div className="flex justify-between text-text-secondary"><span>Stok tertutup</span><strong className="text-text-primary">{item.available_quantity} {item.unit}</strong></div>
                <div className="flex justify-between text-text-secondary"><span>Sedang digunakan</span><strong className="text-primary-container">{item.in_use_quantity} {item.unit}</strong></div>
                {!isOwner && item.available_quantity > 0 && (
                  <button onClick={() => { setOpenProduct(item); setOpenQuantity(1); }} className="rounded-lg bg-primary-container text-text-primary py-2 font-semibold">Mulai Pakai</button>
                )}
                {activeUsagesForBranch.filter((usage) => usage.product_id === item.id).map((usage) => (
                  <div key={usage.id} className="flex justify-between items-center border-t border-border-base pt-2">
                    <span className="text-text-muted">{usage.quantity} {usage.product_unit} &middot; PIC {usage.pic_name}</span>
                    {!isOwner && (
                      <button onClick={() => setConfirmFinishUsage(usage)} disabled={actionBusy} className="rounded-lg border border-border-base text-text-secondary px-3 py-1.5 font-semibold">Tandai Habis</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      {openProduct && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-end justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[430px] bg-surface-elevated border border-border-base rounded-2xl p-4 flex flex-col gap-4">
            {actionError && (
              <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-2">{actionError}</div>
            )}
            <div>
              <h3 className="text-[16px] font-bold text-text-primary">Mulai Pakai</h3>
              <p className="text-[12px] text-text-muted mt-1">
                Mulai gunakan barang ini? {openQuantity} {openProduct.unit} akan dipindahkan dari stok tertutup menjadi barang yang sedang digunakan.
              </p>
            </div>
            <label className="text-[12px] text-text-secondary">Quantity
              <input type="number" min={1} max={openProduct.available_quantity || 1} value={openQuantity} onChange={(e) => setOpenQuantity(Math.max(1, Number(e.target.value)))} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" />
            </label>
            <label className="text-[12px] text-text-secondary">PIC / Penanggung Jawab
              <select value={openPic} onChange={(e) => setOpenPic(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary">
                <option value="">Pilih PIC</option>
                {picOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-text-secondary">Catatan opsional
              <textarea value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} className="mt-1 w-full bg-[#171415] border border-border-base rounded-lg px-3 py-2 text-text-primary" rows={2} />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setOpenProduct(null)} disabled={actionBusy} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary">Batal</button>
              <button onClick={() => void handleMulaiPakai()} disabled={actionBusy || !openPic} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">{actionBusy ? 'Menyimpan...' : 'Ya, Mulai Pakai'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmFinishUsage && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-end justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[430px] bg-surface-elevated border border-border-base rounded-2xl p-4 flex flex-col gap-4">
            {actionError && (
              <div className="bg-danger/10 border border-danger text-danger text-xs rounded-lg p-2">{actionError}</div>
            )}
            <div>
              <h3 className="text-[16px] font-bold text-text-primary">Tandai Habis</h3>
              <p className="text-[12px] text-text-muted mt-1">
                Tandai barang ini sudah habis? Barang aktif akan ditutup dan riwayat pemakaian akan dicatat.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmFinishUsage(null)} disabled={actionBusy} className="flex-1 border border-border-base rounded-lg py-2 text-text-secondary">Batal</button>
              <button onClick={() => void handleTandaiHabis(confirmFinishUsage)} disabled={actionBusy} className="flex-1 bg-primary-container rounded-lg py-2 text-text-primary font-bold">{actionBusy ? 'Menyimpan...' : 'Ya, Tandai Habis'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BranchStockPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <BranchStockDashboard />
    </Suspense>
  );
}
