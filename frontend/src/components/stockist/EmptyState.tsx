export interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle: string;
}

export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <div className="bg-surface-elevated border border-border-base rounded-xl p-4 flex items-center gap-3">
      <span className="material-symbols-outlined text-success text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        <span className="text-[11px] text-text-muted">{subtitle}</span>
      </div>
    </div>
  );
}
