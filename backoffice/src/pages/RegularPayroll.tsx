import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  fetchRegularPayrollRuns,
  fetchRegularPayrollRunDetail,
  generateRegularPayrollDraft,
  lockRegularPayrollRun,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  defaultApprovedOvertimeMinutes,
  type RegularPayrollRun,
  type RegularPayrollItem,
  type OvertimeApproval,
} from '../services/regularPayroll';
import {
  fetchOvertimeApprovals,
  reviewOvertimeApproval,
  syncOvertimeCandidates,
} from '../services/regularPayroll';
import { useAuth } from '../auth/AuthProvider';

const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function RegularPayroll() {
  let isOwner = false;
  let isManager = false;
  try {
    const auth = useAuth();
    isOwner = auth.role === 'owner';
    isManager = auth.role === 'manager' || auth.role === 'owner';
  } catch {
    // Graceful fallback when rendered without AuthProvider in standalone tests
    isOwner = true;
    isManager = true;
  }

  // Runs & active run state
  const [runs, setRuns] = useState<RegularPayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<RegularPayrollRun | null>(null);
  const [items, setItems] = useState<RegularPayrollItem[]>([]);

  // Page status
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [unitFilter, setUnitFilter] = useState<'all' | 'Redbox' | 'Sundaze'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawer
  const [detailItem, setDetailItem] = useState<RegularPayrollItem | null>(null);
  const [adjustmentTargetItem, setAdjustmentTargetItem] = useState<RegularPayrollItem | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isOvertimeModalOpen, setIsOvertimeModalOpen] = useState(false);

  // Overtime Review State
  const [overtimeApprovals, setOvertimeApprovals] = useState<OvertimeApproval[]>([]);
  const [overtimeLoading, setOvertimeLoading] = useState(false);
  const [overtimeMinutesInput, setOvertimeMinutesInput] = useState<Record<string, number>>({});
  const [overtimeNoteInput, setOvertimeNoteInput] = useState<Record<string, string>>({});

  // Generate Draft form state
  const [genPeriodStart, setGenPeriodStart] = useState('2026-08-26');
  const [genPeriodEnd, setGenPeriodEnd] = useState('2026-09-25');
  const [genBusinessUnit, setGenBusinessUnit] = useState('ALL');

  // Adjustment form state
  const [adjType, setAdjType] = useState<'BONUS' | 'DEDUCTION' | 'DEBT' | 'CORRECTION'>('DEBT');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjNote, setAdjNote] = useState('');

  // 1. Initial load of runs
  const loadRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRegularPayrollRuns();
      const runList = res?.runs || [];
      setRuns(runList);
      if (runList.length > 0) {
        const initialRun = selectedRunId
          ? runList.find((r) => r.id === selectedRunId) || runList[0]
          : runList[0];
        setSelectedRunId(initialRun.id);
        await loadRunDetail(initialRun.id);
      } else {
        setActiveRun(null);
        setItems([]);
        setLoading(false);
      }
    } catch (err: any) {
      setRuns([]);
      setError(err?.message || 'Gagal memuat riwayat payroll reguler.');
      setLoading(false);
    }
  };

  const loadRunDetail = async (runId: string) => {
    try {
      const res = await fetchRegularPayrollRunDetail(runId);
      setActiveRun(res.run);
      setItems(res.items);
      // Keep detailItem refreshed if open
      if (detailItem) {
        const refreshed = res.items.find((i) => i.id === detailItem.id);
        if (refreshed) setDetailItem(refreshed);
      }
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat rincian payroll reguler.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    setLoading(true);
    await loadRunDetail(runId);
  };

  // 2. Generate Draft
  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await generateRegularPayrollDraft({
        period_start: genPeriodStart,
        period_end: genPeriodEnd,
        business_unit: genBusinessUnit,
      });
      setIsGenerateModalOpen(false);
      setActionMessage({ type: 'success', text: 'Draft payroll reguler berhasil dibuat.' });
      await loadRuns();
      if (res.run_id) {
        setSelectedRunId(res.run_id);
        await loadRunDetail(res.run_id);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal membuat draft payroll reguler.' });
    } finally {
      setActionLoading(false);
    }
  };

  // 3. Lock Payroll
  const handleLockRun = async () => {
    if (!activeRun) return;
    const confirm = window.confirm(
      `Apakah Anda yakin ingin mengunci (LOCK) payroll periode ${activeRun.period_start} s/d ${activeRun.period_end}? Setelah dikunci, data snapshot menjadi permanen dan tidak dapat diubah lagi.`
    );
    if (!confirm) return;

    setActionLoading(true);
    setActionMessage(null);
    try {
      await lockRegularPayrollRun(activeRun.id);
      setActionMessage({ type: 'success', text: 'Payroll run berhasil dikunci secara permanen (LOCKED).' });
      await loadRunDetail(activeRun.id);
      await loadRuns();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal mengunci payroll run.' });
    } finally {
      setActionLoading(false);
    }
  };

  // 4. Add Adjustment
  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRun || !adjustmentTargetItem) return;
    const numAmount = Number(adjAmount);
    if (!numAmount || numAmount <= 0) {
      alert('Jumlah nominal penyesuaian harus lebih dari 0.');
      return;
    }
    if (!adjReason.trim()) {
      alert('Alasan penyesuaian wajib diisi.');
      return;
    }

    setActionLoading(true);
    try {
      await addRegularPayrollAdjustment({
        runId: activeRun.id,
        payroll_regular_item_id: adjustmentTargetItem.id,
        employee_id: adjustmentTargetItem.employee_id,
        type: adjType,
        amount: numAmount,
        reason: adjReason,
        note: adjNote,
      });
      setAdjustmentTargetItem(null);
      setAdjAmount('');
      setAdjReason('');
      setAdjNote('');
      setActionMessage({ type: 'success', text: 'Penyesuaian manual berhasil ditambahkan.' });
      await loadRunDetail(activeRun.id);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal menambahkan penyesuaian.' });
    } finally {
      setActionLoading(false);
    }
  };

  // 5. Delete Adjustment
  const handleDeleteAdjustment = async (adjId: string) => {
    if (!activeRun) return;
    const ok = window.confirm('Hapus penyesuaian ini?');
    if (!ok) return;

    setActionLoading(true);
    try {
      await deleteRegularPayrollAdjustment(adjId);
      setActionMessage({ type: 'success', text: 'Penyesuaian berhasil dihapus.' });
      await loadRunDetail(activeRun.id);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal menghapus penyesuaian.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Overtime Review Handlers
  const loadOvertimeList = async () => {
    if (!activeRun) return;
    setOvertimeLoading(true);
    try {
      const res = await fetchOvertimeApprovals({
        period_start: activeRun.period_start,
        period_end: activeRun.period_end,
      });
      setOvertimeApprovals(res.approvals || []);
      const initialMinutes: Record<string, number> = {};
      const initialNotes: Record<string, string> = {};
      for (const ot of res.approvals || []) {
        initialMinutes[ot.id] = defaultApprovedOvertimeMinutes(ot);
        initialNotes[ot.id] = ot.note || '';
      }
      setOvertimeMinutesInput(initialMinutes);
      setOvertimeNoteInput(initialNotes);
    } catch (err: any) {
      console.error('Gagal memuat kandidat lembur:', err);
    } finally {
      setOvertimeLoading(false);
    }
  };

  const handleSyncOvertime = async () => {
    if (!activeRun) return;
    setOvertimeLoading(true);
    try {
      await syncOvertimeCandidates({
        period_start: activeRun.period_start,
        period_end: activeRun.period_end,
      });
      await loadOvertimeList();
      setActionMessage({ type: 'success', text: 'Kandidat lembur berhasil disinkronkan dari presensi.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal sinkronisasi lembur.' });
    } finally {
      setOvertimeLoading(false);
    }
  };

  const handleReviewOvertime = async (otId: string, status: 'APPROVED' | 'REJECTED') => {
    setActionLoading(true);
    try {
      const approvedMinutes = status === 'APPROVED' ? (overtimeMinutesInput[otId] ?? 0) : 0;
      const note = overtimeNoteInput[otId] || '';
      await reviewOvertimeApproval(otId, {
        status,
        approved_minutes: approvedMinutes,
        note,
      });
      setActionMessage({ type: 'success', text: `Lembur berhasil di-${status === 'APPROVED' ? 'setujui' : 'tolak'}.` });
      await loadOvertimeList();
      if (activeRun) {
        await loadRunDetail(activeRun.id);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Gagal memperbarui status lembur.' });
      // The approval may have been saved even though payroll could not follow (e.g. run locked meanwhile).
      await loadOvertimeList();
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered table items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (unitFilter !== 'all' && item.business_unit_snapshot !== unitFilter) return false;
      if (branchFilter !== 'all' && item.branch_snapshot?.toLowerCase() !== branchFilter.toLowerCase()) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.employee_name_snapshot.toLowerCase().includes(q);
        const matchesNick = item.employee_nickname_snapshot?.toLowerCase().includes(q);
        const matchesPos = item.position_snapshot.toLowerCase().includes(q);
        if (!matchesName && !matchesNick && !matchesPos) return false;
      }
      return true;
    });
  }, [items, unitFilter, branchFilter, statusFilter, searchQuery]);

  // Blocking safety guard items
  const blockingItems = useMemo(() => {
    return items.filter(
      (item) =>
        item.status === 'MISSING_ATTENDANCE' ||
        item.status === 'MISSING_SALARY' ||
        item.status === 'BLOCKED_ATTENDANCE_SOURCE'
    );
  }, [items]);

  const isLockBlocked = blockingItems.length > 0;

  // Summary Metrics
  const summary = useMemo(() => {
    const totalEmp = filteredItems.length;
    let gross = 0;
    let deduction = 0;
    let takeHome = 0;
    let reviewCount = 0;

    for (const it of filteredItems) {
      gross += Number(it.gross_pay || 0);
      deduction += Number(it.total_deduction || 0);
      takeHome += Number(it.take_home_pay || 0);
      if (
        it.status === 'REVIEW_REQUIRED' ||
        it.status === 'MISSING_SALARY' ||
        it.status === 'MISSING_ATTENDANCE' ||
        it.status === 'BLOCKED_ATTENDANCE_SOURCE'
      ) {
        reviewCount++;
      }
    }

    return { totalEmp, gross, deduction, takeHome, reviewCount };
  }, [filteredItems]);

  const sundazeCount = useMemo(
    () => items.filter((e) => e.business_unit_snapshot === 'Sundaze').length,
    [items]
  );
  const redboxCount = useMemo(
    () => items.filter((e) => e.business_unit_snapshot === 'Redbox').length,
    [items]
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <Link to="/payroll" className="inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text">
          ← Kembali ke Payroll
        </Link>
        <div className="flex items-center gap-2">
          {isManager && activeRun && (
            <button
              type="button"
              onClick={() => {
                setIsOvertimeModalOpen(true);
                loadOvertimeList();
              }}
              className="rounded-rb-button border border-rb-border bg-rb-surface px-3.5 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
            >
              ⏰ Tinjau Lembur
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => setIsGenerateModalOpen(true)}
              className="rounded-rb-button bg-rb-red px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700"
            >
              + Buat Payroll Draft Baru
            </button>
          )}
          {activeRun && activeRun.status === 'DRAFT' && isOwner && (
            <button
              type="button"
              onClick={handleLockRun}
              disabled={actionLoading || isLockBlocked}
              title={
                isLockBlocked
                  ? `Payroll tidak dapat dikunci jika terdapat ${blockingItems.length} karyawan berstatus belum lengkap.`
                  : 'Kunci payroll run secara permanen.'
              }
              className={`rounded-rb-button px-3.5 py-1.5 text-xs font-semibold transition ${
                isLockBlocked
                  ? 'cursor-not-allowed border border-gray-300 bg-gray-100 text-gray-400 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-500'
                  : 'border border-amber-500 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
              }`}
            >
              🔒 Kunci Payroll (Lock)
            </button>
          )}
        </div>
      </div>

      <PageHeader
        title="Regular Payroll"
        subtitle="Perhitungan gaji staf reguler (kasir, helper, barista, kitchen) terintegrasi dengan presensi, kompensasi master, dan kebijakan operasional."
      />

      {actionMessage && (
        <div
          className={`mb-4 rounded-rb-card p-3 text-xs font-semibold ${
            actionMessage.type === 'success'
              ? 'bg-rb-green-tint-bg text-rb-green-tint-fg border border-emerald-500/20'
              : 'bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {loading && !activeRun && <LoadingState label="Memuat data payroll reguler..." />}
      {error && !activeRun && <ErrorState message={error} />}

      {/* Run Selector Bar */}
      {(runs || []).length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-rb-card border border-rb-border bg-rb-surface p-3.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Periode Payroll:
          </span>
          <select
            value={selectedRunId || ''}
            onChange={(e) => handleSelectRun(e.target.value)}
            className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text"
          >
            {(runs || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.period_start} s/d {r.period_end} ({r.business_unit}) — [{r.status}]
              </option>
            ))}
          </select>

          {activeRun && (
            <div className="flex items-center gap-2">
              <span
                className={`rounded-rb-pill px-2.5 py-0.5 text-[11px] font-semibold ${
                  activeRun.status === 'LOCKED'
                    ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {activeRun.status === 'LOCKED' ? 'TERKUNCI (LOCKED)' : 'DRAFT AKTIF'}
              </span>
              <span className="text-xs text-rb-text-muted">
                Versi kalkulasi: {activeRun.calculation_version}
              </span>
            </div>
          )}
        </div>
      )}

      {(runs || []).length === 0 && !loading && (
        <div className="mb-8 rounded-rb-card border border-rb-border bg-rb-surface p-8 text-center">
          <div className="text-base font-semibold text-rb-text">Belum ada periode payroll reguler</div>
          <p className="mt-1 text-xs text-rb-text-muted">
            Klik tombol &ldquo;+ Buat Payroll Draft Baru&rdquo; untuk memulai perhitungan periode berjalan.
          </p>
        </div>
      )}

      {activeRun && (
        <>
          {/* Header Metric Cards */}
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              value={summary.totalEmp}
              label={`Total Karyawan (${sundazeCount} SD · ${redboxCount} RB)`}
              tint="blue"
            />
            <StatCard
              value={formatRupiah(summary.gross)}
              label="Total Gaji Kotor (Gross)"
              tint="blue"
            />
            <StatCard
              value={formatRupiah(summary.deduction)}
              label="Total Potongan (Deduction)"
              tint="purple"
            />
            <StatCard
              value={formatRupiah(summary.takeHome)}
              label="Total Take-Home Pay"
              tint="green"
            />
            <StatCard
              value={summary.reviewCount}
              label="Review Diperlukan"
              trend={summary.reviewCount > 0 ? 'Perlu konfirmasi' : 'Semua Siap'}
              tint={summary.reviewCount > 0 ? 'yellow' : 'green'}
            />
          </section>

          {/* Safety Guard Warning Banner if Draft has Blockers */}
          {activeRun.status === 'DRAFT' && isLockBlocked && (
            <div className="mb-6 rounded-rb-card border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2 font-bold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                <span>⚠️ PAYROLL SAFETY GUARD AKTIF — PENGUNCIAN (LOCK) DITANGGUHKAN</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed">
                Terdapat <strong>{blockingItems.length} karyawan</strong> dengan status data belum memadai (presensi belum diimpor / cabang belum terintegrasi / gaji pokok kosong). Angka take-home pay belum bersifat final dan sistem secara ketat memblokir penguncian (LOCK) payroll untuk mencegah kekeliruan pembayaran gaji.
              </p>
            </div>
          )}

          {/* Filter & Search Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setUnitFilter('all')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  unitFilter === 'all'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Semua ({items.length})
              </button>
              <button
                type="button"
                onClick={() => setUnitFilter('Sundaze')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  unitFilter === 'Sundaze'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Sundaze ({sundazeCount})
              </button>
              <button
                type="button"
                onClick={() => setUnitFilter('Redbox')}
                className={`rounded-rb-pill px-3 py-1.5 text-xs font-semibold transition ${
                  unitFilter === 'Redbox'
                    ? 'bg-rb-red text-white'
                    : 'bg-rb-surface text-rb-text-secondary border border-rb-border hover:bg-rb-surface-hover'
                }`}
              >
                Redbox ({redboxCount})
              </button>

              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-2.5 py-1.5 text-xs font-medium text-rb-text"
              >
                <option value="all">Semua Cabang</option>
                <option value="bypass">Bypass</option>
                <option value="csb">CSB</option>
                <option value="samadikun">Samadikun</option>
                <option value="sumber">Sumber</option>
                <option value="tegal">Tegal</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-2.5 py-1.5 text-xs font-medium text-rb-text"
              >
                <option value="all">Semua Status</option>
                <option value="READY">READY</option>
                <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
                <option value="BLOCKED_ATTENDANCE_SOURCE">BLOCKED_ATTENDANCE_SOURCE</option>
                <option value="MISSING_ATTENDANCE">MISSING_ATTENDANCE</option>
                <option value="MISSING_SALARY">MISSING_SALARY</option>
                <option value="LOCKED">LOCKED</option>
              </select>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Cari nama atau jabatan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text placeholder:text-rb-text-muted focus:outline-none focus:ring-1 focus:ring-rb-red"
              />
            </div>
          </div>

          {/* Regular Payroll Table */}
          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface shadow-sm">
            <div className="grid grid-cols-[1.3fr_0.9fr_0.9fr_0.7fr_0.5fr_0.9fr_0.9fr_0.8fr_1fr_0.8fr_0.9fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Karyawan</div>
              <div>Unit</div>
              <div>Posisi</div>
              <div>Cabang</div>
              <div className="text-center">HK</div>
              <div className="text-right">Gaji Pokok</div>
              <div className="text-right">Gaji Kotor</div>
              <div className="text-right">Potongan</div>
              <div className="text-right">Take-Home Pay</div>
              <div className="text-center">Status</div>
              <div className="text-center">Aksi</div>
            </div>

            <div className="flex flex-col divide-y divide-rb-divider">
              {filteredItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-rb-text-muted">
                  Tidak ada karyawan yang cocok dengan kriteria pencarian.
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1.3fr_0.9fr_0.9fr_0.7fr_0.5fr_0.9fr_0.9fr_0.8fr_1fr_0.8fr_0.9fr] items-center gap-2 px-4 py-3 text-sm hover:bg-rb-surface-hover/50"
                  >
                    <div>
                      <div className="font-semibold text-rb-text capitalize">{item.employee_name_snapshot}</div>
                      <div className="text-[11px] font-mono text-rb-text-faint">
                        {item.employee_nickname_snapshot || item.employee_id.slice(0, 8)}
                      </div>
                    </div>
                    <div>
                      <span
                        className={`inline-block rounded-rb-pill px-2.5 py-0.5 text-[10.5px] font-semibold ${
                          item.business_unit_snapshot === 'Sundaze'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
                        }`}
                      >
                        {item.business_unit_snapshot}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-rb-text-secondary">{item.position_snapshot}</div>
                    <div className="text-xs capitalize text-rb-text-muted">
                      {item.branch_snapshot ? (BRANCH_LABELS[item.branch_snapshot.toLowerCase()] ?? item.branch_snapshot) : '—'}
                    </div>
                    <div className="text-center font-mono text-xs font-semibold text-rb-text">
                      <div>{item.work_days}</div>
                      {item.attendance_coverage_status && item.attendance_coverage_status !== 'COMPLETE' && (
                        <div className="text-[9.5px] text-amber-600 dark:text-amber-400 font-sans">
                          {item.attendance_coverage_status === 'BLOCKED_SOURCE' ? 'No Source' : 'Gaps'}
                        </div>
                      )}
                    </div>
                    <div className="text-right font-mono text-xs text-rb-text-secondary">
                      {formatRupiah(item.base_salary)}
                    </div>
                    <div className="text-right font-mono text-xs font-medium text-rb-text">
                      {formatRupiah(item.gross_pay)}
                    </div>
                    <div className="text-right font-mono text-xs font-medium text-red-600 dark:text-red-400">
                      {item.total_deduction > 0 ? `-${formatRupiah(item.total_deduction)}` : 'Rp 0'}
                    </div>
                    <div className="text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {formatRupiah(item.take_home_pay)}
                    </div>
                    <div className="text-center">
                      <span
                        className={`inline-block rounded-rb-pill px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === 'READY'
                            ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                            : item.status === 'LOCKED'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            : item.status === 'BLOCKED_ATTENDANCE_SOURCE'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                            : item.status === 'MISSING_ATTENDANCE'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailItem(item)}
                        className="rounded-rb-button border border-rb-border bg-rb-surface px-2 py-1 text-[11px] font-semibold text-rb-text hover:bg-rb-surface-hover"
                      >
                        Detail
                      </button>
                      {activeRun.status === 'DRAFT' && isOwner && (
                        <button
                          type="button"
                          onClick={() => setAdjustmentTargetItem(item)}
                          className="rounded-rb-button border border-rb-border bg-rb-surface px-2 py-1 text-[11px] font-semibold text-rb-text hover:bg-rb-surface-hover"
                        >
                          +Adj
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* DETAIL DRAWER / MODAL */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-rb-divider pb-4">
              <div>
                <h2 className="text-base font-bold text-rb-text capitalize">{detailItem.employee_name_snapshot}</h2>
                <div className="text-xs text-rb-text-muted">
                  {detailItem.position_snapshot} · {detailItem.business_unit_snapshot} · Cabang{' '}
                  {detailItem.branch_snapshot || '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="rounded-rb-pill p-1.5 text-rb-text-muted hover:bg-rb-surface-hover hover:text-rb-text"
              >
                ✕
              </button>
            </div>

            {detailItem.warnings && detailItem.warnings.length > 0 && (
              <div className="mt-4 rounded-rb-card border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <div className="font-bold uppercase tracking-wide">Perhatian / Review Diperlukan:</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {detailItem.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Attendance Coverage Audit */}
            <div className="mt-4 rounded-rb-card border border-rb-border p-3.5 bg-rb-surface-hover/20">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
                <span>Coverage Presensi (Audit Kehadiran)</span>
                <span
                  className={`rounded-rb-pill px-2 py-0.5 text-[10px] font-semibold ${
                    detailItem.attendance_coverage_status === 'COMPLETE'
                      ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                      : detailItem.attendance_coverage_status === 'BLOCKED_SOURCE'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  {detailItem.attendance_coverage_status || 'UNKNOWN'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>Periode Diharapkan: <span className="font-mono">{detailItem.attendance_period_expected || '—'}</span></div>
                <div>Periode Tersedia di DB: <span className="font-mono">{detailItem.attendance_period_available || '—'}</span></div>
                <div>Hari Terdeteksi: <span className="font-mono font-semibold">{detailItem.attendance_coverage_days ?? detailItem.work_days} hari</span></div>
                <div>Status Audit: <span className="font-semibold">{detailItem.attendance_coverage_status || '—'}</span></div>
              </div>
              {detailItem.status === 'BLOCKED_ATTENDANCE_SOURCE' && (
                <div className="mt-2 text-[11px] text-purple-700 dark:text-purple-300 font-medium">
                  ℹ️ Karyawan unit Sundaze belum memiliki upload data fingerprint mesin periode ini. Sesuai kebijakan payroll safety guard, staf ini tidak dianggap alpa dan tidak menerima gaji Rp0, melainkan ditangguhkan sampai file diimpor.
                </div>
              )}
            </div>

            {/* Component Breakdown with Sources */}
            <div className="mt-5 space-y-4">
              {/* 1. Base Salary */}
              <div className="rounded-rb-card border border-rb-border p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
                  <span>1. Gaji Pokok &amp; Hari Kerja</span>
                  <span className="text-[10.5px] font-mono text-rb-text-faint">Sumber: MASTER DATA + PRESENSI</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>Gaji Pokok Master: <span className="font-mono font-semibold">{formatRupiah(detailItem.base_salary)}</span></div>
                  <div>Gaji Harian (/30): <span className="font-mono font-semibold">{formatRupiah(detailItem.daily_salary)}</span></div>
                  <div>Hari Masuk Kerja (HK): <span className="font-mono font-semibold">{detailItem.work_days} hari</span></div>
                  <div>Gaji Proporsional: <span className="font-mono font-bold text-rb-text">{formatRupiah(detailItem.actual_salary)}</span></div>
                </div>
              </div>

              {/* 2. Allowances */}
              <div className="rounded-rb-card border border-rb-border p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
                  <span>2. Tunjangan (Allowances)</span>
                  <span className="text-[10.5px] font-mono text-rb-text-faint">Sumber: KEBIJAKAN &amp; OVERRIDE</span>
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span>Uang Makan ({detailItem.meal_allowance_days} hari × {formatRupiah(detailItem.meal_allowance_rate)}):</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.meal_allowance_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tunjangan Jabatan:</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.position_allowance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tunjangan Absensi ({detailItem.attendance_allowance_source}):</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.attendance_allowance)}</span>
                  </div>
                </div>
              </div>

              {/* 3. Variables */}
              <div className="rounded-rb-card border border-rb-border p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
                  <span>3. Komponen Variabel</span>
                  <span className="text-[10.5px] font-mono text-rb-text-faint">Sumber: MOKA / MANUAL</span>
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span>Komisi Produk ({detailItem.product_commission_source}):</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.product_commission)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Service Barber ({detailItem.service_barber_source}):</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.service_barber_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Lembur ({detailItem.overtime_hours} jam × {formatRupiah(detailItem.overtime_rate)}):</span>
                    <span className="font-mono font-semibold">{formatRupiah(detailItem.overtime_amount)}</span>
                  </div>
                </div>
              </div>

              {/* 4. Deductions */}
              <div className="rounded-rb-card border border-rb-border p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
                  <span>4. Potongan (Deductions)</span>
                  <span className="text-[10.5px] font-mono text-rb-text-faint">Sumber: PRESENSI &amp; UTANG</span>
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span>Potongan Telat ({detailItem.late_count} kali · {detailItem.late_deduction_source}):</span>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                      -{formatRupiah(detailItem.late_deduction)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Utang / Kasbon:</span>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                      -{formatRupiah(detailItem.debt_deduction)}
                    </span>
                  </div>
                  {detailItem.manual_deduction > 0 && (
                    <div className="flex justify-between">
                      <span>Potongan Penyesuaian Lain:</span>
                      <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                        -{formatRupiah(detailItem.manual_deduction)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Adjustments List */}
              {detailItem.adjustments && detailItem.adjustments.length > 0 && (
                <div className="rounded-rb-card border border-rb-border p-3.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-rb-text-muted mb-2">
                    Daftar Penyesuaian Manual Periode Ini:
                  </div>
                  <div className="divide-y divide-rb-divider text-xs">
                    {detailItem.adjustments.map((adj) => (
                      <div key={adj.id} className="flex items-center justify-between py-1.5">
                        <div>
                          <span className="font-semibold text-rb-text">[{adj.type}]</span> {adj.reason}
                          {adj.note && <span className="text-rb-text-muted"> ({adj.note})</span>}
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <span>{formatRupiah(adj.amount)}</span>
                          {activeRun?.status === 'DRAFT' && isOwner && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAdjustment(adj.id)}
                              className="text-red-600 hover:underline"
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals Summary */}
              <div className="rounded-rb-card border-2 border-rb-border bg-rb-surface-hover/30 p-4">
                <div className="flex justify-between text-sm py-1">
                  <span className="font-medium text-rb-text">Total Pendapatan Kotor (Gross Pay):</span>
                  <span className="font-mono font-bold text-rb-text">{formatRupiah(detailItem.gross_pay)}</span>
                </div>
                <div className="flex justify-between text-sm py-1">
                  <span className="font-medium text-rb-text">Total Seluruh Potongan:</span>
                  <span className="font-mono font-bold text-red-600 dark:text-red-400">
                    -{formatRupiah(detailItem.total_deduction)}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-rb-divider pt-2 text-base font-bold">
                  <span className="text-rb-text">Take-Home Pay (Diterima):</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {formatRupiah(detailItem.take_home_pay)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE DRAFT MODAL */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleGenerateDraft}
            className="w-full max-w-md rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-xl"
          >
            <h3 className="text-base font-bold text-rb-text">Buat Draft Payroll Reguler Baru</h3>
            <p className="mt-1 text-xs text-rb-text-muted">
              Sistem akan menghitung hari kerja, lembur, dan keterlambatan dari data presensi periode berjalan.
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-rb-text">Tanggal Mulai (Period Start):</label>
                <input
                  type="date"
                  required
                  value={genPeriodStart}
                  onChange={(e) => setGenPeriodStart(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                />
              </div>

              <div>
                <label className="font-semibold text-rb-text">Tanggal Akhir (Period End):</label>
                <input
                  type="date"
                  required
                  value={genPeriodEnd}
                  onChange={(e) => setGenPeriodEnd(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                />
              </div>

              <div>
                <label className="font-semibold text-rb-text">Unit Bisnis:</label>
                <select
                  value={genBusinessUnit}
                  onChange={(e) => setGenBusinessUnit(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                >
                  <option value="ALL">Semua (Redbox &amp; Sundaze)</option>
                  <option value="Redbox">Khusus Redbox Barbershop</option>
                  <option value="Sundaze">Khusus Sundaze Cafe</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsGenerateModalOpen(false)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="rounded-rb-button bg-rb-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Menghitung...' : 'Mulai Hitung Draft'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADD ADJUSTMENT MODAL */}
      {adjustmentTargetItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleAddAdjustment}
            className="w-full max-w-md rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-xl"
          >
            <h3 className="text-base font-bold text-rb-text">Tambah Penyesuaian Manual</h3>
            <p className="mt-1 text-xs text-rb-text-muted">
              Untuk karyawan: <span className="font-semibold text-rb-text">{adjustmentTargetItem.employee_name_snapshot}</span>
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-rb-text">Jenis Penyesuaian:</label>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as any)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                >
                  <option value="DEBT">UTANG / KASBON (Deduction)</option>
                  <option value="BONUS">BONUS / INSENTIF (Addition)</option>
                  <option value="DEDUCTION">POTONGAN LAIN (Deduction)</option>
                  <option value="CORRECTION">KOREKSI (Correction)</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-rb-text">Nominal (Rupiah):</label>
                <input
                  type="number"
                  required
                  placeholder="Contoh: 50000"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                />
              </div>

              <div>
                <label className="font-semibold text-rb-text">Alasan / Keterangan (Wajib):</label>
                <input
                  type="text"
                  required
                  placeholder="Misal: Cicilan pinjaman kasbon ke-2"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                />
              </div>

              <div>
                <label className="font-semibold text-rb-text">Catatan Tambahan (Opsional):</label>
                <input
                  type="text"
                  placeholder="Nomor referensi bukti transfer / nota"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  className="mt-1 w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs text-rb-text"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdjustmentTargetItem(null)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="rounded-rb-button bg-rb-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Menyimpan...' : 'Simpan Penyesuaian'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* OVERTIME REVIEW MODAL */}
      {isOvertimeModalOpen && activeRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-rb-divider pb-4">
              <div>
                <h3 className="text-base font-bold text-rb-text">Tinjau Lembur Karyawan (Overtime Review)</h3>
                <p className="text-xs text-rb-text-muted">
                  Periode: {activeRun.period_start} s/d {activeRun.period_end} · Hanya jam lembur yang disetujui (Approved) yang dihitung ke payroll reguler.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncOvertime}
                  disabled={overtimeLoading}
                  className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
                >
                  {overtimeLoading ? 'Menyinkronkan...' : '🔄 Tarik Kandidat dari Presensi'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOvertimeModalOpen(false)}
                  className="rounded-rb-pill p-1.5 text-rb-text-muted hover:bg-rb-surface-hover hover:text-rb-text"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="mt-4">
              {overtimeLoading && <LoadingState label="Memuat kandidat lembur..." />}
              {!overtimeLoading && overtimeApprovals.length === 0 && (
                <div className="p-8 text-center text-xs text-rb-text-muted">
                  Belum ada catatan lembur terdeteksi pada periode ini. Klik &quot;🔄 Tarik Kandidat dari Presensi&quot; untuk memindai presensi periode ini.
                </div>
              )}
              {!overtimeLoading && overtimeApprovals.length > 0 && (
                <div className="overflow-x-auto rounded-rb-card border border-rb-border">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-rb-divider bg-rb-surface-hover/50 text-[11px] font-semibold uppercase text-rb-text-muted">
                      <tr>
                        <th className="p-2.5">Karyawan</th>
                        <th className="p-2.5">Unit / Cabang</th>
                        <th className="p-2.5">Tanggal</th>
                        <th className="p-2.5 text-right">Raw Detected Overtime</th>
                        <th className="p-2.5 text-right">Approved Overtime (min)</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-right">Aksi Review</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rb-divider">
                      {overtimeApprovals.map((ot) => (
                        <tr key={ot.id} className="hover:bg-rb-surface-hover/30">
                          <td className="p-2.5 font-medium text-rb-text">
                            <div>{ot.employees?.name || ot.employee_id.slice(0, 8)}</div>
                            <div className="text-[10px] text-rb-text-muted font-normal">{ot.employees?.position || ''}</div>
                          </td>
                          <td className="p-2.5 text-xs text-rb-text-secondary">
                            {ot.employees?.business_unit || '—'} · {ot.employees?.branch ? (BRANCH_LABELS[ot.employees.branch.toLowerCase()] ?? ot.employees.branch) : '—'}
                          </td>
                          <td className="p-2.5 font-mono text-rb-text-secondary">{ot.attendance_date}</td>
                          <td className="p-2.5 text-right font-mono font-semibold text-amber-600">
                            {ot.raw_overtime_minutes} m ({Math.round((ot.raw_overtime_minutes / 60) * 10) / 10} j)
                          </td>
                          <td className="p-2.5 text-right">
                            {activeRun.status === 'DRAFT' && isManager ? (
                              <input
                                type="number"
                                min={0}
                                max={720}
                                value={overtimeMinutesInput[ot.id] ?? defaultApprovedOvertimeMinutes(ot)}
                                aria-label={`Approved overtime minutes ${ot.id}`}
                                onChange={(e) =>
                                  setOvertimeMinutesInput((prev) => ({
                                    ...prev,
                                    [ot.id]: Number(e.target.value),
                                  }))
                                }
                                className="w-20 rounded border border-rb-border bg-rb-surface px-2 py-1 text-right font-mono text-xs"
                              />
                            ) : (
                              <span className="font-mono font-bold text-emerald-600">
                                {ot.approved_overtime_minutes} m
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <span
                              className={`rounded-rb-pill px-2 py-0.5 text-[10px] font-semibold ${
                                ot.status === 'APPROVED'
                                  ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                                  : ot.status === 'REJECTED'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {ot.status}
                            </span>
                          </td>
                          <td className="p-2.5 text-right">
                            {activeRun.status === 'DRAFT' && isManager ? (
                              <div className="flex items-center gap-1.5 justify-end">
                                <input
                                  type="text"
                                  placeholder="Catatan..."
                                  value={overtimeNoteInput[ot.id] ?? ot.note ?? ''}
                                  onChange={(e) =>
                                    setOvertimeNoteInput((prev) => ({
                                      ...prev,
                                      [ot.id]: e.target.value,
                                    }))
                                  }
                                  className="w-28 rounded border border-rb-border bg-rb-surface px-2 py-1 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReviewOvertime(ot.id, 'APPROVED')}
                                  disabled={actionLoading}
                                  className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReviewOvertime(ot.id, 'REJECTED')}
                                  disabled={actionLoading}
                                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-rb-text-muted">{ot.note || '—'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOvertimeModalOpen(false)}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
