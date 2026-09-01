import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';

const REPORTS = [
  { title: 'Branch Performance', desc: 'Perbandingan booking, omset, dan customer antar cabang.', href: '/reports/branches', tint: 'bg-rb-red-tint-bg text-rb-red-tint-fg' },
  { title: 'Barber Performance', desc: 'Customer dilayani, repeat rate, dan layanan selesai per barber.', href: '/reports/barbers', tint: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg' },
  { title: 'Customer Report', desc: 'Retensi, segmentasi, dan peluang reaktivasi pelanggan.', href: '/reports/customers', tint: 'bg-rb-blue-tint-bg text-rb-blue-tint-fg' },
  { title: 'Membership Report', desc: 'Pertumbuhan member, poin, dan distribusi tier.', href: '/reports/membership', tint: 'bg-rb-teal-tint-bg text-rb-teal-tint-fg' },
];

export function ReportsOverview() {
  return (
    <>
      <PageHeader title="Reports" subtitle="Business intelligence operasional Redbox" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            to={r.href}
            className="block rounded-rb-card border border-rb-border bg-rb-surface p-5 no-underline transition hover:shadow-[0_4px_24px_rgba(30,25,20,0.06)]"
          >
            <div className={`mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] text-sm font-semibold ${r.tint}`}>
              {r.title.charAt(0)}
            </div>
            <div className="mb-1 text-[15px] font-semibold text-rb-text">{r.title}</div>
            <div className="text-xs leading-relaxed text-rb-text-muted">{r.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
