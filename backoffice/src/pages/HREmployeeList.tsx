import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoEmployee {
  id: string;
  name: string;
  initials: string;
  unit: string;
  position: string;
  branch: string;
  attendance: string;
  status: 'Aktif' | 'Cuti';
}

const EMPLOYEES: DemoEmployee[] = [
  { id: 'RB-0142', name: 'Ubay Santoso', initials: 'US', unit: 'Redbox Barbershop', position: 'Senior Barber', branch: 'Samadikun', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0098', name: 'Dodi Iskandar', initials: 'DI', unit: 'Redbox Barbershop', position: 'Barber', branch: 'CSB', attendance: 'Terlambat 1x', status: 'Aktif' },
  { id: 'SD-0033', name: 'Rizky Pratama', initials: 'RP', unit: 'Sundaze Coffee Shop', position: 'Barista', branch: 'Bypass', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0071', name: 'Andra Wijaya', initials: 'AW', unit: 'Redbox Barbershop', position: 'Cashier', branch: 'Tegal', attendance: 'Terlambat 2x', status: 'Aktif' },
  { id: 'RB-0055', name: 'Farhan Maulana', initials: 'FM', unit: 'Redbox Barbershop', position: 'Barber', branch: 'Sumber', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'SD-0019', name: 'Nadia Kusuma', initials: 'NK', unit: 'Sundaze Coffee Shop', position: 'Manager', branch: 'Bypass', attendance: 'Tepat waktu', status: 'Aktif' },
  { id: 'RB-0110', name: 'Bagus Setiawan', initials: 'BS', unit: 'Redbox Barbershop', position: 'Barber', branch: 'CSB', attendance: 'Tepat waktu', status: 'Cuti' },
  { id: 'RB-0087', name: 'Teguh Firmansyah', initials: 'TF', unit: 'Redbox Barbershop', position: 'Admin', branch: 'Samadikun', attendance: 'Tepat waktu', status: 'Aktif' },
];

export function HREmployeeList() {
  return (
    <>
      <PageHeader
        title="HR & People"
        subtitle="Data karyawan contoh — menunggu tabel employees produksi"
        actions={<DemoBadge />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={EMPLOYEES.length} label="Total Karyawan (contoh)" tint="red" />
        <StatCard value={EMPLOYEES.filter((e) => e.unit === 'Redbox Barbershop').length} label="Redbox Barbershop" tint="orange" />
        <StatCard value={EMPLOYEES.filter((e) => e.unit === 'Sundaze Coffee Shop').length} label="Sundaze Coffee Shop" tint="purple" />
        <StatCard value={new Set(EMPLOYEES.map((e) => e.unit)).size} label="Unit Bisnis" tint="teal" />
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Unit Bisnis</div><div>Posisi</div><div>Cabang</div><div>Attendance</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {EMPLOYEES.map((e) => (
            <Link
              key={e.id}
              to={`/hr/employees/${e.id}`}
              className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm no-underline hover:bg-rb-bg"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-red-tint-bg text-xs font-semibold text-rb-red-tint-fg">{e.initials}</span>
                <div>
                  <div className="font-semibold text-rb-text">{e.name}</div>
                  <div className="text-[11px] text-rb-text-faint">{e.id}</div>
                </div>
              </div>
              <div className="text-rb-text-secondary">{e.unit}</div>
              <div className="text-rb-text-secondary">{e.position}</div>
              <div className="text-rb-text-secondary">{e.branch}</div>
              <div className="font-semibold text-rb-text-secondary">{e.attendance}</div>
              <div>
                <span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${e.status === 'Aktif' ? 'bg-rb-green-tint-bg text-rb-green-tint-fg' : 'bg-rb-divider text-rb-text-muted'}`}>
                  {e.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
