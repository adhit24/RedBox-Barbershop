interface Props {
  current: number;
  target: number;
  label?: string;
}

export function TargetProgressBar({ current, target, label }: Props) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const reached = current >= target;
  return (
    <div>
      {label && <p className="text-sm text-gray-500 mb-1">{label}</p>}
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-2xl font-bold text-gray-900">{current}</span>
        <span className="text-sm text-gray-500">/ {target}</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${reached ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
