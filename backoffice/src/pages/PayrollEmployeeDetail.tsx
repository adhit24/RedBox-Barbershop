import { Link } from 'react-router-dom';
import { DemoBadge } from '../components/DemoBadge';

const LINES = [
  { label: 'Service Commission', note: '584 layanan selesai (contoh)', amount: 'Rp 3.900.000', color: 'text-rb-text' },
  { label: 'Revenue Sharing', note: 'Skema ilustratif, bukan kebijakan aktual', amount: 'Rp 720.000', color: 'text-rb-text' },
  { label: 'Attendance Adjustment', note: '21/22 hari hadir (contoh)', amount: '-Rp 50.000', color: 'text-rb-red-tint-fg' },
  { label: 'Overtime', note: '2 jam (contoh)', amount: '+Rp 80.000', color: 'text-rb-green-tint-fg' },
  { label: 'Other Adjustment', note: 'Bonus pelanggan baru (contoh)', amount: '+Rp 200.000', color: 'text-rb-green-tint-fg' },
];

export function PayrollEmployeeDetail() {
  return (
    <>
      <Link to="/payroll/regular" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Payroll</Link>

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rb-red-tint-bg text-sm font-semibold text-rb-red-tint-fg">DI</span>
          <div>
            <div className="text-[17px] font-semibold text-rb-text">Dodi Iskandar</div>
            <div className="text-xs text-rb-text-muted">Barber · Redbox Barbershop · CSB</div>
          </div>
        </div>
        <DemoBadge />
      </div>

      <div className="mb-4 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
          Rincian Komisi &amp; Revenue Sharing (contoh)
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {LINES.map((l) => (
            <div key={l.label} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm font-semibold text-rb-text">{l.label}</div>
                <div className="text-xs text-rb-text-muted">{l.note}</div>
              </div>
              <div className={`text-sm font-semibold ${l.color}`}>{l.amount}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-4">
          <div className="font-serif text-lg font-semibold text-rb-text">Final Pay</div>
          <div className="font-serif text-xl font-semibold text-rb-red">Rp 4.850.000</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button type="button" disabled className="rounded-rb-button bg-rb-red px-4 py-2.5 text-sm font-semibold text-white opacity-60">Approve</button>
        <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Edit Adjustment</button>
        <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Generate Payslip</button>
      </div>
    </>
  );
}
