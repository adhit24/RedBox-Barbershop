import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

const ROLES = [
  { name: 'Owner / Super Admin', count: 1 },
  { name: 'Manager', count: 3 },
  { name: 'Branch Admin', count: 5 },
  { name: 'HR / Payroll', count: 2 },
];

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

export function RolesPermissions() {
  return (
    <>
      <PageHeader
        title="Peran & Izin"
        subtitle="Kelola apa yang bisa dilihat dan dilakukan setiap role di Backoffice"
        actions={<DemoBadge />}
      />
      <p className="mb-6 max-w-2xl text-sm text-rb-text-muted">
        Ini adalah rancangan arsitektur target — <code>users.role</code> produksi saat ini hanya
        memiliki <code>owner</code>/<code>branch_admin</code>/<code>barber</code>, belum ada split
        Manager/HR-Payroll. Matriks ini belum diterapkan di backend sebagai otorisasi nyata; tampilan
        di Backoffice tidak pernah menjadi pengganti otorisasi server-side.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.name} className="rounded-rb-card border border-rb-border bg-rb-surface p-4.5">
            <div className="mb-0.5 text-[14.5px] font-semibold text-rb-text">{r.name}</div>
            <div className="text-xs text-rb-text-muted">{r.count} pengguna (contoh)</div>
          </div>
        ))}
      </div>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid gap-2 border-b border-rb-divider px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted" style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}>
          <div>Modul</div>
          {COLUMNS.map((c) => <div key={c} className="text-center">{c}</div>)}
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {MATRIX.map((m) => (
            <div key={m.name} className="grid items-center gap-2 px-4 py-3 text-sm" style={{ gridTemplateColumns: '1.8fr repeat(4, 1fr)' }}>
              <div className="font-semibold text-rb-text">{m.name}</div>
              {m.access.map((granted, i) => (
                <div key={i} className="text-center">
                  {granted ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rb-green-tint-bg text-xs text-rb-green-tint-fg">✓</span>
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
  );
}
