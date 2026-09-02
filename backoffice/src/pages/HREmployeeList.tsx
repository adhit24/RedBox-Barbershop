import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getCommandCenterForBranch, type CommandCenterBarber } from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;
const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; barbers: CommandCenterBarber[]; failedBranches: string[] };

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'RB';
}

function attendanceLabel(status: string | null) {
  if (!status) return 'Belum tersedia';
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hadir') return 'Hadir';
  if (normalized === 'tidak_hadir') return 'Tidak hadir';
  if (normalized === 'belum_check_in') return 'Belum check-in';
  return status.replaceAll('_', ' ');
}

export function HREmployeeList() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.allSettled(BRANCHES.map((branch) => getCommandCenterForBranch(branch)))
      .then((results) => {
        const failedBranches: string[] = [];
        const byId = new Map<string, CommandCenterBarber>();

        results.forEach((result, index) => {
          const requestedBranch = BRANCHES[index];
          if (result.status === 'rejected') {
            failedBranches.push(requestedBranch);
            return;
          }
          for (const barber of result.value.barbers ?? []) {
            if (!byId.has(barber.id)) byId.set(barber.id, barber);
          }
        });

        const barbers = [...byId.values()].sort((a, b) => {
          const branchDiff = BRANCHES.indexOf(a.branch as (typeof BRANCHES)[number]) - BRANCHES.indexOf(b.branch as (typeof BRANCHES)[number]);
          if (branchDiff !== 0) return branchDiff;
          return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
        });

        if (barbers.length === 0 && failedBranches.length === BRANCHES.length) {
          setState({ status: 'error', message: 'Data HR & People belum dapat dimuat dari database.' });
          return;
        }

        setState({ status: 'ready', barbers, failedBranches });
      });
  }, []);

  const branchCount = useMemo(() => {
    if (state.status !== 'ready') return 0;
    return new Set(state.barbers.map((barber) => barber.branch).filter(Boolean)).size;
  }, [state]);

  return (
    <>
      <PageHeader
        title="HR & People"
        subtitle="Kapster aktif dari database Redbox. Karyawan reguler/Sundaze akan ditambahkan dari sumber payroll resmi."
        actions={
          <span className="rounded-rb-pill bg-rb-green-tint-bg px-3 py-1.5 text-[11px] font-semibold text-rb-green-tint-fg">
            PARTIAL LIVE
          </span>
        }
      />

      {state.status === 'loading' && <LoadingState label="Memuat data kapster dari seluruh cabang..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          {state.failedBranches.length > 0 && (
            <div className="mb-4 rounded-rb-card border border-rb-orange-tint-fg/20 bg-rb-orange-tint-bg px-4 py-3 text-sm text-rb-text-secondary">
              Data sebagian cabang belum berhasil dimuat: {state.failedBranches.map((b) => BRANCH_LABELS[b] ?? b).join(', ')}.
            </div>
          )}

          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={state.barbers.length} label="Kapster Aktif" tint="red" />
            <StatCard value={branchCount} label="Cabang dengan Kapster" tint="orange" />
            <StatCard value="—" label="Karyawan Reguler" tint="purple" />
            <StatCard value={1} label="Unit Bisnis Live" tint="teal" />
          </section>

          <div className="overflow-hidden rounded-rb-card border border-rb-border bg-rb-surface">
            <div className="grid grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_0.8fr] gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
              <div>Karyawan</div><div>Unit Bisnis</div><div>Posisi</div><div>Cabang</div><div>Attendance</div><div>Status</div>
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {state.barbers.map((barber) => (
                <div
                  key={barber.id}
                  className="grid grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_0.8fr] items-center gap-2 px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-red-tint-bg text-xs font-semibold text-rb-red-tint-fg">
                      {initials(barber.name)}
                    </span>
                    <div>
                      <div className="font-semibold capitalize text-rb-text">{barber.name}</div>
                      <div className="text-[11px] text-rb-text-faint">{barber.id}</div>
                    </div>
                  </div>
                  <div className="text-rb-text-secondary">Redbox Barbershop</div>
                  <div className="text-rb-text-secondary">Kapster</div>
                  <div className="capitalize text-rb-text-secondary">{BRANCH_LABELS[barber.branch] ?? barber.branch ?? '—'}</div>
                  <div className="font-semibold text-rb-text-secondary">{attendanceLabel(barber.attendance_status)}</div>
                  <div>
                    <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">
                      Aktif
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 text-xs text-rb-text-muted">
            Karyawan reguler dan Sundaze belum ditampilkan sampai file payroll resmi dapat dibaca/diimpor. Tidak ada nama contoh yang digunakan.
          </div>
        </>
      )}
    </>
  );
}
