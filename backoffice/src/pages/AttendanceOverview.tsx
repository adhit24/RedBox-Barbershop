import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

interface DemoAttendanceRow {
  name: string;
  branch: string;
  checkin: string;
  checkout: string;
  duration: string;
  status: 'Tepat Waktu' | 'Terlambat' | 'Missing Check-out';
}

const ROWS: DemoAttendanceRow[] = [
  { name: 'Dodi Iskandar', branch: 'CSB', checkin: '08:58', checkout: '18:02', duration: '9j 4m', status: 'Tepat Waktu' },
  { name: 'Rizky Pratama', branch: 'Sundaze Bypass', checkin: '09:22', checkout: '17:45', duration: '8j 23m', status: 'Terlambat' },
  { name: 'Andra Wijaya', branch: 'Tegal', checkin: '09:05', checkout: '—', duration: '—', status: 'Missing Check-out' },
  { name: 'Farhan Maulana', branch: 'Sumber', checkin: '08:50', checkout: '17:55', duration: '9j 5m', status: 'Tepat Waktu' },
  { name: 'Nadia Kusuma', branch: 'Sundaze Bypass', checkin: '08:45', checkout: '18:10', duration: '9j 25m', status: 'Tepat Waktu' },
  { name: 'Bagus Setiawan', branch: 'CSB', checkin: '09:18', checkout: '17:40', duration: '8j 22m', status: 'Terlambat' },
];

const STATUS_TINT: Record<DemoAttendanceRow['status'], string> = {
  'Tepat Waktu': 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  Terlambat: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  'Missing Check-out': 'bg-rb-red-tint-bg text-rb-red-tint-fg',
};

export function AttendanceOverview() {
  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Data contoh — barber_attendance produksi baru memiliki 2 baris, belum representatif"
        actions={<DemoBadge />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={61} label="Hadir Tepat Waktu (contoh)" tint="green" />
        <StatCard value={6} label="Terlambat (contoh)" tint="orange" />
        <StatCard value={2} label="Absen (contoh)" tint="red" />
        <Link to="/attendance/exceptions" className="block no-underline">
          <StatCard value={3} label="Exception Belum Selesai →" tint="blue" />
        </Link>
      </section>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-rb-divider px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">
          <div>Karyawan</div><div>Cabang</div><div>Check-in</div><div>Check-out</div><div>Durasi</div><div>Status</div>
        </div>
        <div className="flex flex-col divide-y divide-rb-divider">
          {ROWS.map((r) => (
            <div key={r.name} className="grid grid-cols-6 items-center gap-2 px-4 py-3 text-sm">
              <div className="font-semibold text-rb-text">{r.name}</div>
              <div className="text-rb-text-secondary">{r.branch}</div>
              <div className="text-rb-text-secondary">{r.checkin}</div>
              <div className="text-rb-text-secondary">{r.checkout}</div>
              <div className="text-rb-text-secondary">{r.duration}</div>
              <div><span className={`rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${STATUS_TINT[r.status]}`}>{r.status}</span></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
