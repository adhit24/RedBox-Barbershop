import type { RevenuePeriod } from '../services/crm';

const OPTIONS: { value: RevenuePeriod; label: string }[] = [
  { value: 'today', label: 'Hari Ini' },
  { value: '7d', label: '7 Hari Terakhir' },
  { value: '30d', label: '30 Hari Terakhir' },
  { value: 'month', label: 'Bulan Ini' },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: RevenuePeriod;
  onChange: (period: RevenuePeriod) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="sr-only">Periode</span>
      <select
        aria-label="Periode"
        value={value}
        onChange={(e) => onChange(e.target.value as RevenuePeriod)}
        className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-2 text-sm text-rb-text-secondary outline-none focus:border-rb-red"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
