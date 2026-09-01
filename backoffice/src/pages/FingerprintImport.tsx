import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

const LAST_IMPORT = [
  { value: '312', label: 'Records Diimport', tint: 'bg-rb-green-tint-bg' },
  { value: '18', label: 'Karyawan Cocok', tint: 'bg-rb-blue-tint-bg' },
  { value: '9', label: 'Record Terlambat', tint: 'bg-rb-orange-tint-bg' },
  { value: '2', label: 'Missing Check-in', tint: 'bg-rb-red-tint-bg' },
  { value: '1', label: 'Missing Check-out', tint: 'bg-rb-red-tint-bg' },
];

export function FingerprintImport() {
  return (
    <>
      <Link to="/attendance" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Attendance</Link>
      <PageHeader
        title="Import Fingerprint"
        subtitle="Unggah data mesin fingerprint untuk diproses menjadi attendance"
        actions={<DemoBadge />}
      />

      <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Cabang</div>
            <select disabled className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text">
              <option>Sundaze Coffee Shop</option>
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Periode</div>
            <select disabled className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text">
              <option>Agustus 2026</option>
            </select>
          </div>
        </div>
        <div className="rounded-2xl border border-dashed border-rb-border bg-rb-bg px-8 py-10 text-center">
          <div className="mb-1 text-sm font-semibold text-rb-text">Drag &amp; drop file XLS/XLSX di sini</div>
          <div className="mb-3.5 text-xs text-rb-text-muted">atau klik untuk memilih file dari komputer</div>
          <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-sm font-semibold text-rb-text-secondary">
            Pilih File
          </button>
        </div>
        <button type="button" disabled className="mt-4 w-full rounded-rb-button bg-rb-red px-4 py-3 text-sm font-semibold text-white opacity-60">
          Upload &amp; Process
        </button>
      </div>

      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Hasil Import Terakhir (contoh)</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {LAST_IMPORT.map((s) => (
          <div key={s.label} className={`rounded-2xl px-4 py-3.5 ${s.tint}`}>
            <div className="font-serif text-xl font-semibold text-rb-text">{s.value}</div>
            <div className="text-xs font-semibold text-rb-text-secondary">{s.label}</div>
          </div>
        ))}
        <Link to="/attendance/exceptions" className="block rounded-2xl bg-rb-purple-tint-bg px-4 py-3.5 no-underline">
          <div className="font-serif text-xl font-semibold text-rb-text">3</div>
          <div className="text-xs font-semibold text-rb-purple-tint-fg">Exceptions →</div>
        </Link>
      </div>
    </>
  );
}
