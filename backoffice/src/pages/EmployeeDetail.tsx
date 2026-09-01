import { Link } from 'react-router-dom';
import { DemoBadge } from '../components/DemoBadge';

const FIELDS = [
  { label: 'Employee ID', value: 'RB-0098' },
  { label: 'Business Unit', value: 'Redbox Barbershop' },
  { label: 'Cabang Saat Ini', value: 'CSB' },
  { label: 'Tanggal Mulai', value: '3 Jan 2023' },
  { label: 'Tipe Payroll', value: 'Komisi Barber' },
  { label: 'Status', value: 'Karyawan Tetap' },
];

const PERFORMANCE = [
  { value: '612', label: 'Customer Dilayani' },
  { value: '58%', label: 'Repeat Customer' },
  { value: '584', label: 'Layanan Selesai' },
  { value: '21/22', label: 'Attendance' },
];

const HISTORY = [
  { branch: 'CSB', period: 'Jan 2025 — sekarang' },
  { branch: 'Samadikun', period: 'Jun 2024 — Jan 2025' },
  { branch: 'Bypass', period: 'Jan 2023 — Jun 2024' },
];

export function EmployeeDetail() {
  return (
    <>
      <Link to="/hr" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke HR &amp; People</Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rb-red-tint-bg text-xl font-semibold text-rb-red-tint-fg">DI</span>
            <DemoBadge />
          </div>
          <h1 className="font-serif text-xl font-semibold text-rb-text">Dodi Iskandar</h1>
          <div className="mb-3 text-xs text-rb-text-muted">Barber · Redbox Barbershop</div>
          <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-green-tint-fg">Aktif</span>
          <div className="my-4 h-px bg-rb-divider" />
          <div className="flex flex-col gap-2 text-sm">
            {FIELDS.map((f) => (
              <div key={f.label} className="flex justify-between">
                <span className="text-rb-text-muted">{f.label}</span>
                <span className="font-semibold text-rb-text">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Ringkasan Layanan (contoh)</h2>
            <div className="grid grid-cols-4 gap-3">
              {PERFORMANCE.map((p) => (
                <div key={p.label}>
                  <div className="font-serif text-lg font-semibold text-rb-text">{p.value}</div>
                  <div className="text-[11px] text-rb-text-muted">{p.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <h2 className="mb-3 font-serif text-base font-semibold text-rb-text">Riwayat Cabang</h2>
            <div className="flex flex-col divide-y divide-rb-divider">
              {HISTORY.map((h) => (
                <div key={h.branch} className="flex justify-between py-2 text-sm">
                  <span className="font-medium text-rb-text">{h.branch}</span>
                  <span className="text-rb-text-muted">{h.period}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
