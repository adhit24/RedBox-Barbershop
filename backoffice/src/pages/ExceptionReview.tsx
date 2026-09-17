import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  getAttendanceExceptions,
  resolveAttendanceException,
  type AttendanceException,
} from '../services/crm';
import { apiClient } from '../lib/apiClient';

interface WorkforcePerson {
  id: string;
  source: 'barbers' | 'employees';
  source_record_id: string;
  name: string;
  nickname: string | null;
  position: string;
  branch: string | null;
  business_unit: string;
}

interface CandidateSuggestion {
  person: WorkforcePerson;
  confidence: 'Tinggi' | 'Sedang';
  evidence: string;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1] ? matrix[i - 1][j - 1] : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length];
}

function findSuggestedCandidate(
  excName: string | null,
  excDept: string | null,
  workforce: WorkforcePerson[]
): CandidateSuggestion | null {
  if (!excName || !workforce.length) return null;

  const cleanExcName = excName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanExcName) return null;

  const excWords = excName.toLowerCase().trim().split(/\s+/);
  const firstWord = excWords[0];

  let bestCandidate: CandidateSuggestion | null = null;

  for (const person of workforce) {
    const cleanPersonName = person.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanNick = (person.nickname || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const personWords = person.name.toLowerCase().trim().split(/\s+/);
    const personFirstWord = personWords[0];

    // 1. Exact match on name or nickname
    if (cleanPersonName === cleanExcName || (cleanNick && cleanNick === cleanExcName)) {
      return {
        person,
        confidence: 'Tinggi',
        evidence: `Nama cocok persis ('${excName}' = '${person.name}')`,
      };
    }

    // 2. Edit distance <= 1 on name or first word (e.g. Yuda vs Yudha, Dendi vs Dendie)
    const distToFirstWord = levenshtein(cleanExcName, personFirstWord);
    const distToName = levenshtein(cleanExcName, cleanPersonName);

    if (distToFirstWord <= 1 || distToName <= 1) {
      const isBranchMatch = excDept && person.branch && person.branch.toLowerCase().includes(excDept.toLowerCase());
      return {
        person,
        confidence: 'Tinggi',
        evidence: `Nama sangat mirip ('${excName}' ≈ '${person.name}')${isBranchMatch ? ` · Cabang cocok (${person.branch})` : ''}`,
      };
    }

    // 3. Prefix or first word match (e.g. Abi in Abi Bhakti)
    if (firstWord.length >= 3 && personFirstWord === firstWord) {
      if (!bestCandidate) {
        bestCandidate = {
          person,
          confidence: 'Sedang',
          evidence: `Kata depan cocok ('${firstWord}' dalam '${person.name}')`,
        };
      }
    }
  }

  return bestCandidate;
}

