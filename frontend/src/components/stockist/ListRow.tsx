'use client';

import Link from 'next/link';

export interface ListRowData {
  key: string;
  href?: string;
  onClick?: () => void;
  icon: string;
  severity: 'danger' | 'warning' | 'neutral';
  title: string;
  subtitle: string;
  trailing?: string;
}

const severityIconClasses: Record<ListRowData['severity'], string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-surface-container-high text-text-muted',
};

const severityTrailingClasses: Record<ListRowData['severity'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  neutral: 'text-text-primary',
};

function ListRowBody({ row }: { row: ListRowData }) {
  return (
    <>
      <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${severityIconClasses[row.severity]}`}>
        <span className="material-symbols-outlined text-[18px]">{row.icon}</span>
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-semibold text-text-primary leading-tight truncate">{row.title}</span>
        <span className="text-[11px] text-text-muted mt-0.5 truncate">{row.subtitle}</span>
      </div>
      {row.trailing && (
        <span className={`text-[13px] font-bold tabular-nums shrink-0 ${severityTrailingClasses[row.severity]}`}>{row.trailing}</span>
      )}
      <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
    </>
  );
}

export function ListRow({ row }: { row: ListRowData }) {
  const className = 'flex items-center gap-3 p-3 hover:bg-surface-container-high active:bg-surface-container transition-colors';
  if (row.href) {
    return (
      <Link href={row.href} className={className}>
        <ListRowBody row={row} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={row.onClick} className={`${className} w-full text-left`}>
      <ListRowBody row={row} />
    </button>
  );
}
