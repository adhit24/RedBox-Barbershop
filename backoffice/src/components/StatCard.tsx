import type { ReactNode } from 'react';
import type { BadgeTint } from './StatusBadge';

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

export function StatCard({
  icon,
  value,
  label,
  trend,
  tint = 'neutral',
}: {
  icon?: ReactNode;
  value: ReactNode;
  label: string;
  trend?: string;
  tint?: BadgeTint;
}) {
  return (
    <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5 transition hover:shadow-[0_4px_24px_rgba(30,25,20,0.06)]">
      {icon && (
        <div className={`mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full ${TINT_BG[tint]}`}>
          {icon}
        </div>
      )}
      <div className="font-serif text-2xl font-semibold text-rb-text">{value}</div>
      <div className="mt-1 text-sm font-semibold text-rb-text-secondary">{label}</div>
      {trend && <div className={`mt-1 text-xs ${TINT_BG[tint].split(' ')[1]}`}>{trend}</div>}
    </div>
  );
}
