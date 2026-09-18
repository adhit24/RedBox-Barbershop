import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../auth/AuthProvider';
import {
  listPayrollRuns,
  getPayrollRunDetail,
  getBarberRunDetail,
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  type PayrollRun,
  type PayrollBarberItem,
  type PayrollCommissionItem,
  type PayrollAdjustment,
  type PayrollBlocker,
  type AttendanceContext,
} from '../services/payrollRuns';

function formatRupiah(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return 'Rp ' + amount.toLocaleString('id-ID');
}

function formatDateDisplay(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d;
  }
}

function formatDateTimeDisplay(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    return date.toLocaleString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

export function KapsterPayrollRuns() {
  const { role, branchScope } = useAuth();
  const isOwner = role === 'owner';

  // Runs overview state
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  // Selected Run Detail State
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [runBarbers, setRunBarbers] = useState<PayrollBarberItem[]>([]);
  const [runBlockers, setRunBlockers] = useState<PayrollBlocker[]>([]);
  const [, setRunAdjustments] = useState<PayrollAdjustment[]>([]);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [runDetailError, setRunDetailError] = useState<string | null>(null);

  // Create Draft Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPeriodStart, setNewPeriodStart] = useState('2026-09-01');
  const [newPeriodEnd, setNewPeriodEnd] = useState('2026-09-30');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [createModalError, setCreateModalError] = useState<string | null>(null);

  // Barber Detail Drawer State
  const [detailBarberId, setDetailBarberId] = useState<string | null>(null);
  const [detailBarber, setDetailBarber] = useState<PayrollBarberItem | null>(null);
  const [detailCommissionLines, setDetailCommissionLines] = useState<PayrollCommissionItem[]>([]);
  const [detailAdjustments, setDetailAdjustments] = useState<PayrollAdjustment[]>([]);
  const [detailAttendance, setDetailAttendance] = useState<AttendanceContext | null>(null);
  const [loadingBarberDetail, setLoadingBarberDetail] = useState(false);
  const [barberDetailError, setBarberDetailError] = useState<string | null>(null);

  // Adjustment Form State
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjAmount, setAdjAmount] = useState<string>('');
  const [adjReason, setAdjReason] = useState<string>('');
  const [adjNote, setAdjNote] = useState<string>('');
  const [savingAdj, setSavingAdj] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);

  // Action states
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Load runs on mount
  const loadRuns = async () => {
    setLoadingRuns(true);
    setRunsError(null);
    try {
      const data = await listPayrollRuns();
      setRuns(data);
    } catch (err: any) {
      setRunsError(err.message || 'Gagal memuat daftar payroll runs.');
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  // Load single run detail
  const loadRunDetail = async (runId: string) => {
    setLoadingRunDetail(true);
    setRunDetailError(null);
    try {
      const res = await getPayrollRunDetail(runId);
      setSelectedRun(res.run);
      setRunBarbers(res.barbers);
      setRunBlockers(res.blockers);
      setRunAdjustments(res.adjustments);
    } catch (err: any) {
      setRunDetailError(err.message || 'Gagal memuat rincian payroll draft.');
    } finally {
      setLoadingRunDetail(false);
    }
  };

  useEffect(() => {
    if (selectedRunId) {
      loadRunDetail(selectedRunId);
    }
  }, [selectedRunId]);

  // Load barber detail drawer
  const loadBarberDetail = async (barberId: string) => {
    if (!selectedRunId) return;
    setLoadingBarberDetail(true);
    setBarberDetailError(null);
    try {
      const res = await getBarberRunDetail(selectedRunId, barberId);
      setDetailBarber(res.barber);
      setDetailCommissionLines(res.commission_lines || []);
      setDetailAdjustments(res.adjustments || []);
      setDetailAttendance(res.attendance_context || null);
    } catch (err: any) {
      setBarberDetailError(err.message || 'Gagal memuat rincian kapster.');
    } finally {
      setLoadingBarberDetail(false);
    }
  };

  useEffect(() => {
    if (detailBarberId) {
      loadBarberDetail(detailBarberId);
    } else {
      setDetailBarber(null);
      setDetailCommissionLines([]);
      setDetailAdjustments([]);
      setDetailAttendance(null);
      setShowAdjForm(false);
      setAdjError(null);
    }
  }, [detailBarberId]);

  // Filter barbers by branch if manager
  const visibleBarbers = useMemo(() => {
    if (!branchScope || branchScope === 'all') return runBarbers;
    return runBarbers.filter((b) => b.branch_snapshot === branchScope);
  }, [runBarbers, branchScope]);

  // Create Draft
  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingDraft(true);
    setCreateModalError(null);
    try {
      const res = await generatePayrollDraft(newPeriodStart, newPeriodEnd);
      setShowCreateModal(false);
      await loadRuns();
      setSelectedRunId(res.run.id);
      setActionSuccessMessage(`Draft payroll periode ${res.run.period_start} s/d ${res.run.period_end} berhasil dibuat.`);
      setTimeout(() => setActionSuccessMessage(null), 4000);
    } catch (err: any) {
      setCreateModalError(err.message || 'Gagal membuat draft payroll.');
    } finally {
      setCreatingDraft(false);
    }
  };

  // Regenerate Draft
  const handleRegenerate = async (runId: string) => {
    if (!window.confirm('Regenerasi draft akan menghitung ulang seluruh layanan dari data Moka terbaru. Penyesuaian manual yang telah dibuat akan tetap dipertahankan. Lanjutkan?')) {
      return;
    }
    setActionInProgress('regenerate');
    try {
      const res = await regeneratePayrollDraft(runId);
      await loadRuns();
      if (selectedRunId === runId) {
        await loadRunDetail(runId);
      }
      setActionSuccessMessage(`Draft payroll periode ${res.run.period_start} s/d ${res.run.period_end} berhasil diregenerasi.`);
      setTimeout(() => setActionSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(`Gagal regenerasi draft: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Lock Payroll Run
  const handleLock = async (runId: string) => {
    if (runBlockers.length > 0) {
      alert('Tidak dapat mengunci payroll: Masih terdapat issue/blocker yang harus diselesaikan terlebih dahulu.');
      return;
    }
    if (!window.confirm('PERINGATAN PENTING:\n\nSetelah payroll DIKUNCI (LOCKED), seluruh snapshot nilai finansial, komisi, dan penyesuaian manual bersifat IMMUTABLE (permanen).\n\nAngka historis tidak akan berubah meskipun kemudian hari terjadi perubahan rate komisi, perpindahan cabang, atau koreksi data Moka.\n\nApakah Anda yakin ingin mengunci payroll run ini?')) {
      return;
    }
    setActionInProgress('lock');
    try {
      const res = await lockPayrollRun(runId);
      await loadRuns();
      if (selectedRunId === runId) {
        await loadRunDetail(runId);
      }
      setActionSuccessMessage(`Payroll run berhasil DIKUNCI secara permanen pada ${formatDateTimeDisplay(res.locked_at)}.`);
      setTimeout(() => setActionSuccessMessage(null), 5000);
    } catch (err: any) {
      alert(`Gagal mengunci payroll: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Add Manual Adjustment
  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRunId || !detailBarberId) return;
    const amt = parseFloat(adjAmount);
    if (isNaN(amt) || amt === 0) {
      setAdjError('Nominal penyesuaian tidak boleh nol.');
      return;
    }
    if (!adjReason.trim()) {
      setAdjError('Alasan penyesuaian wajib diisi.');
      return;
    }

    setSavingAdj(true);
    setAdjError(null);
    try {
      await addManualAdjustment(selectedRunId, detailBarberId, {
        amount: amt,
        reason: adjReason.trim(),
        note: adjNote.trim() || undefined,
      });
      // Refresh details
      await loadBarberDetail(detailBarberId);
      await loadRunDetail(selectedRunId);
      await loadRuns();
      setShowAdjForm(false);
      setAdjAmount('');
      setAdjReason('');
      setAdjNote('');
    } catch (err: any) {
      setAdjError(err.message || 'Gagal menambahkan penyesuaian manual.');
    } finally {
      setSavingAdj(false);
    }
  };

  // Delete Manual Adjustment
  const handleDeleteAdjustment = async (adjId: string) => {
    if (!selectedRunId || !detailBarberId) return;
    if (!window.confirm('Hapus penyesuaian manual ini?')) return;
    try {
      await deleteManualAdjustment(selectedRunId, adjId);
      await loadBarberDetail(detailBarberId);
      await loadRunDetail(selectedRunId);
      await loadRuns();
    } catch (err: any) {
      alert(`Gagal menghapus penyesuaian: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-rb-text-muted">
          <Link to="/payroll" className="hover:text-rb-text">
            Payroll
          </Link>
          <span>/</span>
          <span className="font-semibold text-rb-text">Kapster Payroll (Draft & Snapshot)</span>
        </div>
        {selectedRunId && (
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="text-sm font-semibold text-rb-red hover:underline"
          >
            ← Kembali ke Semua Payroll Runs
          </button>
        )}
      </div>

      {actionSuccessMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-400">
          ✓ {actionSuccessMessage}
        </div>
      )}

      {/* VIEW 1: RUN DETAIL VIEW (if selectedRunId is set) */}
      {selectedRunId ? (
        loadingRunDetail ? (
          <LoadingState label="Memuat rincian draft payroll..." />
        ) : runDetailError ? (
          <ErrorState message={runDetailError} onRetry={() => loadRunDetail(selectedRunId)} />
        ) : selectedRun ? (
          <div className="space-y-6">
            {/* Header with Run Info & Actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-rb-border bg-rb-surface p-6 shadow-sm">
              <div>
                <div className="flex items-center space-x-3">
                  <h1 className="text-2xl font-bold tracking-tight text-rb-text">
                    Periode: {formatDateDisplay(selectedRun.period_start)} – {formatDateDisplay(selectedRun.period_end)}
                  </h1>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase ${
                      selectedRun.status === 'LOCKED'
                        ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                        : 'border border-amber-500/30 bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {selectedRun.status === 'LOCKED' ? '🔒 LOCKED' : '📝 DRAFT'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-rb-text-muted">
                  <span>Dibuat: {formatDateTimeDisplay(selectedRun.generated_at)} ({selectedRun.generated_by})</span>
                  {selectedRun.locked_at && (
                    <span className="text-emerald-400">
                      Dikunci: {formatDateTimeDisplay(selectedRun.locked_at)} oleh {selectedRun.locked_by}
                    </span>
                  )}
                  <span>Versi Kalkulasi: {selectedRun.calculation_version}</span>
                </div>
              </div>

              {/* Action Buttons */}
              {isOwner && (
                <div className="flex items-center space-x-3">
                  {selectedRun.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleRegenerate(selectedRun.id)}
                        disabled={actionInProgress !== null}
                        className="inline-flex items-center rounded-xl border border-rb-border bg-rb-surface-card px-4 py-2.5 text-sm font-semibold text-rb-text hover:bg-rb-divider disabled:opacity-50"
                      >
                        {actionInProgress === 'regenerate' ? 'Meregenerasi...' : '🔄 Regenerasi Draft'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLock(selectedRun.id)}
                        disabled={actionInProgress !== null || runBlockers.length > 0}
                        title={runBlockers.length > 0 ? 'Selesaikan semua blocker sebelum mengunci payroll' : 'Kunci draft payroll secara permanen'}
                        className="inline-flex items-center rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionInProgress === 'lock' ? 'Mengunci...' : '🔒 Kunci Payroll'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Blocking Issues Alert Banner */}
            {runBlockers.length > 0 && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5">
                <div className="flex items-center space-x-2 text-rose-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="font-bold">
                    Terdapat {runBlockers.length} Isu Pemblokir (Locking Blocked)
                  </h3>
                </div>
                <p className="mt-1 text-xs text-rose-300">
                  Draft payroll tidak dapat dikunci menjadi catatan historis resmi sebelum seluruh kendala di bawah ini diselesaikan:
                </p>
                <ul className="mt-3 space-y-2">
                  {runBlockers.map((b, idx) => (
                    <li key={idx} className="flex items-start space-x-2 text-xs text-rose-200">
                      <span className="font-bold">• [{b.type}]:</span>
                      <span>{b.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatCard
                label="Net Service Revenue"
                value={formatRupiah(selectedRun.total_service_revenue)}
                trend="Layanan eligible"
                tint="blue"
              />
              <StatCard
                label="Total Komisi"
                value={formatRupiah(selectedRun.total_commission)}
                trend="Bagi hasil kapster"
                tint="green"
              />
              <StatCard
                label="Total Penyesuaian"
                value={formatRupiah(selectedRun.total_adjustments)}
                trend="Bonus / potongan"
                tint="purple"
              />
              <StatCard
                label="Estimasi Payable"
                value={formatRupiah(selectedRun.total_payable)}
                trend="Komisi + penyesuaian"
                tint="teal"
              />
              <StatCard
                label="Status Blockers"
                value={String(runBlockers.length)}
                trend={runBlockers.length === 0 ? 'Siap Dikunci' : 'Perlu Perbaikan'}
                tint={runBlockers.length === 0 ? 'green' : 'red'}
              />
            </div>

            {/* Barber Summary Table */}
            <div className="rounded-2xl border border-rb-border bg-rb-surface p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-rb-text">Rincian Bagi Hasil per Kapster</h3>
                  <p className="text-xs text-rb-text-muted">
                    {selectedRun.status === 'LOCKED'
                      ? 'Nilai di bawah ini merupakan data snapshot historis resmi yang telah dikunci.'
                      : 'Draft kalkulasi berbasis item-level Moka dan konfigurasi komisi historis.'}
                  </p>
                </div>
                <div className="text-xs text-rb-text-muted">
                  Total Kapster: <span className="font-semibold text-rb-text">{visibleBarbers.length}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-rb-text">
                  <thead className="border-b border-rb-border bg-rb-surface-card/60 text-xs font-semibold text-rb-text-muted">
                    <tr>
                      <th className="px-4 py-3">Kapster</th>
                      <th className="px-4 py-3">Cabang</th>
                      <th className="px-4 py-3 text-right">Layanan</th>
                      <th className="px-4 py-3 text-right">Net Revenue</th>
                      <th className="px-4 py-3 text-right">Komisi</th>
                      <th className="px-4 py-3 text-right">Penyesuaian</th>
                      <th className="px-4 py-3 text-right">Payable</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rb-border text-xs">
                    {visibleBarbers.map((b) => (
                      <tr key={b.id} className="hover:bg-rb-surface-card/40 transition-colors">
                        <td className="px-4 py-3.5 font-bold text-rb-text">
                          {b.barber_name_snapshot}
                        </td>
                        <td className="px-4 py-3.5 text-rb-text-muted uppercase">
                          {b.branch_snapshot}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium">
                          {b.service_item_count} ({b.receipt_count} struk)
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium">
                          {formatRupiah(b.net_service_revenue)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold text-emerald-400">
                          {formatRupiah(b.commission_amount)}
                        </td>
                        <td className={`px-4 py-3.5 text-right font-mono font-medium ${
                          b.manual_adjustment_total > 0
                            ? 'text-blue-400'
                            : b.manual_adjustment_total < 0
                            ? 'text-rose-400'
                            : 'text-rb-text-muted'
                        }`}>
                          {b.manual_adjustment_total !== 0 ? formatRupiah(b.manual_adjustment_total) : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-rb-text">
                          {formatRupiah(b.payable_amount)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              b.status === 'READY'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => setDetailBarberId(b.barber_id)}
                            className="rounded-lg border border-rb-border bg-rb-surface-card px-3 py-1.5 font-semibold text-rb-text hover:bg-rb-divider"
                          >
                            Rincian →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null
      ) : (
        /* VIEW 2: ALL PAYROLL RUNS LIST */
        <div className="space-y-6">
          <PageHeader
            title="Kapster Payroll Drafts & Historical Snapshots"
            subtitle="Engine draft penggajian kapster berbasis data transaksi Moka kanonikal, histori rate komisi presisi, dan penguncian permanen (immutable)."
            actions={
              isOwner ? (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center rounded-xl bg-rb-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rb-red-dark transition-all"
                >
                  + Buat Draft Payroll
                </button>
              ) : undefined
            }
          />

          {loadingRuns ? (
            <LoadingState label="Memuat daftar payroll runs..." />
          ) : runsError ? (
            <ErrorState message={runsError} onRetry={loadRuns} />
          ) : runs.length === 0 ? (
            <div className="rounded-2xl border border-rb-border bg-rb-surface p-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rb-surface-card text-rb-text-muted">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-rb-text">Belum Ada Payroll Run</h3>
              <p className="mt-1 text-sm text-rb-text-muted">
                Pilih periode dan buat draft payroll pertama untuk memulai kalkulasi bagi hasil kapster.
              </p>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 inline-flex items-center rounded-xl bg-rb-red px-4 py-2 text-xs font-semibold text-white hover:bg-rb-red-dark"
                >
                  + Buat Draft Payroll
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-rb-border bg-rb-surface p-6 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-rb-text">
                  <thead className="border-b border-rb-border bg-rb-surface-card/60 text-xs font-semibold text-rb-text-muted">
                    <tr>
                      <th className="px-4 py-3">Periode</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Kapster</th>
                      <th className="px-4 py-3 text-right">Net Revenue</th>
                      <th className="px-4 py-3 text-right">Komisi</th>
                      <th className="px-4 py-3 text-right">Penyesuaian</th>
                      <th className="px-4 py-3 text-right">Payable</th>
                      <th className="px-4 py-3 text-center">Blockers</th>
                      <th className="px-4 py-3">Dibuat Pada</th>
                      <th className="px-4 py-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rb-border text-xs">
                    {runs.map((r) => (
                      <tr key={r.id} className="hover:bg-rb-surface-card/40 transition-colors">
                        <td className="px-4 py-3.5 font-bold text-rb-text whitespace-nowrap">
                          {formatDateDisplay(r.period_start)} – {formatDateDisplay(r.period_end)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              r.status === 'LOCKED'
                                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border border-amber-500/30 bg-amber-500/10 text-amber-400'
                            }`}
                          >
                            {r.status === 'LOCKED' ? '🔒 LOCKED' : '📝 DRAFT'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium">
                          {r.barber_count}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium">
                          {formatRupiah(r.total_service_revenue)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold text-emerald-400">
                          {formatRupiah(r.total_commission)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium text-rb-text-muted">
                          {r.total_adjustments !== 0 ? formatRupiah(r.total_adjustments) : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-rb-text">
                          {formatRupiah(r.total_payable)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {r.blocking_issues_count > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-400">
                              {r.blocking_issues_count} Isu
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                              ✓ Bersih
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-rb-text-muted whitespace-nowrap">
                          {formatDateTimeDisplay(r.generated_at)}
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedRunId(r.id)}
                            className="rounded-lg border border-rb-border bg-rb-surface-card px-3 py-1.5 font-semibold text-rb-text hover:bg-rb-divider"
                          >
                            Buka Detail →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE DRAFT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-rb-border bg-rb-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rb-text">Buat Draft Payroll Kapster</h3>
            <p className="mt-1 text-xs text-rb-text-muted">
              Pilih rentang tanggal transaksi untuk mengumpulkan data layanan Moka kanonikal dan menerapkan konfigurasi komisi historis.
            </p>

            {createModalError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                {createModalError}
              </div>
            )}

            <form onSubmit={handleCreateDraft} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-rb-text-muted">Tanggal Awal (Period Start)</label>
                <input
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-rb-border bg-rb-surface-card px-3.5 py-2.5 text-sm text-rb-text focus:border-rb-red focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-rb-text-muted">Tanggal Akhir (Period End)</label>
                <input
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-rb-border bg-rb-surface-card px-3.5 py-2.5 text-sm text-rb-text focus:border-rb-red focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300">
                Catatan: Draft dapat diregenerasi sewaktu-waktu selama berstatus DRAFT. Penguncian (LOCK) hanya dapat dilakukan jika 0 issue pemblokir.
              </div>

              <div className="mt-6 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creatingDraft}
                  className="rounded-xl border border-rb-border bg-transparent px-4 py-2 text-xs font-semibold text-rb-text-muted hover:bg-rb-surface-card"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creatingDraft}
                  className="rounded-xl bg-rb-red px-5 py-2 text-xs font-semibold text-white hover:bg-rb-red-dark disabled:opacity-50"
                >
                  {creatingDraft ? 'Membuat Draft...' : 'Generate Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BARBER DETAIL DRAWER */}
      {detailBarberId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <div className="relative flex h-full w-full max-w-4xl flex-col bg-rb-surface shadow-2xl border-l border-rb-border">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-rb-border p-6">
              <div>
                <div className="flex items-center space-x-3">
                  <h2 className="text-xl font-bold text-rb-text">
                    {detailBarber?.barber_name_snapshot || 'Rincian Kapster'}
                  </h2>
                  <span className="rounded-md border border-rb-border bg-rb-surface-card px-2 py-0.5 text-xs font-semibold uppercase text-rb-text-muted">
                    Cabang: {detailBarber?.branch_snapshot}
                  </span>
                </div>
                <p className="mt-1 text-xs text-rb-text-muted">
                  Snapshot transaksi historis dan penyesuaian manual pada periode payroll ini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailBarberId(null)}
                className="rounded-lg p-2 text-rb-text-muted hover:bg-rb-surface-card hover:text-rb-text"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loadingBarberDetail ? (
                <LoadingState label="Memuat detail layanan & komisi..." />
              ) : barberDetailError ? (
                <ErrorState message={barberDetailError} onRetry={() => loadBarberDetail(detailBarberId)} />
              ) : detailBarber ? (
                <>
                  {/* Attendance Context Card (Informational Only) */}
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-base">📅</span>
                        <h4 className="text-sm font-bold text-blue-400">
                          Attendance Context (Konteks Kehadiran)
                        </h4>
                      </div>
                      <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                        INFORMASIONAL
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-rb-surface-card p-2.5">
                        <div className="text-xs text-rb-text-muted">Hari Hadir</div>
                        <div className="text-lg font-bold text-rb-text">
                          {detailAttendance?.days_present ?? 0}
                        </div>
                      </div>
                      <div className="rounded-lg bg-rb-surface-card p-2.5">
                        <div className="text-xs text-rb-text-muted">Keterlambatan</div>
                        <div className="text-lg font-bold text-rb-text">
                          {detailAttendance?.late_count ?? 0} kali
                        </div>
                      </div>
                      <div className="rounded-lg bg-rb-surface-card p-2.5">
                        <div className="text-xs text-rb-text-muted">Isu Kehadiran</div>
                        <div className="text-lg font-bold text-rb-text">
                          {detailAttendance?.attendance_exceptions ?? 0}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-blue-300/80">
                      * Sesuai regulasi Task 2.3, kehadiran belum memotong otomatis (Rp15k) maupun menambah lembur otomatis (Rp7.5k).
                    </p>
                  </div>

                  {/* Financial Snapshot Summary */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-xl border border-rb-border bg-rb-surface-card p-3">
                      <div className="text-[11px] text-rb-text-muted">Gross Revenue</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-rb-text">
                        {formatRupiah(detailBarber.gross_service_revenue)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rb-border bg-rb-surface-card p-3">
                      <div className="text-[11px] text-rb-text-muted">Net Revenue</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-rb-text">
                        {formatRupiah(detailBarber.net_service_revenue)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rb-border bg-rb-surface-card p-3">
                      <div className="text-[11px] text-rb-text-muted">Komisi Layanan</div>
                      <div className="mt-1 font-mono text-sm font-bold text-emerald-400">
                        {formatRupiah(detailBarber.commission_amount)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-rb-border bg-rb-surface-card p-3">
                      <div className="text-[11px] text-rb-text-muted">Total Payable</div>
                      <div className="mt-1 font-mono text-sm font-bold text-rb-text">
                        {formatRupiah(detailBarber.payable_amount)}
                      </div>
                    </div>
                  </div>

                  {/* Manual Adjustments Section */}
                  <div className="rounded-2xl border border-rb-border bg-rb-surface-card/40 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-bold text-rb-text">Penyesuaian Manual (Adjustments)</h4>
                        <p className="text-[11px] text-rb-text-muted">
                          Koreksi manual (bonus positif / potongan negatif) berjustifikasi.
                        </p>
                      </div>
                      {isOwner && selectedRun?.status === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={() => setShowAdjForm(!showAdjForm)}
                          className="rounded-lg bg-rb-surface-card border border-rb-border px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-divider"
                        >
                          {showAdjForm ? 'Tutup Form' : '+ Tambah Penyesuaian'}
                        </button>
                      )}
                    </div>

                    {/* Adjustment Form */}
                    {showAdjForm && (
                      <form onSubmit={handleAddAdjustment} className="mb-4 rounded-xl border border-rb-border bg-rb-surface p-4 space-y-3">
                        <div className="font-semibold text-xs text-rb-text">Form Penyesuaian Baru</div>
                        {adjError && (
                          <div className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg">
                            {adjError}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-rb-text-muted">
                              Nominal (Rp) — Gunakan minus (-) untuk potongan
                            </label>
                            <input
                              type="number"
                              value={adjAmount}
                              onChange={(e) => setAdjAmount(e.target.value)}
                              placeholder="Contoh: 50000 atau -25000"
                              required
                              className="mt-1 w-full rounded-lg border border-rb-border bg-rb-surface-card px-3 py-1.5 text-xs text-rb-text focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-rb-text-muted">
                              Alasan (Wajib)
                            </label>
                            <input
                              type="text"
                              value={adjReason}
                              onChange={(e) => setAdjReason(e.target.value)}
                              placeholder="Contoh: Bonus insentif target / Koreksi kasir"
                              required
                              className="mt-1 w-full rounded-lg border border-rb-border bg-rb-surface-card px-3 py-1.5 text-xs text-rb-text focus:outline-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] text-rb-text-muted">Catatan Tambahan (Opsional)</label>
                          <input
                            type="text"
                            value={adjNote}
                            onChange={(e) => setAdjNote(e.target.value)}
                            placeholder="Catatan klarifikasi atau nomor referensi"
                            className="mt-1 w-full rounded-lg border border-rb-border bg-rb-surface-card px-3 py-1.5 text-xs text-rb-text focus:outline-none"
                          />
                        </div>
                        <div className="flex justify-end space-x-2">
                          <button
                            type="button"
                            onClick={() => setShowAdjForm(false)}
                            className="rounded-lg px-3 py-1.5 text-xs text-rb-text-muted"
                          >
                            Batal
                          </button>
                          <button
                            type="submit"
                            disabled={savingAdj}
                            className="rounded-lg bg-rb-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-rb-red-dark disabled:opacity-50"
                          >
                            {savingAdj ? 'Menyimpan...' : 'Simpan Penyesuaian'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Adjustments List */}
                    {detailAdjustments.length === 0 ? (
                      <p className="text-xs text-rb-text-muted italic">
                        Tidak ada penyesuaian manual untuk kapster ini.
                      </p>
                    ) : (
                      <div className="divide-y divide-rb-border">
                        {detailAdjustments.map((a) => (
                          <div key={a.id} className="py-2.5 flex items-center justify-between text-xs">
                            <div>
                              <div className="font-semibold text-rb-text">{a.reason}</div>
                              {a.note && <div className="text-rb-text-muted">{a.note}</div>}
                              <div className="text-[10px] text-rb-text-muted mt-0.5">
                                Dibuat oleh {a.created_by} pada {formatDateTimeDisplay(a.created_at)}
                              </div>
                            </div>
                            <div className="flex items-center space-x-3">
                              <span className={`font-mono font-bold ${
                                a.amount > 0 ? 'text-blue-400' : 'text-rose-400'
                              }`}>
                                {a.amount > 0 ? '+' : ''}{formatRupiah(a.amount)}
                              </span>
                              {isOwner && selectedRun?.status === 'DRAFT' && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAdjustment(a.id)}
                                  className="text-rose-400 hover:text-rose-300 text-xs"
                                  title="Hapus penyesuaian"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Service Items Table */}
                  <div className="rounded-2xl border border-rb-border bg-rb-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-rb-text">
                        Snapshot Garis Layanan ({detailCommissionLines.length} Item)
                      </h4>
                      <span className="text-[11px] text-rb-text-muted">
                        Sumber kanonikal: moka_transaction_items
                      </span>
                    </div>

                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-left text-xs text-rb-text">
                        <thead className="border-b border-rb-border bg-rb-surface-card/60 sticky top-0 font-semibold text-rb-text-muted">
                          <tr>
                            <th className="px-3 py-2">Tanggal</th>
                            <th className="px-3 py-2">No. Struk</th>
                            <th className="px-3 py-2">Layanan</th>
                            <th className="px-3 py-2 text-right">Gross</th>
                            <th className="px-3 py-2 text-right">Diskon</th>
                            <th className="px-3 py-2 text-right">Net</th>
                            <th className="px-3 py-2 text-right">Rate</th>
                            <th className="px-3 py-2 text-right">Komisi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rb-border">
                          {detailCommissionLines.map((line) => (
                            <tr key={line.id} className="hover:bg-rb-surface-card/30">
                              <td className="px-3 py-2 whitespace-nowrap text-rb-text-muted">
                                {line.tx_date}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px]">
                                {line.receipt_number}
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {line.service_name_snapshot}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {formatRupiah(line.gross_amount)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-rb-text-muted">
                                {line.discount_amount > 0 ? formatRupiah(line.discount_amount) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-medium">
                                {formatRupiah(line.net_amount)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {(line.commission_rate_used * 100).toFixed(0)}%
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                                {formatRupiah(line.commission_amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
