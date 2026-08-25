// frontend/src/app/admin/stockist/transfers/[id]/confirm/page.tsx
'use client';
import { useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';
import { getTransfer, listProducts, receiveTransfer, uploadDiscrepancyPhoto, type StockTransfer, type StockTransferItem, type StockistProduct } from '@/lib/stockistApi';
import { getKnownProductImage } from '@/lib/stockist/productImage';
import { Stepper } from '@/components/stockist/Stepper';
import { SuccessScreen } from '@/components/stockist/SuccessScreen';
import { OfflineBanner } from '@/components/stockist/OfflineBanner';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { showToast } from '@/lib/stockist/useToast';
import { BackButton } from '@/components/stockist/BackButton';

const REASONS = ['Kurang kirim', 'Rusak di jalan', 'Salah hitung'] as const;

interface ConfirmDraft {
  received: Record<string, number>;
  reasons: Record<string, string>;
}

export default function ConfirmReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const online = useOnlineStatus();

  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [items, setItems] = useState<StockTransferItem[]>([]);
  const [products, setProducts] = useState<StockistProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ transferNumber: string; sent: number; received: number; discrepancy: number } | null>(null);

  // `draft.received` intentionally stays sparse — every read of it below falls
  // back to `?? item.quantity_sent`, so there's no need to eagerly pre-fill
  // defaults into the draft itself. Pre-filling in a useEffect would race
  // useDraftPersistence's own hydration effect (both are registered on the
  // same mount; the pre-fill effect's closure would see the pre-hydration
  // draft and could overwrite a just-restored one with defaults).
  const [draft, setDraft, clearDraft] = useDraftPersistence<ConfirmDraft>(`stockist-confirm-draft-${id}`, { received: {}, reasons: {} });

  useEffect(() => {
    Promise.all([getTransfer(id), listProducts()])
      .then(([{ transfer, items }, { products }]) => {
        setTransfer(transfer);
        setItems(items);
        setProducts(products);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Gagal memuat transfer'))
      .finally(() => setLoading(false));
  }, [id]);

  const productMap = new Map(products.map((p) => [p.id, p]));

  function setReceivedQty(itemId: string, qty: number) {
    setDraft({ ...draft, received: { ...draft.received, [itemId]: qty } });
  }

  function setReason(itemId: string, reason: string) {
    setDraft({ ...draft, reasons: { ...draft.reasons, [itemId]: reason } });
  }

  async function handlePhotoChange(itemId: string, file: File) {
    setUploadingFor(itemId);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { photo_url } = await uploadDiscrepancyPhoto(id, itemId, dataUrl);
      setPhotoUrls((prev) => ({ ...prev, [itemId]: photo_url }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal mengunggah foto');
    } finally {
      setUploadingFor(null);
    }
  }

  function saveDraft() {
    showToast('Draft tersimpan');
  }

  const totalSent = items.reduce((sum, i) => sum + i.quantity_sent, 0);
  const totalReceived = items.reduce((sum, i) => sum + (draft.received[i.id] ?? i.quantity_sent), 0);
  const aggregateDiscrepancy = totalReceived - totalSent;

  const discrepantItems = items.filter((i) => (draft.received[i.id] ?? i.quantity_sent) !== i.quantity_sent);
  const missingReasons = discrepantItems.filter((i) => !draft.reasons[i.id]);

  async function handleSubmit() {
    setSubmitError(null);
    if (missingReasons.length > 0) {
      setSubmitError('Semua produk dengan selisih wajib diberi alasan.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = items.map((item) => ({
        item_id: item.id,
        quantity_received: draft.received[item.id] ?? item.quantity_sent,
        reason: draft.reasons[item.id] || undefined,
        photo_url: photoUrls[item.id] || undefined,
      }));
      await receiveTransfer(id, payload);
      setResult({ transferNumber: transfer?.transfer_number ?? '', sent: totalSent, received: totalReceived, discrepancy: aggregateDiscrepancy });
      clearDraft();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal mengonfirmasi penerimaan');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const hasDiscrepancy = result.discrepancy !== 0;
    return (
      <SuccessScreen
        title={hasDiscrepancy ? 'Diterima dengan selisih' : 'Penerimaan dikonfirmasi'}
        body={hasDiscrepancy ? 'Selisih sudah dicatat beserta alasannya.' : 'Semua barang diterima sesuai jumlah pengiriman.'}
        summary={[
          { label: 'Transfer', value: result.transferNumber },
          { label: 'Dikirim', value: String(result.sent) },
          { label: 'Diterima', value: String(result.received) },
          { label: 'Selisih', value: hasDiscrepancy ? `${result.discrepancy} pcs` : '0' },
        ]}
        secondaryAction={{ label: 'Lihat di Ledger', href: '/admin/stockist/ledger' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in pb-12">
      <BackButton fallbackHref={`/admin/stockist/transfers/${id}`} />
      <h2 className="text-[20px] font-bold text-text-primary font-display">Konfirmasi Penerimaan</h2>

      {!online && <OfflineBanner />}

      {loadError && (
        <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-container border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-xl bg-tint-info p-3.5 text-info">
            <span className="material-symbols-outlined text-[18px] shrink-0">info</span>
            <p className="text-[11.5px] leading-snug">Hitung fisik barang dulu, lalu isi quantity yang benar-benar diterima. Selisih wajib diberi alasan.</p>
          </div>

          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const product = productMap.get(item.product_id);
              const name = product?.name || 'Produk Tidak Dikenal';
              const image = product ? getKnownProductImage(product.name) : null;
              const receivedQty = draft.received[item.id] ?? item.quantity_sent;
              const isDiscrepant = receivedQty !== item.quantity_sent;

              return (
                <div key={item.id} className={`flex flex-col gap-3 rounded-xl border-[1.5px] p-3.5 ${
                  isDiscrepant ? 'border-status-menipis bg-tint-warning' : 'border-border-base bg-surface-elevated'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className="w-[54px] h-[54px] rounded-lg bg-surface-container-lowest border border-border-base overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {image ? (
                        <img className="w-full h-full object-contain p-1" src={image} alt={name} />
                      ) : (
                        <Package size={20} className="text-text-muted" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13.5px] font-bold text-text-primary">{name}</h4>
                      <span className="text-[11px] text-text-muted">Dikirim {item.quantity_sent} pcs</span>
                    </div>
                    <span className={`rounded px-2 py-1 text-[10px] font-bold ${isDiscrepant ? 'bg-status-menipis text-white' : 'bg-tint-success text-success'}`}>
                      {isDiscrepant ? 'SELISIH' : 'SESUAI'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-secondary">Diterima fisik</span>
                    <Stepper value={receivedQty} onChange={(next) => setReceivedQty(item.id, next)} min={0} size="sm" />
                  </div>

                  {isDiscrepant && (
                    <div className="flex flex-col gap-2 rounded-lg border border-status-menipis bg-surface-elevated p-3">
                      <span className="text-[11px] font-semibold text-status-menipis">
                        Selisih {receivedQty - item.quantity_sent} pcs · wajib beri alasan
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {REASONS.map((reason) => (
                          <button
                            key={reason}
                            type="button"
                            onClick={() => setReason(item.id, reason)}
                            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                              draft.reasons[item.id] === reason ? 'border-primary-container bg-primary-container text-white' : 'border-border-base text-text-secondary'
                            }`}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-base py-2 text-[11px] font-semibold text-text-secondary cursor-pointer">
                        <span className="material-symbols-outlined text-[16px]">photo_camera</span>
                        {uploadingFor === item.id ? 'Mengunggah...' : photoUrls[item.id] ? 'Foto terunggah' : 'Unggah foto bukti'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingFor === item.id || !online}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoChange(item.id, file);
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border-base bg-surface-elevated p-4">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total dikirim</span>
              <span className="font-semibold text-text-primary">{totalSent}</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-text-muted">Total diterima</span>
              <span className="font-semibold text-text-primary">{totalReceived}</span>
            </div>
            <div className="h-[1px] bg-border-base/60" />
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-text-primary">Selisih</span>
              <span className={`text-[20px] font-extrabold font-display tabular-nums ${aggregateDiscrepancy === 0 ? 'text-success' : 'text-status-menipis'}`}>
                {aggregateDiscrepancy}
              </span>
            </div>
          </div>

          {submitError && (
            <div className="bg-danger/10 border border-danger text-danger text-sm rounded-lg p-3 flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !online}
              className="h-[48px] rounded-xl bg-primary-container text-white text-[14px] font-bold active:scale-95 transition-transform disabled:opacity-50"
            >
              {!online ? 'Menunggu koneksi...' : submitting ? 'Memproses...' : 'Konfirmasi Penerimaan'}
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[44px] rounded-xl border border-border-base text-text-primary text-[13px] font-bold active:scale-95 transition-transform"
            >
              Simpan Draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}
