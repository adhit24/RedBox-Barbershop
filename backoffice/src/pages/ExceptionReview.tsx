import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { DemoBadge } from '../components/DemoBadge';

interface DemoException {
  id: string;
  initials: string;
  name: string;
  role: string;
  branch: string;
  detected: string;
  date: string;
}

const EXCEPTIONS: DemoException[] = [
  { id: 'e1', initials: 'R', name: 'Rizky Pratama', role: 'Barista', branch: 'Sundaze Coffee Shop', detected: 'Terlambat 22 menit', date: '28 Agustus 2026' },
  { id: 'e2', initials: 'A', name: 'Andra Wijaya', role: 'Cashier', branch: 'Tegal', detected: 'Missing check-out', date: '28 Agustus 2026' },
  { id: 'e3', initials: 'B', name: 'Bagus Setiawan', role: 'Barber', branch: 'CSB', detected: 'Terlambat 15 menit', date: '27 Agustus 2026' },
];

export function ExceptionReview() {
  const [selectedId, setSelectedId] = useState(EXCEPTIONS[0].id);
  const selected = EXCEPTIONS.find((e) => e.id === selectedId) ?? EXCEPTIONS[0];

  return (
    <>
      <Link to="/attendance" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">← Kembali ke Attendance</Link>
      <PageHeader title="Exception Review" actions={<DemoBadge />} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.5fr]">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface overflow-hidden">
          <div className="border-b border-rb-divider px-4 py-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            {EXCEPTIONS.length} Exception Menunggu (contoh)
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {EXCEPTIONS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => setSelectedId(ex.id)}
                className={`flex items-center gap-3 px-4 py-3.5 text-left ${ex.id === selectedId ? 'bg-rb-bg' : 'bg-rb-surface'}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rb-orange-tint-bg text-xs font-semibold text-rb-orange-tint-fg">{ex.initials}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-rb-text">{ex.name}</div>
                  <div className="truncate text-xs text-rb-text-muted">{ex.detected}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rb-orange-tint-bg text-sm font-semibold text-rb-orange-tint-fg">{selected.initials}</span>
            <div>
              <div className="font-semibold text-rb-text">{selected.name}</div>
              <div className="text-xs text-rb-text-muted">{selected.branch} · {selected.role}</div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3.5">
            <div className="rounded-xl bg-rb-bg px-4 py-3.5">
              <div className="mb-1 text-[11px] font-semibold text-rb-text-muted">Tanggal</div>
              <div className="text-sm font-semibold text-rb-text">{selected.date}</div>
            </div>
            <div className="rounded-xl bg-rb-orange-tint-bg px-4 py-3.5">
              <div className="mb-1 text-[11px] font-semibold text-rb-text-muted">Terdeteksi</div>
              <div className="text-sm font-semibold text-rb-orange-tint-fg">{selected.detected}</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-xs font-semibold text-rb-text-muted">Alasan</div>
            <input disabled placeholder="— belum diisi —" className="w-full rounded-rb-button border border-rb-border bg-rb-bg px-3 py-2.5 text-sm text-rb-text-muted" />
          </div>

          <div className="my-4 h-px bg-rb-divider" />

          <div className="mb-2.5 text-xs font-semibold text-rb-text-muted">Tindakan</div>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled className="rounded-rb-button bg-rb-red px-4 py-2.5 text-sm font-semibold text-white opacity-60">Approve Penalty</button>
            <button type="button" disabled className="rounded-rb-button bg-rb-green-tint-bg px-4 py-2.5 text-sm font-semibold text-rb-green-tint-fg opacity-60">Approve Exception</button>
            <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Edit Record</button>
            <button type="button" disabled className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2.5 text-sm font-semibold text-rb-text-secondary opacity-60">Add Note</button>
          </div>
        </div>
      </div>
    </>
  );
}
