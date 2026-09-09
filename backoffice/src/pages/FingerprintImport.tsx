import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  previewAttendanceImport,
  commitAttendanceImport,
  getAttendanceImportBatches,
  type FingerprintPreviewData,
  type FingerprintCommitResult,
  type AttendanceImportBatch,
} from '../services/crm';

type FlowStage = 'SELECT' | 'PREVIEW' | 'COMMITTED';

export function FingerprintImport() {
  const [stage, setStage] = useState<FlowStage>('SELECT');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [committing, setCommitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<FingerprintPreviewData | null>(null);
  const [commitResult, setCommitResult] = useState<FingerprintCommitResult | null>(null);

  const [batches, setBatches] = useState<AttendanceImportBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = async () => {
    try {
      setLoadingBatches(true);
      const res = await getAttendanceImportBatches();
      if (res.ok) {
        setBatches(res.batches || []);
      }
    } catch {
      // Non-blocking for import action
    } finally {
      setLoadingBatches(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setLoading(true);
        const result = reader.result as string;
        setFileBase64(result);

        // Stage B: Automatic PARSE ONLY without mutation
        const previewRes = await previewAttendanceImport(result, file.name);
        if (previewRes.ok && previewRes.data) {
          setPreviewData(previewRes.data);
          setStage('PREVIEW');
        } else {
          setErrorMsg('Gagal memproses preview file fingerprint.');
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Terjadi kesalahan saat memproses file');
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Gagal membaca file dari perangkat.');
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    setStage('SELECT');
    setSelectedFile(null);
    setFileBase64('');
    setPreviewData(null);
    setCommitResult(null);
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!fileBase64 || !selectedFile) return;

    try {
      setCommitting(true);
      setErrorMsg(null);

      const res = await commitAttendanceImport(fileBase64, selectedFile.name);
      if (res.ok && res.data) {
        setCommitResult(res.data);
        setStage('COMMITTED');
        // Refresh import batch history
        loadHistory();
      } else {
        setErrorMsg('Gagal menyimpan data absensi ke database.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal melakukan commit data absensi.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <Link
        to="/attendance"
        className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text"
      >
        ← Kembali ke Attendance
      </Link>
      <PageHeader
        title="Import Fingerprint"
        subtitle="Unggah dan proses rekaman mesin absensi fingerprint karyawan reguler & kapster"
        actions={
          <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">
            Ready
          </span>
        }
      />

      {errorMsg && (
        <div className="mb-6">
          <ErrorState message={errorMsg} />
        </div>
      )}

      {/* THREE-STAGE FLOW CONTAINER */}
      <div className="mb-8 rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-sm">
        {/* STAGE 1: FILE SELECTION */}
        {stage === 'SELECT' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-serif text-base font-semibold text-rb-text">
                  Pilih File Laporan Mesin Fingerprint
                </h2>
                <p className="text-xs text-rb-text-muted">
                  Mendukung format export resmi mesin absensi (.xls legacy & .xlsx). File akan di-parse terlebih dahulu untuk validasi sebelum diimpor ke database.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-dashed border-rb-border bg-rb-bg px-8 py-10 text-center transition-colors hover:border-rb-red/50">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                onChange={handleFileChange}
                className="hidden"
                id="fingerprint-file-input"
              />
              <div className="mb-3 text-3xl">📑</div>
              <label
                htmlFor="fingerprint-file-input"
                className="cursor-pointer rounded-rb-button bg-rb-red px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-rb-red/90 transition-all inline-block"
              >
                Pilih File Fingerprint
              </label>
              <div className="mt-3 text-xs text-rb-text-muted">
                Contoh format Redbox: <span className="font-mono font-medium">1_StandardReport-51.xls</span>
              </div>
              <div className="mt-1 text-[11px] text-rb-text-faint">
                Maksimal ukuran file: 10MB
              </div>
            </div>

            {loading && (
              <div className="mt-6">
                <LoadingState label="Membaca dan mem-parsing struktur workbook fingerprint..." />
              </div>
            )}
          </div>
        )}

        {/* STAGE 2: PREVIEW & VALIDATION */}
        {stage === 'PREVIEW' && previewData && (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-rb-divider pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-rb-pill bg-rb-blue-tint-bg px-2.5 py-0.5 text-[11px] font-semibold text-rb-blue-tint-fg">
                    Stage 2 — Preview Only
                  </span>
                  <span className="text-xs text-rb-text-muted">
                    (Belum ada data yang ditulis ke database produksi)
                  </span>
                </div>
                <h2 className="mt-1 font-serif text-lg font-semibold text-rb-text">
                  {previewData.filename}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={committing}
                  className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-xs font-semibold text-rb-text hover:bg-rb-bg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={committing}
                  className="rounded-rb-button bg-rb-green-tint-fg px-5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {committing ? 'Menyimpan...' : 'Import Attendance'}
                </button>
              </div>
            </div>

            {/* SUMMARY STATS GRID */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Periode Absensi</div>
                <div className="mt-1 font-serif text-sm font-semibold text-rb-text">
                  {previewData.period.from} — {previewData.period.to}
                </div>
              </div>

              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Karyawan Terdeteksi</div>
                <div className="mt-1 font-serif text-lg font-semibold text-rb-text">
                  {previewData.employees_detected}
                </div>
              </div>

              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Karyawan Cocok</div>
                <div className="mt-1 font-serif text-lg font-semibold text-rb-green-tint-fg">
                  {previewData.matched_count}
                </div>
              </div>

              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Belum Cocok</div>
                <div className="mt-1 font-serif text-lg font-semibold text-rb-orange-tint-fg">
                  {previewData.unmatched_count}
                </div>
              </div>

              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Record Presensi</div>
                <div className="mt-1 font-serif text-lg font-semibold text-rb-text">
                  {previewData.punch_records_count}
                </div>
              </div>

              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3">
                <div className="text-[11px] font-semibold text-rb-text-muted">Peringatan</div>
                <div className="mt-1 font-serif text-lg font-semibold text-rb-yellow-tint-fg">
                  {previewData.warnings_count}
                </div>
              </div>
            </div>

            {/* WARNING BANNERS */}
            {previewData.warnings.length > 0 && (
              <div className="mb-6 flex flex-col gap-2">
                {previewData.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 rounded-rb-button border border-rb-orange-tint-fg/30 bg-rb-orange-tint-bg p-3 text-xs text-rb-orange-tint-fg"
                  >
                    <span className="font-bold">⚠️</span>
                    <div>{w.message}</div>
                  </div>
                ))}
              </div>
            )}

            {/* EMPLOYEES MATCHING PREVIEW */}
            <div className="mb-6 overflow-hidden rounded-rb-card border border-rb-border">
              <div className="border-b border-rb-divider bg-rb-bg px-4 py-2.5 text-xs font-semibold text-rb-text">
                Daftar Karyawan Mesin & Status Pencocokan ({previewData.employees_detected})
              </div>
              <div className="grid grid-cols-[80px_1fr_1fr_1fr_120px] gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase text-rb-text-muted">
                <div>ID Mesin</div>
                <div>Nama Mesin</div>
                <div>Departemen</div>
                <div>Target Cocok (Database)</div>
                <div>Status</div>
              </div>
              <div className="flex max-h-60 flex-col divide-y divide-rb-divider overflow-y-auto">
                {previewData.matched.map((m) => (
                  <div
                    key={m.external_employee_id}
                    className="grid grid-cols-[80px_1fr_1fr_1fr_120px] items-center gap-2 px-4 py-2 text-xs"
                  >
                    <div className="font-mono font-medium">{m.external_employee_id}</div>
                    <div className="font-semibold text-rb-text">{m.external_name}</div>
                    <div className="text-rb-text-secondary">{m.department || '—'}</div>
                    <div className="text-rb-text font-medium">
                      {m.target_name} ({m.target_type === 'barber' ? 'Kapster' : 'Karyawan'})
                    </div>
                    <div>
                      <span className="rounded-rb-pill bg-rb-green-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-green-tint-fg">
                        Cocok
                      </span>
                    </div>
                  </div>
                ))}
                {previewData.unmatched.map((u) => (
                  <div
                    key={u.external_employee_id}
                    className="grid grid-cols-[80px_1fr_1fr_1fr_120px] items-center gap-2 bg-rb-orange-tint-bg/20 px-4 py-2 text-xs"
                  >
                    <div className="font-mono font-medium text-rb-orange-tint-fg">{u.external_employee_id}</div>
                    <div className="font-semibold text-rb-text">{u.external_name}</div>
                    <div className="text-rb-text-secondary">{u.department || '—'}</div>
                    <div className="text-rb-text-muted italic">Belum terhubung</div>
                    <div>
                      <span className="rounded-rb-pill bg-rb-orange-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-orange-tint-fg">
                        Exception
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SAMPLE PUNCH RECORDS */}
            <div className="overflow-hidden rounded-rb-card border border-rb-border">
              <div className="border-b border-rb-divider bg-rb-bg px-4 py-2.5 text-xs font-semibold text-rb-text">
                Sampel Presensi Harian Terdeteksi ({previewData.sample_records.length} dari {previewData.punch_records_count})
              </div>
              <div className="grid grid-cols-[100px_1fr_80px_80px_100px_120px] gap-2 border-b border-rb-divider px-4 py-2 text-[11px] font-semibold uppercase text-rb-text-muted">
                <div>Tanggal</div>
                <div>Nama Karyawan</div>
                <div>Masuk</div>
                <div>Keluar</div>
                <div>Status</div>
                <div>Raw Punches</div>
              </div>
              <div className="flex max-h-52 flex-col divide-y divide-rb-divider overflow-y-auto font-mono text-[11.5px]">
                {previewData.sample_records.map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[100px_1fr_80px_80px_100px_120px] items-center gap-2 px-4 py-2"
                  >
                    <div>{r.date}</div>
                    <div className="font-sans font-medium text-rb-text">{r.name}</div>
                    <div>{r.first_check_in || '—'}</div>
                    <div>{r.last_check_out || '—'}</div>
                    <div>
                      <span className="font-sans font-semibold capitalize text-rb-text">
                        {r.derived_status}
                      </span>
                    </div>
                    <div className="truncate text-rb-text-muted" title={r.punches.join(', ')}>
                      {r.punches.join(', ') || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {committing && (
              <div className="mt-6">
                <LoadingState label="Menulis batch absensi dan mengintegrasikan ke database Command Center..." />
              </div>
            )}
          </div>
        )}

        {/* STAGE 3: COMMITTED SUCCESS FLOW */}
        {stage === 'COMMITTED' && commitResult && (
          <div className="text-center py-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rb-green-tint-bg text-xl text-rb-green-tint-fg">
              ✓
            </div>
            <h2 className="font-serif text-xl font-bold text-rb-text">
              Import Absensi Berhasil Diselesaikan!
            </h2>
            <p className="mt-1 text-sm text-rb-text-secondary">
              {commitResult.message}
            </p>

            <div className="my-6 mx-auto grid max-w-lg grid-cols-3 gap-3">
              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3 text-center">
                <div className="text-xs text-rb-text-muted">Periode</div>
                <div className="mt-1 font-semibold text-rb-text text-xs">
                  {commitResult.period.from} — {commitResult.period.to}
                </div>
              </div>
              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3 text-center">
                <div className="text-xs text-rb-text-muted">Record Diimpor</div>
                <div className="mt-1 font-serif text-lg font-bold text-rb-green-tint-fg">
                  {commitResult.rows_imported}
                </div>
              </div>
              <div className="rounded-rb-card border border-rb-border bg-rb-bg p-3 text-center">
                <div className="text-xs text-rb-text-muted">Exception Review</div>
                <div className="mt-1 font-serif text-lg font-bold text-rb-orange-tint-fg">
                  {commitResult.rows_exceptions}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/attendance"
                className="rounded-rb-button bg-rb-red px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-rb-red/90 transition-all no-underline"
              >
                Lihat Attendance
              </Link>
              {commitResult.rows_exceptions > 0 && (
                <Link
                  to="/attendance/exceptions"
                  className="rounded-rb-button border border-rb-orange-tint-fg/50 bg-rb-orange-tint-bg px-5 py-2.5 text-xs font-semibold text-rb-orange-tint-fg hover:opacity-90 transition-all no-underline"
                >
                  Review Exceptions ({commitResult.rows_exceptions})
                </Link>
              )}
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-xs font-semibold text-rb-text hover:bg-rb-bg"
              >
                Unggah File Lain
              </button>
            </div>
          </div>
        )}
      </div>

      {/* IMPORT HISTORY TABLE */}
      <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-base font-semibold text-rb-text">
              Riwayat Impor Mesin Fingerprint
            </h2>
            <div className="text-xs text-rb-text-muted">
              Audit jejak berkas dan batch presensi yang telah diproses
            </div>
          </div>
        </div>

        {loadingBatches ? (
          <LoadingState label="Memuat riwayat impor..." />
        ) : batches.length === 0 ? (
          <EmptyState
            title="Belum ada riwayat impor"
            description="Berkas presensi mesin fingerprint yang diimpor akan tercatat di sini secara otomatis beserta riwayat auditnya."
          />
        ) : (
          <div className="overflow-hidden rounded-rb-card border border-rb-border">
            <div className="grid grid-cols-[140px_1fr_160px_120px_90px_90px_110px] gap-2 border-b border-rb-divider bg-rb-bg px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Tanggal Unggah</div>
              <div>Nama File</div>
              <div>Periode Laporan</div>
              <div>Diunggah Oleh</div>
              <div>Terdeteksi</div>
              <div>Diimpor</div>
              <div>Status</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {batches.map((b) => (
                <div
                  key={b.id}
                  className="grid grid-cols-[140px_1fr_160px_120px_90px_90px_110px] items-center gap-2 px-4 py-3 text-xs"
                >
                  <div className="font-mono text-rb-text-muted">
                    {new Date(b.uploaded_at).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="font-semibold text-rb-text truncate" title={b.filename}>
                    {b.filename}
                  </div>
                  <div className="text-rb-text-secondary text-[11px]">
                    {b.period_from} — {b.period_to}
                  </div>
                  <div className="text-rb-text-muted truncate" title={b.uploaded_by}>
                    {b.uploaded_by}
                  </div>
                  <div className="font-semibold text-rb-text">{b.rows_detected}</div>
                  <div className="font-semibold text-rb-green-tint-fg">{b.rows_imported}</div>
                  <div>
                    <span
                      className={`inline-block rounded-rb-pill px-2 py-0.5 text-[10.5px] font-semibold capitalize ${
                        b.status === 'completed'
                          ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                          : b.status === 'partial'
                          ? 'bg-rb-yellow-tint-bg text-rb-yellow-tint-fg'
                          : 'bg-rb-divider text-rb-text-muted'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
