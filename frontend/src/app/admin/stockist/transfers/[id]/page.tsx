'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { getTransfer, receiveTransfer, listProducts, type StockTransfer, type StockTransferItem, type StockistProduct } from '@/lib/stockistApi';
import { BackButton } from '@/components/stockist/BackButton';

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receivedQty, setReceivedQty] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [{ transfer, items }, { products }] = await Promise.all([
        getTransfer(id),
        listProducts()
      ]);
      setTransfer(transfer);
      setItems(items);
      setProducts(products);
      
      // Default inputs to quantity_sent or existing quantity_received
      setReceivedQty(
        Object.fromEntries(
          items.map((i) => [i.id, String(i.quantity_received ?? i.quantity_sent)])
        )
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail transfer');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload = items.map((item) => ({
        item_id: item.id,
        quantity_received: Number(receivedQty[item.id] ?? item.quantity_sent)
      }));
      const { has_discrepancy } = await receiveTransfer(id, payload);
      setSuccess(has_discrepancy ? 'Diterima — terdapat selisih jumlah penerimaan.' : 'Diterima sesuai jumlah pengiriman.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengonfirmasi penerimaan');
    } finally {
      setSubmitting(false);
    }
  }

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

  // Access is already enforced server-side: GET /transfers/:id 403s a
  // branch_admin whose branch isn't the destination, so reaching this point
  // with a loaded `transfer` means the current user is authorized to view
  // (and, for a SENT transfer, receive) it. `user.branch` is a slug like
  // "bypass" and can never equal `destination_location_id` (a UUID) — that
  // comparison always evaluated to false and hid the receive form from every
  // branch_admin.
  const showConfirmForm = transfer.status === 'SENT';

  // Map product info by ID
  const productMap = new Map(products.map(p => [p.id, p]));

  const getProductImage = (sku: string, name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('clay') || lowerName.includes('pomade')) return '/api/stockist/product-image/clay.jpeg';
    if (lowerName.includes('oil')) return '/api/stockist/product-image/oil_base.jpeg';
    if (lowerName.includes('water') || lowerName.includes('spray')) return '/api/stockist/product-image/water_base.jpeg';
    if (lowerName.includes('shave') || lowerName.includes('cream') || lowerName.includes('psyi')) return '/api/stockist/product-image/psyi.jpeg';
    return '/api/stockist/product-image/E_left_here.jpeg';
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('id-ID', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col gap-3 animate-fade-in pb-12">
      <BackButton fallbackHref="/admin/stockist/transfers" />
      {/* Header Context */}
      <div>
        <h2 className="text-[20px] font-bold text-text-primary font-display">Detail Transfer</h2>
        <p className="text-[11px] text-text-muted font-mono">NO: {transfer.transfer_number}</p>
      </div>

      {success && (
        <div className="bg-success/10 border border-success text-success text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Route & Progress Card */}
      <section className="bg-surface-elevated rounded-xl p-4 border border-border-base flex flex-col gap-4 shadow-sm relative overflow-hidden">
        <div className="flex justify-between items-center border-b border-border-base pb-3">
          <h3 className="text-[13px] font-bold text-text-primary font-display flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">local_shipping</span>
            Rute Pengiriman
          </h3>
          <span className={`px-2 py-0.5 rounded text-[9px] font-semibold border uppercase tracking-wider ${
            transfer.status === 'SENT' 
              ? 'bg-danger/10 border-danger/30 text-danger' 
              : 'bg-success/10 border-success/30 text-success'
          }`}>
            {transfer.status === 'SENT' ? 'Dikirim' : 'Diterima'}
          </span>
        </div>

        {/* Route Details */}
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
            <span className="text-[10px] text-text-muted mt-0.5 font-mono">
              {transfer.received_by || '-'}
            </span>
          </div>
        </div>

        <div className="h-[1px] w-full bg-border-base/50"></div>

        {/* Timeline Status */}
        <div className="flex flex-col gap-4 pl-1">
          {/* Created Step */}
          <div className="flex items-start gap-3 relative">
            <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[12px] font-semibold text-text-primary">Transfer Dibuat &amp; Dikirim</span>
              <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.sent_at)}</span>
            </div>
            {/* Timeline line connector */}
            <div className="absolute top-[18px] left-[9px] w-[1px] h-[22px] bg-border-base"></div>
          </div>

          {/* Received Step */}
          <div className="flex items-start gap-3 relative mt-1">
            {transfer.status === 'RECEIVED' ? (
              <div className="w-[18px] h-[18px] rounded-full bg-success flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#090707] text-[12px] font-bold">check</span>
              </div>
            ) : (
              <div className="w-[18px] h-[18px] rounded-full border-2 border-border-base bg-[#171415] shrink-0"></div>
            )}
            <div className="flex flex-col text-left">
              <span className={`text-[12px] font-semibold ${
                transfer.status === 'RECEIVED' ? 'text-text-primary' : 'text-text-muted'
              }`}>
                Diterima di {transfer.destination_name || transfer.destination_location_id}
              </span>
              {transfer.status === 'RECEIVED' && (
                <span className="text-[10px] text-text-secondary mt-0.5">{formatDate(transfer.received_at)}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Product List */}
      <form onSubmit={handleReceive} className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[14px] font-semibold text-text-secondary tracking-wide uppercase">Daftar Produk</h3>
          <span className="text-[11px] text-text-secondary bg-surface-elevated px-2 py-0.5 rounded border border-border-base">
            {items.length} Item
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const product = productMap.get(item.product_id);
            const name = product?.name || 'Produk Tidak Dikenal';
            const sku = product?.sku || 'UNKNOWN';
            const unit = product?.unit || 'pcs';
            const valReceived = Number(receivedQty[item.id] ?? item.quantity_sent);
            const discrepancy = transfer.status === 'RECEIVED' 
              ? (item.quantity_received ?? item.quantity_sent) - item.quantity_sent
              : valReceived - item.quantity_sent;

            return (
              <div key={item.id} className="bg-surface-elevated border border-border-base rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-lg bg-[#171415] border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                    <img 
                      className="w-full h-full object-cover opacity-85 mix-blend-luminosity" 
                      src={getProductImage(sku, name)} 
                      alt={name} 
                    />
                  </div>
                  {/* Title & SKU */}
                  <div className="flex-grow flex flex-col justify-center min-h-[48px]">
                    <h4 className="font-semibold text-text-primary text-[14px] leading-tight">{name}</h4>
                    <span className="text-[10px] text-text-muted mt-1 font-mono">SKU: {sku}</span>
                  </div>
                </div>

                {/* Ledger Metrics Panel */}
                <div className="flex justify-between items-center bg-[#171415] p-3 rounded-lg border border-border-base text-center">
                  {/* Sent */}
                  <div className="flex flex-col flex-1 items-start">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Dikirim</span>
                    <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                      {item.quantity_sent} <span className="text-[10px] font-normal text-text-secondary ml-0.5">{unit}</span>
                    </span>
                  </div>

                  <div className="w-[1px] h-8 bg-border-base"></div>

                  {/* Received */}
                  <div className="flex flex-col flex-1 items-center px-2">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-0.5">Diterima</span>
                    {showConfirmForm ? (
                      <input
                        type="number"
                        min={0}
                        value={receivedQty[item.id] ?? ''}
                        onChange={(e) => setReceivedQty({ ...receivedQty, [item.id]: e.target.value })}
                        className="w-16 h-[26px] bg-[#100e0e] border border-border-base rounded text-center text-[12px] font-bold text-text-primary focus:outline-none focus:border-primary-container p-0"
                        required
                      />
                    ) : (
                      <span className="text-[14px] font-bold text-text-primary font-display tabular-nums mt-0.5">
                        {transfer.status === 'RECEIVED' ? item.quantity_received : '-'}
                      </span>
                    )}
                  </div>

                  <div className="w-[1px] h-8 bg-border-base"></div>

                  {/* Discrepancy */}
                  <div className="flex flex-col flex-1 items-end">
                    <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Selisih</span>
                    <span className={`text-[14px] font-bold font-display tabular-nums mt-0.5 ${
                      discrepancy < 0 ? 'text-danger' : discrepancy > 0 ? 'text-success' : 'text-text-muted'
                    }`}>
                      {discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Confirm Submit Action */}
        {showConfirmForm && (
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary-container hover:bg-inverse-primary text-text-primary font-bold text-sm h-[46px] rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg border border-[#302728] mt-3"
          >
            <span className="material-symbols-outlined text-[18px]">verified</span>
            {submitting ? 'Memproses Konfirmasi...' : 'Konfirmasi Terima Barang'}
          </button>
        )}
      </form>
    </div>
  );
}
