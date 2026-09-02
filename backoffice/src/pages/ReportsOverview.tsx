import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { BarChartIcon, PersonIcon, UsersIcon, MemberIcon, CalendarIcon, ClockIcon, BoxIcon } from '../components/icons';
import type { BadgeTint } from '../components/StatusBadge';

const TINT_BG: Record<BadgeTint, string> = {
  red: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
  orange: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  green: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  blue: 'bg-rb-blue-tint-bg text-rb-blue-tint-fg',
  purple: 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  teal: 'bg-rb-teal-tint-bg text-rb-teal-tint-fg',
  yellow: 'bg-rb-yellow-tint-bg text-rb-yellow-tint-fg',
  neutral: 'bg-rb-divider text-rb-text-muted',
};

interface ReportCard {
  title: string;
  desc: string;
  href: string;
  tint: BadgeTint;
  icon: ReactNode;
}

const REPORTS: ReportCard[] = [
  {
    title: 'Branch Performance',
    desc: 'Perbandingan booking, customer, dan aktivitas operasional antar cabang.',
    href: '/reports/branches',
    tint: 'red',
    icon: <BarChartIcon size={20} />,
  },
  {
    title: 'Barber Performance',
    desc: 'Customer dilayani dan repeat rate per kapster.',
    href: '/reports/barbers',
    tint: 'purple',
    icon: <PersonIcon size={20} />,
  },
  {
    title: 'Customer Report',
    desc: 'Retensi, segmentasi, dan peluang reaktivasi pelanggan.',
    href: '/reports/customers',
    tint: 'blue',
    icon: <UsersIcon size={20} />,
  },
  {
    title: 'Membership Report',
    desc: 'Pertumbuhan member, poin, dan distribusi tier.',
    href: '/reports/membership',
    tint: 'teal',
    icon: <MemberIcon size={20} />,
  },
  {
    title: 'Booking Performance',
    desc: 'Volume booking, status booking, cabang, dan pola waktu kunjungan.',
    href: '/reports/bookings',
    tint: 'green',
    icon: <CalendarIcon size={20} />,
  },
  {
    title: 'Attendance Report',
    desc: 'Kehadiran, keterlambatan, exception, dan pola attendance per cabang.',
    href: '/reports/attendance',
    tint: 'orange',
    icon: <ClockIcon size={20} />,
  },
  {
    title: 'Inventory Report',
    desc: 'Stok, transfer, adjustment, dan discrepancy inventory antar cabang.',
    href: '/reports/inventory',
    tint: 'yellow',
    icon: <BoxIcon size={20} />,
  },
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
            <div className={`mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] ${TINT_BG[r.tint]}`}>
              {r.icon}
            </div>
            <div className="mb-1 text-[15px] font-semibold text-rb-text">{r.title}</div>
            <div className="text-xs leading-relaxed text-rb-text-muted">{r.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