export function ExceptionReview() {
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Workforce list for mapping modal
  const [workforce, setWorkforce] = useState<WorkforcePerson[]>([]);
  const [mappingException, setMappingException] = useState<AttendanceException | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [resolving, setResolving] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await getAttendanceExceptions(statusFilter);
      if (res.ok) {
        setExceptions(res.exceptions || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat daftar exception');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  // Load workforce options for mapping
  useEffect(() => {
    apiClient
      .get<{ ok?: boolean; people?: WorkforcePerson[] }>('/api/admin/hr-people?filter=all')
      .then((data) => {
        if (data && data.people) {
          setWorkforce(data.people);
        }
      })
      .catch(() => {});
  }, []);

  const handleOpenMapping = (exc: AttendanceException) => {
    setMappingException(exc);
    const suggestion = findSuggestedCandidate(exc.external_name, exc.department, workforce);
    if (suggestion) {
      setSelectedPersonId(suggestion.person.id);
      setResolutionNotes(`Hubungkan ID ${exc.external_employee_id} (${exc.external_name}) ke ${suggestion.person.name} (${suggestion.evidence})`);
    } else {
      setSelectedPersonId('');
      setResolutionNotes(`Hubungkan ID ${exc.external_employee_id} (${exc.external_name}) dari mesin fingerprint`);
    }
  };

  const handleCloseMapping = () => {
    setMappingException(null);
    setSelectedPersonId('');
    setResolutionNotes('');
  };

  const handleSaveResolution = async () => {
    if (!mappingException) return;

    try {
      setResolving(true);
      setErrorMsg(null);

      let payload: { employee_id?: string; barber_id?: string; target_type?: 'employee' | 'barber'; resolution_notes?: string } = {
        resolution_notes: resolutionNotes,
      };

      if (selectedPersonId) {
        const selected = workforce.find((p) => p.id === selectedPersonId);
        if (selected) {
          if (selected.source === 'barbers') {
            payload.target_type = 'barber';
            payload.barber_id = selected.source_record_id;
          } else {
            payload.target_type = 'employee';
            payload.employee_id = selected.source_record_id;
          }
        }
      }

      const res = await resolveAttendanceException(mappingException.id, payload);
      if (res.ok) {
        handleCloseMapping();
        loadData();
      } else {
        setErrorMsg('Gagal menyelesaikan exception');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat menyimpan resolusi');
    } finally {
      setResolving(false);
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
        title="Exception Review"
        subtitle="Review karyawan belum cocok, single punch, dan rekonsiliasi anomali presensi fingerprint"
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

      {/* FILTER TABS */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-rb-pill border border-rb-border bg-rb-surface p-1">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`rounded-rb-pill px-4 py-1.5 text-xs font-semibold transition-all ${
              statusFilter === 'pending'
                ? 'bg-rb-red text-white shadow-sm'
                : 'text-rb-text-muted hover:text-rb-text'
            }`}
          >
            Menunggu Review
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`rounded-rb-pill px-4 py-1.5 text-xs font-semibold transition-all ${
              statusFilter === 'resolved'
                ? 'bg-rb-red text-white shadow-sm'
                : 'text-rb-text-muted hover:text-rb-text'
            }`}
          >
            Terselesaikan
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-rb-pill px-4 py-1.5 text-xs font-semibold transition-all ${
              statusFilter === 'all'
                ? 'bg-rb-red text-white shadow-sm'
                : 'text-rb-text-muted hover:text-rb-text'
            }`}
          >
            Semua
          </button>
        </div>

        <Link
          to="/attendance/import"
          className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-bg no-underline"
        >
          + Import Berkas Baru
        </Link>
      </div>

      {/* EXCEPTIONS CONTAINER */}
      <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-sm">
        {loading ? (
          <LoadingState label="Memuat data exception attendance..." />
        ) : exceptions.length === 0 ? (
          <EmptyState
            title={
              statusFilter === 'pending'
                ? 'Tidak ada exception attendance yang menunggu review'
                : 'Tidak ada data exception'
            }
            description="Semua data absensi dari mesin fingerprint berhasil dicocokkan atau telah diselesaikan oleh manajer."
          />
        ) : (
          <div className="flex flex-col divide-y divide-rb-divider">
            {exceptions.map((exc) => {
              const suggestion =
                exc.status === 'pending' && exc.exception_type === 'unmatched_employee'
                  ? findSuggestedCandidate(exc.external_name, exc.department, workforce)
                  : null;

              return (
                <div key={exc.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-rb-pill px-2.5 py-0.5 text-[10.5px] font-semibold ${
                            exc.exception_type === 'unmatched_employee'
                              ? 'bg-rb-orange-tint-bg text-rb-orange-tint-fg'
                              : exc.exception_type === 'single_punch'
                              ? 'bg-rb-yellow-tint-bg text-rb-yellow-tint-fg'
                              : 'bg-rb-divider text-rb-text-muted'
                          }`}
                        >
                          {exc.exception_type === 'unmatched_employee'
                            ? 'Karyawan Belum Cocok'
                            : exc.exception_type === 'single_punch'
                            ? 'Hanya 1 Punch (Missing In/Out)'
                            : exc.exception_type}
                        </span>
                        {exc.attendance_date && (
                          <span className="font-mono text-xs text-rb-text-muted">
                            {exc.attendance_date}
                          </span>
                        )}
                        <span
                          className={`rounded-rb-pill px-2 py-0.5 text-[10.5px] font-semibold capitalize ${
                            exc.status === 'resolved'
                              ? 'bg-rb-green-tint-bg text-rb-green-tint-fg'
                              : 'bg-rb-divider text-rb-text-muted'
                          }`}
                        >
                          {exc.status === 'resolved' ? 'Terselesaikan' : 'Menunggu Review'}
                        </span>
                      </div>

                      <h3 className="mt-1.5 font-semibold text-sm text-rb-text">
                        {exc.external_name || 'Tanpa Nama'} (ID Mesin: {exc.external_employee_id || '—'})
                        {exc.department && (
                          <span className="ml-2 font-normal text-xs text-rb-text-secondary">
                            Dept: {exc.department}
                          </span>
                        )}
                      </h3>

                      <p className="mt-1 text-xs text-rb-text-secondary">
                        {exc.details || 'Tidak ada catatan tambahan.'}
                      </p>

                      {(() => {
                        const raw = exc.raw_data as { raw_punches?: string[]; first_check_in?: string; last_check_out?: string } | null | undefined;
                        if (!raw) return null;
                        const punches = Array.isArray(raw.raw_punches) ? raw.raw_punches : [];
                        if (punches.length === 0 && !raw.first_check_in) return null;
                        return (
                          <div className="mt-1.5 text-xs text-rb-text-muted">
                            <span className="font-medium">Punch Data:</span>{' '}
                            {punches.length > 0
                              ? punches.join(', ')
                              : `${raw.first_check_in || '—'} s/d ${raw.last_check_out || '—'}`}
                          </div>
                        );
                      })()}

                      {suggestion && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-rb-card border border-amber-300/60 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-950/20 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                          <span className="font-semibold">💡 Saran ({suggestion.confidence}):</span>
                          <span className="font-medium">
                            [{suggestion.person.source === 'barbers' ? 'Kapster' : 'Karyawan'}]{' '}
                            {suggestion.person.name} ({suggestion.person.branch || 'Pusat'})
                          </span>
                          <span className="text-[11px] opacity-80">— {suggestion.evidence}</span>
                        </div>
                      )}

                      {exc.resolution_notes && (
                        <div className="mt-2 text-xs text-rb-text-muted italic">
                          Catatan Resolusi: {exc.resolution_notes}
                          {exc.resolved_by && ` (oleh ${exc.resolved_by})`}
                        </div>
                      )}
                    </div>

                    {exc.status === 'pending' && (
                      <div>
                        <button
                          type="button"
                          onClick={() => handleOpenMapping(exc)}
                          className="rounded-rb-button bg-rb-red px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rb-red/90"
                        >
                          {exc.exception_type === 'unmatched_employee'
                            ? 'Hubungkan Karyawan'
                            : 'Selesaikan'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RESOLUTION MODAL / DIALOG */}
      {mappingException && (() => {
        const activeSuggestion =
          mappingException.exception_type === 'unmatched_employee'
            ? findSuggestedCandidate(mappingException.external_name, mappingException.department, workforce)
            : null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-rb-card border border-rb-border bg-rb-surface p-6 shadow-xl">
              <h3 className="font-serif text-base font-semibold text-rb-text">
                Resolusi Exception Presensi
              </h3>
              <p className="mt-1 text-xs text-rb-text-muted">
                {mappingException.external_name} (ID Mesin: {mappingException.external_employee_id}, Dept: {mappingException.department || '—'})
              </p>

              <div className="mt-4 space-y-4">
                {activeSuggestion && (
                  <div className="rounded-rb-card border border-amber-300/60 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-950/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                        💡 Saran Kandidat Terdeteksi:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPersonId(activeSuggestion.person.id);
                          setResolutionNotes(
                            `Hubungkan ID ${mappingException.external_employee_id} (${mappingException.external_name}) ke ${activeSuggestion.person.name} (${activeSuggestion.evidence})`
                          );
                        }}
                        className="rounded-rb-pill bg-amber-200/70 dark:bg-amber-800/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100 hover:bg-amber-300/80 transition-colors"
                      >
                        Pilih Rekomendasi
                      </button>
                    </div>
                    <div className="mt-1.5 text-xs font-medium text-amber-950 dark:text-amber-100">
                      [{activeSuggestion.person.source === 'barbers' ? 'Kapster' : 'Karyawan'}]{' '}
                      {activeSuggestion.person.name} ({activeSuggestion.person.branch || 'Pusat'})
                    </div>
                    <div className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      Bukti: {activeSuggestion.evidence}
                    </div>
                  </div>
                )}

                {mappingException.exception_type === 'unmatched_employee' && (
                  <div>
                    <label htmlFor="person-select" className="mb-1 block text-xs font-semibold text-rb-text">
                      Pilih Karyawan / Kapster Database:
                    </label>
                    <select
                      id="person-select"
                      value={selectedPersonId}
                      onChange={(e) => setSelectedPersonId(e.target.value)}
                      className="w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-xs font-medium text-rb-text"
                    >
                      <option value="">-- Pilih target pencocokan --</option>
                      {workforce.map((p) => (
                        <option key={p.id} value={p.id}>
                          [{p.source === 'barbers' ? 'Kapster' : 'Karyawan'}] {p.name}{' '}
                          {p.nickname ? `(${p.nickname})` : ''} — {p.position} ({p.branch || 'Pusat'})
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[11px] text-rb-text-faint">
                      Pencocokan ini akan disimpan permanen ke <span className="font-mono">employee_attendance_identity</span> sehingga impor berikutnya otomatis cocok.
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="res-notes" className="mb-1 block text-xs font-semibold text-rb-text">
                    Catatan Resolusi:
                  </label>
                  <textarea
                    id="res-notes"
                    rows={2}
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    className="w-full rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-xs font-medium text-rb-text"
                    placeholder="Keterangan tindakan penyesuaian..."
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseMapping}
                  disabled={resolving}
                  className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-xs font-semibold text-rb-text hover:bg-rb-bg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveResolution}
                  disabled={resolving || (mappingException.exception_type === 'unmatched_employee' && !selectedPersonId)}
                  className="rounded-rb-button bg-rb-green-tint-fg px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {resolving ? 'Menyimpan...' : 'Simpan Resolusi'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
