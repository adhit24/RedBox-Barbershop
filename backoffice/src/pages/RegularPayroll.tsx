import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoPayrollRow {
  name: string;
  position: string;
  unit: string;
  days: string;
  overtime: string;
  late: string;
  basic: string;
  adjustment: string;
  net: string;
  status: 'Approved' | 'Pending Review' | 'Draft';
}

const ROWS: DemoPayrollRow[] = [
  { name: 'Nadia Kusuma', position: 'Manager', unit: 'Sundaze', days: '22/22', overtime: '—', late: '—', basic: 'Rp 6.500.000', adjustment: '—', net: 'Rp 6.500.000', status: 'Approved' },
  { name: 'Rizky Pratama', position: 'Barista', unit: 'Sundaze', days: '21/22', overtime: '2j', late: '1x', basic: 'Rp 4.200.000', adjustment: '-Rp 50.000', net: 'Rp 4.150.000', status: 'Pending Review' },
  { name: 'Andra Wijaya', position: 'Cashier', unit: 'Redbox', days: '20/22', overtime: '—', late: '2x', basic: 'Rp 3.800.000', adjustment: '-Rp 100.000', net: 'Rp 3.700.000', status: 'Pending Review' },
  { name: 'Teguh Firmansyah', position: 'Admin', unit: 'Redbox', days: '22/22', overtime: '—', late: '—', basic: 'Rp 4.000.000', adjustment: '+Rp 150.000', net: 'Rp 4.150.000', status: 'Approved' },
  { name: 'Wulan Sari', position: 'Cashier', unit: 'Sundaze', days: '22/22', overtime: '—', late: '—', basic: 'Rp 3.800.000', adjustment: '—', net: 'Rp 3.800.000', status: 'Approved' },
];

const STATUS_TINT: Record<DemoPayrollRow['status'], string> = {
  Approved: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  'Pending Review': 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  Draft: 'bg-rb-divider text-rb-text-muted',
};

export function RegularPayroll() {
  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Payroll</Link>
      <PageHeader title="Regular Payroll" subtitle="Gaji Reguler (fixed salary) — data contoh" actions={<DemoBadge />} />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={38} label="Karyawan (contoh)" tint="blue" />
        <StatCard value={38} label="Payroll Draft (contoh)" tint="yellow" />
        <StatCard value={3} label="Pending Review (contoh)" tint="purple" />
        <StatCard value={34} label="Approved (contoh)" tint="green" />
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Posisi</div><div>Absen</div><div>Gaji Pokok</div><div>Net Salary</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.position}</div>
              <div className="text-rb-text-secondary">{r.days}</div>
              <div className="text-rb-text-secondary">{r.basic}</div>
              <div className="font-semibold text-rb-text">{r.net}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
