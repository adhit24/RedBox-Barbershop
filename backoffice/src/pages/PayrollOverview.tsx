import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  getEmployees,
  getCommandCenterForBranch,
  type CommandCenterBarber,
} from '../services/crm';

const BRANCHES = ['bypass', 'csb', 'samadikun', 'sumber', 'tegal'] as const;

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      regularCount: number;
      barberCount: number;
      totalWorkforce: number;
    };

export function PayrollOverview() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    Promise.allSettled([
      getEmployees(),
      ...BRANCHES.map((b) => getCommandCenterForBranch(b)),
    ]).then((results) => {
      const empRes = results[0];
      let regularCount = 0;
      if (empRes.status === 'fulfilled') {
        const empVal = empRes.value as { employees?: { is_active?: boolean }[] };
        if (empVal?.employees) {
          regularCount = empVal.employees.filter((e) => e.is_active).length;
        }
      }

      const barberMap = new Map<string, CommandCenterBarber>();
      for (let i = 1; i < results.length; i++) {
        const res = results[i];
        if (res.status === 'fulfilled') {
          const val = res.value as { barbers?: CommandCenterBarber[] };
          for (const b of val?.barbers ?? []) {
            if (!barberMap.has(b.id)) barberMap.set(b.id, b);
          }
        }
      }
      const barberCount = barberMap.size;

      if (regularCount === 0 && barberCount === 0) {
        setState({
          status: 'error',
          message: 'Data kepegawaian belum dapat dimuat dari database.',
        });
        return;
      }

      setState({
        status: 'ready',
        regularCount,
        barberCount,
        totalWorkforce: regularCount + barberCount,
      });
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Struktur kompensasi karyawan reguler (gaji) dan kapster (bagi hasil). Formula kalkulasi otomatis dalam tahap validasi."
      />

      {state.status === 'loading' && (
        <LoadingState label="Memuat ringkasan data payroll dari database..." />
      )}

      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <section className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              value={state.totalWorkforce}
              label="Total Tenaga Kerja Aktif"
              tint="blue"
            />
            <Link to="/payroll/regular" className="block no-underline">
              <StatCard
                value={state.regularCount}
                label="Karyawan Reguler (Gaji) →"
                tint="purple"
              />
            </Link>
            <Link to="/payroll/barber" className="block no-underline">
              <StatCard
                value={state.barberCount}
                label="Kapster (Bagi Hasil) →"
                tint="orange"
              />
            </Link>
            <StatCard
              value="—"
              label="Pending Review"
              trend="Belum tersedia"
              tint="yellow"
            />
            <StatCard
              value="—"
              label="Need Adjustment"
              trend="Belum tersedia"
              tint="red"
            />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Link
              to="/payroll/regular"
              className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline transition hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
            >
              <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-purple-tint-bg text-rb-purple-tint-fg font-semibold">
                R
              </div>
              <div className="mb-1.5 text-[15px] font-semibold text-rb-text">
                Regular Payroll — Gaji Pokok
              </div>
              <p className="text-sm leading-relaxed text-rb-text-muted">
                Kasir, barista, admin, manager, dan staf operasional lainnya di Redbox dan Sundaze. Berbasis gaji reguler tanpa perhitungan komisi yang belum tervalidasi.
              </p>
              <div className="mt-3.5 text-xs font-semibold text-rb-red">
                Lihat {state.regularCount} karyawan reguler →
              </div>
            </Link>

            <Link
              to="/payroll/barber"
              className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline transition hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
            >
              <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-orange-tint-bg text-rb-orange-tint-fg font-semibold">
                B
              </div>
              <div className="mb-1.5 text-[15px] font-semibold text-rb-text">
                Barber Payroll — Bagi Hasil
              </div>
              <p className="text-sm leading-relaxed text-rb-text-muted">
                Kapster aktif lintas 5 cabang Redbox Barbershop dengan skema bagi hasil. Persentase bagi hasil dan komisi produk tidak di-hardcode.
              </p>
              <div className="mt-3.5 text-xs font-semibold text-rb-red">
                Lihat {state.barberCount} kapster aktif →
              </div>
            </Link>
          </div>

          <div className="mt-6 rounded-rb-card border border-rb-border bg-rb-surface/60 p-4 text-xs text-rb-text-muted">
            Catatan Keamanan &amp; Integritas Data: Rincian nominal gaji dan formula komisi otomatis tidak ditampilkan pada tampilan umum untuk menjaga kerahasiaan dan mencegah kesalahan kalkulasi sebelum formula disetujui Owner.
          </div>
        </>
      )}
    </>
  );
}
