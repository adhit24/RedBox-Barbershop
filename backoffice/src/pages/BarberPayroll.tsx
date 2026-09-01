import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

interface DemoBarberPayrollRow {
  name: string;
  level: string;
  branch: string;
  customers: number;
  commission: string;
  pay: string;
  status: 'Approved' | 'Pending Review' | 'Draft' | 'Need Adjustment';
}

const ROWS: DemoBarberPayrollRow[] = [
  { name: 'Ubay Santoso', level: 'Senior', branch: 'Samadikun', customers: 612, commission: 'Rp 4.620.000', pay: 'Rp 5.640.000', status: 'Approved' },
  { name: 'Dodi Iskandar', level: 'Senior', branch: 'CSB', customers: 540, commission: 'Rp 4.130.000', pay: 'Rp 4.850.000', status: 'Pending Review' },
  { name: 'Farhan Maulana', level: 'Mid', branch: 'Sumber', customers: 412, commission: 'Rp 3.180.000', pay: 'Rp 3.180.000', status: 'Approved' },
  { name: 'Bagus Setiawan', level: 'Mid', branch: 'CSB', customers: 388, commission: 'Rp 2.960.000', pay: 'Rp 2.880.000', status: 'Need Adjustment' },
  { name: 'Yoga Pratama', level: 'Junior', branch: 'Bypass', customers: 260, commission: 'Rp 1.980.000', pay: 'Rp 1.980.000', status: 'Draft' },
];

const STATUS_TINT: Record<DemoBarberPayrollRow['status'], string> = {
  Approved: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  'Pending Review': 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  Draft: 'bg-rb-divider text-rb-text-muted',
  'Need Adjustment': 'bg-rb-red-tint-bg text-rb-red-tint-fg',
};

export function BarberPayroll() {
  return (
    <>
      <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Payroll</Link>
      <PageHeader title="Barber Payroll" subtitle="Revenue Sharing / Komisi Layanan — data contoh, skema ilustratif" actions={<DemoBadge />} />

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Barber</div><div>Level</div><div>Cabang</div><div>Customer</div><div>Komisi (contoh)</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.level}</div>
              <div className="text-rb-text-secondary">{r.branch}</div>
              <div className="text-rb-text-secondary">{r.customers}</div>
              <div className="font-semibold text-rb-text">{r.pay}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
