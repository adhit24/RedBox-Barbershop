export type BadgeTint = 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'teal' | 'yellow' | 'neutral';

const TINT_CLASSES: Record<BadgeTint, string> = {
  red: 'bg-rb-red-tint-bg text-rb-red-tint-fg',
  orange: 'bg-rb-orange-tint-bg text-rb-orange-tint-fg',
  green: 'bg-rb-green-tint-bg text-rb-green-tint-fg',
  blue: 'bg-rb-blue-tint-bg text-rb-blue-tint-fg',
  purple: 'bg-rb-purple-tint-bg text-rb-purple-tint-fg',
  teal: 'bg-rb-teal-tint-bg text-rb-teal-tint-fg',
  yellow: 'bg-rb-yellow-tint-bg text-rb-yellow-tint-fg',
  neutral: 'bg-rb-divider text-rb-text-muted',
};

export function StatusBadge({ label, tint = 'neutral' }: { label: string; tint?: BadgeTint }) {
  return (
    <span
      className={`inline-flex items-center rounded-rb-pill px-2.5 py-1 text-[11px] font-semibold ${TINT_CLASSES[tint]}`}
    >
      {label}
    </span>
  );
}
