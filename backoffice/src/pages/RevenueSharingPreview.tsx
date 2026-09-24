import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../auth/AuthProvider';
import {
  getRevenueSharingPreview,
  getBarberRevenueDetail,
  updateBarberCommissionRate,
  type RevenueSharingBarberSummary,
  type RevenueSharingPreviewResponse,
  type BarberRevenueDetailResponse,
} from '../services/payroll';

const BRANCH_OPTIONS = [
  { id: 'all', label: 'Semua Cabang' },
  { id: 'bypass', label: 'Bypass' },
  { id: 'csb', label: 'CSB' },
  { id: 'samadikun', label: 'Samadikun' },
  { id: 'sumber', label: 'Sumber' },
  { id: 'tegal', label: 'Tegal' },
];

function formatRupiah(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return 'Rp ' + amount.toLocaleString('id-ID');
}

function getInitialDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const firstDay = `${year}-${month}-01`;
  const today = `${year}-${month}-${day}`;
  return { dateFrom: firstDay, dateTo: today };
}

export function RevenueSharingPreview() {
  const { role, branchScope } = useAuth();
  const isOwner = role === 'owner';
  const initialDates = useMemo(() => getInitialDateRange(), []);

  const [dateFrom, setDateFrom] = useState(initialDates.dateFrom);
  const [dateTo, setDateTo] = useState(initialDates.dateTo);
  const [selectedBranch, setSelectedBranch] = useState(branchScope || 'all');
  const [selectedBarber, setSelectedBarber] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<RevenueSharingPreviewResponse | null>(null);

  // Detail Drawer State
  const [detailBarberId, setDetailBarberId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<BarberRevenueDetailResponse | null>(null);
  const [detailTab, setDetailTab] = useState<'services' | 'excluded' | 'review'>('services');

  // Rate Config Modal State
  const [rateModalBarber, setRateModalBarber] = useState<RevenueSharingBarberSummary | null>(null);
  const [newRatePercent, setNewRatePercent] = useState<string>('');
  const [newEffectiveFrom, setNewEffectiveFrom] = useState<string>(new Date().toISOString().slice(0, 10));
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRevenueSharingPreview({
        date_from: dateFrom,
        date_to: dateTo,
        branch: selectedBranch,
        barber_id: selectedBarber,
        status: selectedStatus,
      });
      setPreviewData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat preview bagi hasil';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
  }, [dateFrom, dateTo, selectedBranch, selectedBarber, selectedStatus]);

  // Load detail when drawer is opened
  const openDetail = async (barberId: string) => {
    setDetailBarberId(barberId);
    setDetailLoading(true);
    setDetailTab('services');
    try {
      const data = await getBarberRevenueDetail(barberId, {
        date_from: dateFrom,
        date_to: dateTo,
      });
      setDetailData(data);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  // Open rate modal
  const openRateModal = (barber: RevenueSharingBarberSummary) => {
    setRateModalBarber(barber);
    setNewRatePercent(barber.commission_rate != null ? String(barber.commission_rate * 100) : '35');
    setNewEffectiveFrom(new Date().toISOString().slice(0, 10));
    setRateError(null);
  };

  const handleSaveRate = async () => {
    if (!rateModalBarber) return;
    const rateDecimal = parseFloat(newRatePercent) / 100;
    if (isNaN(rateDecimal) || rateDecimal < 0 || rateDecimal > 1) {
      setRateError('Rate harus berupa angka antara 0% dan 100% (contoh: 30 atau 35)');
      return;
    }
    if (!newEffectiveFrom) {
      setRateError('Tanggal berlaku efektif wajib diisi');
      return;
    }

    setRateSaving(true);
    setRateError(null);
    try {
      await updateBarberCommissionRate({
        barberId: rateModalBarber.barber_id,
        rate: rateDecimal,
        effectiveFrom: newEffectiveFrom,
      });
      setRateModalBarber(null);
      await loadPreview();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan perubahan rate';
      setRateError(msg);
    } finally {
      setRateSaving(false);
    }
  };

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-rb-text-muted">
        <Link to="/payroll" className="hover:text-rb-text">
          ← Kembali ke Payroll
        </Link>
      </div>

      <PageHeader
        title="Revenue Sharing Preview"
        subtitle="Estimasi bagi hasil kapster berbasis data transaksi kanonikal Moka (moka_transaction_items). Bukan payroll final."
      />

      {/* Filter Toolbar */}
      <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range pickers */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-rb-text-muted">Periode:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-bg px-2.5 py-1.5 text-xs font-medium text-rb-text"
            />
            <span className="text-xs text-rb-text-faint">s/d</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-bg px-2.5 py-1.5 text-xs font-medium text-rb-text"
            />
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setDateFrom(today);
                setDateTo(today);
              }}
              className="rounded-rb-pill border border-rb-border bg-rb-bg px-2.5 py-1 text-[11px] font-semibold text-rb-text-muted hover:bg-rb-divider hover:text-rb-text"
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const past7 = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
                setDateFrom(past7);
                setDateTo(now.toISOString().slice(0, 10));
              }}
              className="rounded-rb-pill border border-rb-border bg-rb-bg px-2.5 py-1 text-[11px] font-semibold text-rb-text-muted hover:bg-rb-divider hover:text-rb-text"
            >
              7 Hari
            </button>
            <button
              type="button"
              onClick={() => {
                const d = getInitialDateRange();
                setDateFrom(d.dateFrom);
                setDateTo(d.dateTo);
              }}
              className="rounded-rb-pill border border-rb-border bg-rb-bg px-2.5 py-1 text-[11px] font-semibold text-rb-text-muted hover:bg-rb-divider hover:text-rb-text"
            >
              Bulan Ini
            </button>
          </div>

          <div className="h-4 w-px bg-rb-border" />

          {/* Branch filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="branch-filter" className="text-xs font-semibold text-rb-text-muted">
              Cabang:
            </label>
            <select
              id="branch-filter"
              value={selectedBranch}
              disabled={!isOwner && Boolean(branchScope)}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-bg px-2.5 py-1.5 text-xs font-semibold text-rb-text disabled:opacity-60"
            >
              {BRANCH_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          {/* Barber filter */}
          {previewData?.barbers && previewData.barbers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="barber-filter" className="text-xs font-semibold text-rb-text-muted">
                Kapster:
              </label>
              <select
                id="barber-filter"
                value={selectedBarber}
                onChange={(e) => setSelectedBarber(e.target.value)}
                className="rounded-rb-button border border-rb-border bg-rb-bg px-2.5 py-1.5 text-xs font-semibold text-rb-text"
              >
                <option value="all">Semua Kapster</option>
                {previewData.barbers.map((b) => (
                  <option key={b.barber_id} value={b.barber_id}>
                    {b.barber_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="status-filter" className="text-xs font-semibold text-rb-text-muted">
              Status:
            </label>
            <select
              id="status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-rb-button border border-rb-border bg-rb-bg px-2.5 py-1.5 text-xs font-semibold text-rb-text"
            >
              <option value="all">Semua Status</option>
              <option value="READY">READY (Siap)</option>
              <option value="MISSING_RATE">MISSING_RATE (Belum Ada Rate)</option>
              <option value="REVIEW_REQUIRED">REVIEW_REQUIRED (Perlu Review)</option>
            </select>
          </div>
        </div>
      </div>

      {loading && <LoadingState label="Menghitung estimasi bagi hasil dari data transaksi..." />}

      {error && <ErrorState message={error} />}

      {!loading && !error && previewData && (
        <>
          {/* Coverage is fail-closed: date bounds never prove interior sync continuity. */}
          {previewData.data_coverage && previewData.data_coverage.coverage_status !== 'COMPLETE' && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-rb-card border border-amber-300/40 bg-amber-50/60 p-3.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white font-bold text-[10px]">
                !
              </span>
              <span>
                <strong>Cakupan data transaksi belum dapat dibuktikan lengkap untuk periode ini.</strong>{' '}
                Periode dipilih {previewData.data_coverage.requested_start} s/d {previewData.data_coverage.requested_end}
                {previewData.data_coverage.available_start && previewData.data_coverage.available_end
                  ? `, rentang item canonical yang terlihat ${previewData.data_coverage.available_start} s/d ${previewData.data_coverage.available_end}`
                  : ', belum ada data item canonical Moka'}.
                {' '}Total di bawah hanya berdasarkan data canonical yang tersedia; rentang awal–akhir tidak membuktikan tidak ada gap sinkronisasi di tengah periode.
              </span>
            </div>
          )}

          {/* Top Summary Cards */}
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              value={formatRupiah(previewData.summary.total_net_service_revenue)}
              label="Net Service Revenue"
              trend={previewData.data_coverage && previewData.data_coverage.coverage_status !== 'COMPLETE'
                ? (previewData.data_coverage.coverage_status === 'PARTIAL' ? 'Data parsial' : 'Coverage belum terbukti')
                : undefined}
              tint="blue"
            />
            <StatCard
              value={formatRupiah(previewData.summary.total_estimated_commission)}
              label="Estimated Commission"
              tint="green"
            />
            <StatCard
              value={previewData.summary.kapster_ready_count}
              label="Kapster Ready"
              tint="purple"
            />
            <StatCard
              value={previewData.summary.need_review_count}
              label="Need Review / Missing Rate"
              trend={previewData.summary.need_review_count > 0 ? 'Perlu tindakan' : 'Semua tervalidasi'}
              tint={previewData.summary.need_review_count > 0 ? 'yellow' : 'green'}
            />
          </section>

          {/* Unassigned items alert if any */}
          {(previewData.unassigned.service_items_count > 0 || previewData.unassigned.review_items_count > 0) && (
            <div className="mb-5 flex items-center justify-between rounded-rb-card border border-amber-300/40 bg-amber-50/60 p-3.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white font-bold text-[10px]">
                  !
                </span>
                <span>
                  Ditemukan <strong>{previewData.unassigned.service_items_count} item layanan</strong> tanpa atribusi kapster pada periode ini. Item ini tidak dimasukkan ke komisi kapster manapun.
                </span>
              </div>
              <span className="font-mono text-[11px]">
                {previewData.unassigned.service_items_count} unassigned items
              </span>
            </div>
          )}

          {/* Barber Revenue Sharing Table */}
          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface shadow-sm">
            <div className="grid grid-cols-[1.5fr_0.9fr_1.1fr_0.9fr_1.1fr_0.8fr_1.1fr_1fr_1.2fr] gap-2 border-b border-rb-divider px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Kapster</div>
              <div>Cabang</div>
              <div>Gross Revenue</div>
              <div>Discount</div>
              <div>Net Revenue</div>
              <div>Rate</div>
              <div>Commission</div>
              <div>Status</div>
              <div className="text-right">Aksi</div>
            </div>

            <div className="flex flex-col divide-y divide-rb-divider">
              {previewData.barbers.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-rb-text-muted">
                  Tidak ada data bagi hasil untuk filter yang dipilih.
                </div>
              ) : (
                previewData.barbers.map((barber) => (
                  <div
                    key={barber.barber_id}
                    className="grid grid-cols-[1.5fr_0.9fr_1.1fr_0.9fr_1.1fr_0.8fr_1.1fr_1fr_1.2fr] items-center gap-2 px-4 py-3 text-sm transition hover:bg-rb-bg/50"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => openDetail(barber.barber_id)}
                        className="text-left font-semibold text-rb-text hover:text-rb-red hover:underline"
                      >
                        {barber.barber_name}
                      </button>
                      <div className="text-[11px] font-mono text-rb-text-faint">
                        {barber.barber_id} • {barber.service_item_count} layanan
                      </div>
                    </div>

                    <div className="capitalize text-xs font-medium text-rb-text-secondary">
                      {barber.outlet_name || barber.outlet_slug}
                    </div>

                    <div className="font-mono text-xs text-rb-text">
                      {formatRupiah(barber.gross_service_revenue)}
                    </div>

                    <div className="font-mono text-xs text-rb-text-muted">
                      {barber.discount_total > 0 ? `-${formatRupiah(barber.discount_total)}` : '—'}
                    </div>

                    <div className="font-mono text-xs font-semibold text-rb-text">
                      {formatRupiah(barber.net_service_revenue)}
                    </div>

                    <div>
                      {barber.commission_rate != null ? (
                        <span className="rounded-rb-pill bg-rb-blue-tint-bg px-2 py-0.5 font-mono text-xs font-semibold text-rb-blue-tint-fg">
                          {(barber.commission_rate * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="rounded-rb-pill bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          Belum Diatur
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-xs font-bold text-rb-text">
                      {barber.calculated_commission != null ? (
                        formatRupiah(barber.calculated_commission)
                      ) : (
                        <span className="text-rb-text-faint italic">—</span>
                      )}
                    </div>

                    <div>
                      {barber.status === 'READY' && (
                        <span className="inline-flex rounded-rb-pill bg-rb-green-tint-bg px-2 py-0.5 text-[11px] font-semibold text-rb-green-tint-fg">
                          READY
                        </span>
                      )}
                      {barber.status === 'MISSING_RATE' && (
                        <span className="inline-flex rounded-rb-pill bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          MISSING RATE
                        </span>
                      )}
                      {barber.status === 'REVIEW_REQUIRED' && (
                        <span className="inline-flex rounded-rb-pill bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                          REVIEW ({barber.review_required_count})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(barber.barber_id)}
                        className="rounded-rb-button border border-rb-border bg-rb-surface px-2.5 py-1 text-xs font-semibold text-rb-text hover:bg-rb-divider"
                      >
                        Detail
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => openRateModal(barber)}
                          className="rounded-rb-button border border-rb-red/20 bg-rb-red-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-red hover:bg-rb-red hover:text-white"
                        >
                          Atur Rate
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-rb-text-muted">
            <span>
              Menampilkan {previewData.barbers.length} kapster. Formula bagi hasil dihitung langsung dari data item layanan (non-stock service) Moka setelah potongan diskon.
            </span>
            <span className="italic">
              *Produk retail, minuman, dan biaya keanggotaan otomatis dikecualikan dari dasar kalkulasi.
            </span>
          </div>
        </>
      )}

      {/* Barber Detail Drawer / Modal */}
      {detailBarberId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs"
        >
          <div className="relative flex h-full w-full max-w-2xl flex-col bg-rb-surface shadow-2xl">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-rb-border px-6 py-4">
              <div>
                <h3 className="font-serif text-lg font-bold text-rb-text">
                  {detailData?.barber.name || 'Detail Layanan Kapster'}
                </h3>
                <div className="text-xs text-rb-text-muted">
                  Cabang: {detailData?.barber.branch?.toUpperCase()} • Periode: {dateFrom} s/d {dateTo}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailBarberId(null);
                  setDetailData(null);
                }}
                className="rounded-rb-button border border-rb-border p-1.5 text-rb-text-muted hover:bg-rb-divider hover:text-rb-text"
              >
                ✕
              </button>
            </div>

            {detailLoading && (
              <div className="flex-1 p-8">
                <LoadingState label="Memuat rincian transaksi..." />
              </div>
            )}

            {!detailLoading && detailData && (
              <div className="flex flex-1 flex-col overflow-y-auto p-6">
                {/* Metrics Summary Strip */}
                <div className="mb-6 grid grid-cols-4 gap-3 rounded-rb-card border border-rb-border bg-rb-bg p-3.5">
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-rb-text-faint">Net Service</div>
                    <div className="font-mono text-sm font-bold text-rb-text">
                      {formatRupiah(detailData.summary.net_service_revenue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-rb-text-faint">Rate Efektif</div>
                    <div className="font-mono text-sm font-bold text-rb-blue-tint-fg">
                      {detailData.barber.commission_rate != null ? `${(detailData.barber.commission_rate * 100).toFixed(0)}%` : 'Belum Ada'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-rb-text-faint">Estimasi Komisi</div>
                    <div className="font-mono text-sm font-bold text-rb-green-tint-fg">
                      {formatRupiah(detailData.summary.estimated_commission)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-rb-text-faint">Rate Source</div>
                    <div className="truncate text-xs font-semibold text-rb-text">
                      {detailData.barber.rate_source}
                      {detailData.barber.effective_from && ` (${detailData.barber.effective_from})`}
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="mb-4 flex items-center gap-2 border-b border-rb-divider">
                  <button
                    type="button"
                    onClick={() => setDetailTab('services')}
                    className={`border-b-2 px-3 py-2 text-xs font-semibold transition ${
                      detailTab === 'services'
                        ? 'border-rb-red text-rb-red'
                        : 'border-transparent text-rb-text-muted hover:text-rb-text'
                    }`}
                  >
                    Item Layanan ({detailData.service_items.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('excluded')}
                    className={`border-b-2 px-3 py-2 text-xs font-semibold transition ${
                      detailTab === 'excluded'
                        ? 'border-rb-red text-rb-red'
                        : 'border-transparent text-rb-text-muted hover:text-rb-text'
                    }`}
                  >
                    Dikecualikan ({detailData.excluded_items.length})
                  </button>
                  {detailData.review_items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDetailTab('review')}
                      className={`border-b-2 px-3 py-2 text-xs font-semibold transition ${
                        detailTab === 'review'
                          ? 'border-rb-red text-rb-red'
                          : 'border-transparent text-rb-text-muted hover:text-rb-text'
                      }`}
                    >
                      Perlu Review ({detailData.review_items.length})
                    </button>
                  )}
                </div>

                {/* Tab 1: Service Items */}
                {detailTab === 'services' && (
                  <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
                    <div className="grid grid-cols-[1.5fr_1.8fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-2 border-b border-rb-divider px-3 py-2 text-[10px] font-semibold uppercase text-rb-text-muted">
                      <div>Waktu / Struk</div>
                      <div>Layanan</div>
                      <div>Gross</div>
                      <div>Net</div>
                      <div>Rate</div>
                      <div className="text-right">Komisi</div>
                    </div>
                    <div className="divide-y divide-rb-divider max-h-[400px] overflow-y-auto">
                      {detailData.service_items.length === 0 ? (
                        <div className="py-6 text-center text-xs text-rb-text-muted">
                          Tidak ada transaksi layanan pada periode ini.
                        </div>
                      ) : (
                        detailData.service_items.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[1.5fr_1.8fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center gap-2 px-3 py-2 text-xs"
                          >
                            <div>
                              <div className="font-semibold text-rb-text">{item.tx_date}</div>
                              <div className="text-[10px] font-mono text-rb-text-faint truncate" title={item.receipt_number}>
                                {item.receipt_number.slice(0, 8)}...
                              </div>
                            </div>
                            <div className="font-medium text-rb-text truncate" title={item.item_name}>
                              {item.item_name}
                            </div>
                            <div className="font-mono text-rb-text-muted">{formatRupiah(item.gross_amount)}</div>
                            <div className="font-mono font-semibold text-rb-text">{formatRupiah(item.net_amount)}</div>
                            <div>
                              {item.rate_used != null ? (
                                <span className="font-mono text-[11px] text-rb-blue-tint-fg font-semibold">
                                  {(item.rate_used * 100).toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-[10px] text-amber-700">Missing</span>
                              )}
                            </div>
                            <div className="font-mono font-bold text-right text-rb-text">
                              {item.calculated_commission != null ? formatRupiah(item.calculated_commission) : '—'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 2: Excluded Items */}
                {detailTab === 'excluded' && (
                  <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
                    <div className="grid grid-cols-[1.5fr_2fr_2fr_1fr] gap-2 border-b border-rb-divider px-3 py-2 text-[10px] font-semibold uppercase text-rb-text-muted">
                      <div>Waktu / Struk</div>
                      <div>Item</div>
                      <div>Alasan Pengecualian</div>
                      <div className="text-right">Nominal</div>
                    </div>
                    <div className="divide-y divide-rb-divider max-h-[400px] overflow-y-auto">
                      {detailData.excluded_items.length === 0 ? (
                        <div className="py-6 text-center text-xs text-rb-text-muted">
                          Tidak ada item yang dikecualikan.
                        </div>
                      ) : (
                        detailData.excluded_items.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[1.5fr_2fr_2fr_1fr] items-center gap-2 px-3 py-2 text-xs"
                          >
                            <div>
                              <div className="font-semibold text-rb-text">{item.tx_date}</div>
                              <div className="text-[10px] font-mono text-rb-text-faint truncate">
                                {item.receipt_number.slice(0, 8)}...
                              </div>
                            </div>
                            <div className="font-medium text-rb-text truncate">{item.item_name}</div>
                            <div className="text-[11px] text-rb-text-muted italic">{item.reason}</div>
                            <div className="font-mono text-right text-rb-text-muted">{formatRupiah(item.net_amount)}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 3: Review Items */}
                {detailTab === 'review' && (
                  <div className="overflow-hidden rounded-rb-card border border-rose-300/40 bg-rb-surface">
                    <div className="grid grid-cols-[1.5fr_2fr_2fr_1fr] gap-2 border-b border-rb-divider px-3 py-2 text-[10px] font-semibold uppercase text-rose-800 dark:text-rose-300">
                      <div>Waktu / Struk</div>
                      <div>Item</div>
                      <div>Catatan Review</div>
                      <div className="text-right">Nominal</div>
                    </div>
                    <div className="divide-y divide-rb-divider max-h-[400px] overflow-y-auto">
                      {detailData.review_items.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[1.5fr_2fr_2fr_1fr] items-center gap-2 px-3 py-2 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-rb-text">{item.tx_date}</div>
                            <div className="text-[10px] font-mono text-rb-text-faint truncate">
                              {item.receipt_number.slice(0, 8)}...
                            </div>
                          </div>
                          <div className="font-medium text-rb-text truncate">{item.item_name}</div>
                          <div className="text-[11px] text-rose-700 dark:text-rose-400 font-medium">
                            {item.classification_reason}
                          </div>
                          <div className="font-mono text-right text-rb-text font-semibold">{formatRupiah(item.net_amount)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Historical Rate Log for this Barber */}
                {detailData.rate_history.length > 0 && (
                  <div className="mt-6">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rb-text-muted">
                      Riwayat Konfigurasi Rate Bagi Hasil
                    </h4>
                    <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-bg text-xs">
                      <div className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr] border-b border-rb-border px-3 py-1.5 font-semibold text-rb-text-faint">
                        <div>Rate</div>
                        <div>Berlaku Dari</div>
                        <div>Berlaku Sampai</div>
                        <div>Oleh</div>
                      </div>
                      <div className="divide-y divide-rb-border/60 font-mono text-[11px]">
                        {detailData.rate_history.map((rh) => (
                          <div key={rh.id} className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr] px-3 py-1.5">
                            <div className="font-bold text-rb-text">{(Number(rh.rate) * 100).toFixed(0)}%</div>
                            <div>{rh.effective_from}</div>
                            <div>{rh.effective_to || 'Aktif Sekarang'}</div>
                            <div className="truncate font-sans text-rb-text-faint">{rh.created_by || 'system'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rate Configuration Modal (Owner Only) */}
      {rateModalBarber && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-bold text-rb-text">
              Konfigurasi Rate Bagi Hasil
            </h3>
            <p className="mt-1 text-xs text-rb-text-muted">
              Atur persentase komisi bagi hasil untuk kapster{' '}
              <strong>{rateModalBarber.barber_name}</strong> ({rateModalBarber.outlet_name}).
            </p>

            {rateError && (
              <div className="mt-4 rounded-rb-button border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                {rateError}
              </div>
            )}

            <div className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="rate-input" className="block text-xs font-semibold text-rb-text">
                  Persentase Komisi (%)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id="rate-input"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    placeholder="Contoh: 30 atau 35"
                    value={newRatePercent}
                    onChange={(e) => setNewRatePercent(e.target.value)}
                    className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm font-semibold text-rb-text"
                  />
                  <span className="font-mono text-sm font-bold text-rb-text-muted">%</span>
                </div>
                <div className="mt-1 text-[11px] text-rb-text-faint">
                  Standar Redbox: 30% atau 35%. Desimal fraction: {(parseFloat(newRatePercent || '0') / 100).toFixed(2)}
                </div>
              </div>

              <div>
                <label htmlFor="effective-date-input" className="block text-xs font-semibold text-rb-text">
                  Berlaku Efektif Mulai Tanggal
                </label>
                <input
                  id="effective-date-input"
                  type="date"
                  value={newEffectiveFrom}
                  onChange={(e) => setNewEffectiveFrom(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2 text-sm font-semibold text-rb-text"
                />
                <div className="mt-1 text-[11px] text-rb-text-muted">
                  Perubahan rate hanya berlaku untuk transaksi pada atau setelah tanggal ini. Transaksi masa lalu tetap menggunakan rate historis.
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRateModalBarber(null)}
                disabled={rateSaving}
                className="rounded-rb-button border border-rb-border px-4 py-2 text-xs font-semibold text-rb-text hover:bg-rb-divider"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveRate}
                disabled={rateSaving}
                className="rounded-rb-button bg-rb-red px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rb-red/90 disabled:opacity-50"
              >
                {rateSaving ? 'Menyimpan...' : 'Simpan Rate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
