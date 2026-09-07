import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { getRoleCounts, type RoleCountsResponse } from '../services/crm';

const COLUMNS = ['Owner', 'Manager', 'Branch Admin', 'HR / Payroll'];

const MATRIX: { name: string; access: boolean[] }[] = [
  { name: 'Command Center', access: [true, true, true, false] },
  { name: 'HR & People', access: [true, true, false, true] },
  { name: 'Attendance', access: [true, true, true, true] },
  { name: 'Regular Payroll', access: [true, false, false, true] },
  { name: 'Barber Payroll', access: [true, true, false, true] },
  { name: 'Operations', access: [true, true, true, false] },
  { name: 'CRM & Customer', access: [true, true, false, false] },
  { name: 'Membership', access: [true, true, false, false] },
  { name: 'Stockist & Inventory', access: [true, true, true, false] },
  { name: 'Moka Integration', access: [true, false, false, false] },
  { name: 'Reports', access: [true, true, false, false] },
  { name: 'System', access: [true, false, false, false] },
];

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; counts: RoleCountsResponse['roles'] };

export function RolesPermissions() {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    getRoleCounts()
      .then((res) => {
        if (!cancelled) {
          setState({ status: 'ready', counts: res.roles });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err?.status === 403
              ? 'Hanya akun dengan peran Owner yang memiliki otorisasi melihat ringkasan peran.'
              : 'Gagal memuat ringkasan peran dari database.';
          setState({ status: 'error', message: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Peran & Izin"
        subtitle="Audit peran pengguna aktif di Backoffice dan matriks akses modul"
      />

      <p className="mb-6 max-w-2xl text-sm text-rb-text-muted">
        Ringkasan peran di bawah bersumber langsung dari tabel autentikasi pengguna operasional. Peran yang
        belum memiliki akun operasional ditandai <em>Belum aktif</em>. Matriks izin adalah referensi
        hak akses modul dan tidak menggantikan otorisasi server-side.
      </p>

      {state.status === 'loading' && <LoadingState label="Memuat data peran pengguna..." />}
      {state.status === 'error' && <ErrorState message={state.message} />}

      {state.status === 'ready' && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
              <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">Owner / Super Admin</div>
              <div className="text-xs font-medium text-rb-text-secondary">
                {state.counts.owner} akun aktif
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
              <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">Branch Admin</div>
              <div className="text-xs font-medium text-rb-text-secondary">
                {state.counts.branch_admin} akun aktif
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
              <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">Manager</div>
              <div className="text-xs text-rb-text-muted">
                {state.counts.manager > 0 ? `${state.counts.manager} akun aktif` : 'Belum aktif'}
              </div>
            </div>

            <div className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
              <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">HR / Payroll</div>
              <div className="text-xs text-rb-text-muted">
                {state.counts.hr > 0 ? `${state.counts.hr} akun aktif` : 'Belum aktif'}
              </div>
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
            <div
              className="grid gap-2 border-b border-rb-divider px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted"
              style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}
            >
              <div>Modul</div>
              {COLUMNS.map((c) => (
                <div key={c} className="text-center">
                  {c}
                </div>
              ))}
            </div>
            <div className="flex flex-col divide-y divide-rb-divider">
              {MATRIX.map((m) => (
                <div
                  key={m.name}
                  className="grid items-center gap-2 px-4 py-3 text-sm"
                  style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}
                >
                  <div className="font-semibold text-rb-text">{m.name}</div>
                  {m.access.map((granted, i) => (
                    <div key={i} className="text-center">
                      {granted ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rb-green-tint-bg text-xs text-rb-green-tint-fg">
                          ✓
                        </span>
                      ) : (
                        <span className="text-rb-text-faint">—</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

