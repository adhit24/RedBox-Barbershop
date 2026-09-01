import { PageHeader } from '../components/PageHeader';

const FREE_FEATURES = ['HR & People', 'Attendance', 'Regular Payroll'];
const BUSINESS_SUITE_FEATURES = [
  'Barber Commission Payroll', 'Operations', 'CRM & Customer',
  'Membership', 'Stockist Analytics', 'Moka Integration', 'Reports',
];

export function PackageFeatureAccess() {
  return (
    <>
      <PageHeader title="Akses Paket" subtitle="Mode prototipe saat ini vs. rencana paket komersial di masa depan" />

      <div className="mb-6 flex items-center justify-between rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rb-orange-tint-fg" />
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rb-text-muted">Mode Prototipe Saat Ini</div>
            <div className="font-serif text-xl font-semibold text-rb-text">Full Feature Review Mode</div>
            <div className="mt-1 text-xs text-rb-text-muted">Semua modul dibuka sementara agar Owner bisa menjelajah seluruh sistem sebelum development.</div>
          </div>
        </div>
        <span className="whitespace-nowrap rounded-rb-pill bg-rb-orange-tint-bg px-3.5 py-1.5 text-xs font-semibold text-rb-orange-tint-fg">Semua Fitur: Aktif</span>
      </div>

      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-rb-text-muted">Rencana Paket Komersial (belum diberlakukan)</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rb-green-tint-fg" />
            <h3 className="font-serif text-base font-semibold text-rb-text">Redbox Free</h3>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {FREE_FEATURES.map((f) => (
              <div key={f} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium text-rb-text">{f}</span>
                <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-green-tint-fg">Aktif sekarang</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-3.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rb-purple-tint-fg" />
            <h3 className="font-serif text-base font-semibold text-rb-text">Redbox Business Suite</h3>
          </div>
          <div className="flex flex-col divide-y divide-rb-divider">
            {BUSINESS_SUITE_FEATURES.map((f) => (
              <div key={f} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium text-rb-text">{f}</span>
                <span className="rounded-rb-pill bg-rb-orange-tint-bg px-2.5 py-1 text-[11px] font-semibold text-rb-orange-tint-fg">Dibuka untuk review</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4.5 text-xs leading-relaxed text-rb-text-faint">
        Setelah keputusan paket final, sistem entitlement ini akan mengunci kembali modul Business Suite sampai diaktifkan lewat upgrade atau add-on.
      </p>
    </>
  );
}
