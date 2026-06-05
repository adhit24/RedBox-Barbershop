const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  pending:     { label: 'Pending',    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',    dot: 'bg-amber-400' },
  confirmed:   { label: 'Confirmed',  color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',       dot: 'bg-blue-400' },
  done:        { label: 'Selesai',    color: 'bg-green-500/15 text-green-400 border-green-500/30',    dot: 'bg-green-400' },
  cancelled:   { label: 'Batal',      color: 'bg-red-500/15 text-red-400 border-red-500/30',          dot: 'bg-red-400' },
  no_show:     { label: 'No-show',    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',    dot: 'bg-slate-400' },
  departed:    { label: 'Berangkat',  color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', dot: 'bg-indigo-400' },
  arrived:     { label: 'Tiba',       color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',       dot: 'bg-cyan-400' },
  in_progress: { label: 'Dikerjakan', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
};

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? {
    label: status,
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    dot: 'bg-slate-400',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
