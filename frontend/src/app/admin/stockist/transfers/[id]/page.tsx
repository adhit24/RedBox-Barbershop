// frontend/src/app/admin/stockist/transfers/[id]/page.tsx
'use client';
import { useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { useUser } from '@/hooks/useUser';
import { getTransfer, listProducts, type StockTransfer, type StockTransferItem, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { BackButton } from '@/components/stockist/BackButton';

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const { user } = useUser();

  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getTransfer(id), listProducts()])
      .then(([{ transfer, items }, { products }]) => {
        setTransfer(transfer);
        setItems(items);
        setProducts(products);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal memuat detail transfer'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !transfer) {
    return (
      <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
        <span className="material-symbols-outlined">error</span>
        <span>{error}</span>
      </div>
    );
  }

  if (!transfer) return null;

  const productMap = new Map(products.map((p) => [p.id, p]));
  const canConfirm = (user?.role === 'manager' || user?.role === 'branch_admin') && transfer.status === 'SENT';

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col gap-3 animate-fade-in pb-12">
      <BackButton fallbackHref="/admin/stockist/transfers" />
      <div>
        <h2 className="text-[20px] font-bold text-text-primary font-display">Detail Transfer</h2>
        <p className="text-[11px] text-text-muted font-mono">NO: {transfer.transfer_number}</p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      <section className="bg-surface-elevated rounded-xl p-4 border border-border-base flex flex-col gap-4 shadow-sm">
        <div className="flex justify-between items-center border-b border-border-base pb-3">
          <h3 className="text-[13px] font-bold text-text-primary font-display flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">local_shipping</span>
            Rute Pengiriman
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${
            transfer.status === 'SENT' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-success/10 border-success/30 text-success'
          }`}>
            {transfer.status === 'SENT' ? 'Dikirim' : 'Diterima'}
          </span>
        </div>

        <div className="flex justify-between items-center text-center">
          <div className="flex flex-col flex-1 items-start">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Pengirim</span>
            <span className="text-[13px] font-bold text-text-primary mt-1">{transfer.source_name || transfer.source_location_id}</span>
            <span className="text-[10px] text-text-muted mt-0.5 font-mono">{transfer.sent_by}</span>
          </div>
          <div className="flex flex-col px-3 justify-center items-center">
            <span className="material-symbols-outlined text-text-muted text-[20px] animate-pulse">arrow_forward</span>
            <span className="text-[8px] text-text-muted mt-1 uppercase font-semibold">Kurir</span>
          </div>
          <div className="flex flex-col flex-1 items-end">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Penerima</span>
            <span className="text-[13px] font-bold text-text-primary mt-1">{transfer.destination_name || transfer.destination_location_id}</span>
            <span className="text-[10px] text-text-muted mt-0.5 font-mono">{transfer.received_by || '-'}</span>
          </div>
        </div>

        <div className="h-[1px] w-full bg-border-base/50"></div>

        <div className="flex flex-col gap-4 pl-1">
          <div className="flex items-start gap-3 relative">
            <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[12px] font-semibold text-text-primary">Transfer Dibuat &amp; Dikirim</span>
              <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.sent_at)}</span>
            </div>
            <div className="absolute top-[18px] left-[9px] w-[1px] h-[22px] bg-border-base"></div>
          </div>

          <div className="flex items-start gap-3 relative">
            {transfer.status === 'RECEIVED' ? (
              <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            ) : (
              <div className="w-[18px] h-[18px] rounded-full bg-danger flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            )}
            <div className="flex flex-col text-left">
              <span className="text-[12px] font-semibold text-text-primary">Dikirim ke kurir</span>
              <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.sent_at)}</span>
            </div>
            {transfer.status !== 'RECEIVED' && <div className="absolute top-[18px] left-[9px] w-[1px] h-[22px] bg-border-base"></div>}
          </div>

          <div className="flex items-start gap-3 relative">
            {transfer.status === 'RECEIVED' ? (
              <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            ) : (
              <div className="w-[18px] h-[18px] rounded-full border-2 border-border-base bg-surface-container-lowest shrink-0"></div>
            )}
            <div className="flex flex-col text-left">
              <span className={`text-[12px] font-semibold ${transfer.status === 'RECEIVED' ? 'text-text-primary' : 'text-text-muted'}`}>
                {transfer.status === 'RECEIVED' ? `Diterima di ${transfer.destination_name || transfer.destination_location_id}` : 'Menunggu konfirmasi'}
              </span>
              {transfer.status === 'RECEIVED' && <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.received_at)}</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Rincian produk</h3>
          <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">{items.length} Item</span>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const product = productMap.get(item.product_id);
            const name = product?.name || 'Produk Tidak Dikenal';
            const sku = product?.sku || 'UNKNOWN';
            const image = product ? getKnownProductImage(product.name) : null;
            const received = transfer.status === 'RECEIVED' ? item.quantity_received : null;
            const discrepancy = received != null ? received - item.quantity_sent : null;

            return (
              <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-[52px] h-[52px] rounded-lg bg-surface-container-lowest border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {image ? (
                      <img className="w-full h-full object-contain p-1" src={image} alt={name} />
                    ) : (
                      <Package size={20} className="text-text-muted" aria-hidden />
                    )}
                  </div>
                  <div className="flex-grow flex flex-col justify-center min-h-[48px]">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {sku}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[11px] bg-surface-container-lowest p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Dikirim</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums">{item.quantity_sent}</span>
                  </div>
                  <div className="rounded-[11px] bg-surface-container-lowest p-2.5 flex flex-col gap-0.5">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Diterima</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums">{received ?? '—'}</span>
                  </div>
                  <div className={`rounded-[11px] p-2.5 flex flex-col gap-0.5 ${discrepancy ? 'bg-danger/10' : 'bg-surface-container-lowest'}`}>
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Selisih</span>
                    <span className={`text-[14px] font-bold font-display tabular-nums ${discrepancy ? 'text-danger' : 'text-text-primary'}`}>
                      {discrepancy == null ? '—' : discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {canConfirm && (
        <Link
          href={`/admin/stockist/transfers/${id}/confirm`}
          className="w-full bg-primary-container hover:bg-inverse-primary text-white font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg mt-3"
        >
          <span className="material-symbols-outlined text-[18px]">verified</span>
          Konfirmasi Penerimaan
        </Link>
      )}
    </div>
  );
}
