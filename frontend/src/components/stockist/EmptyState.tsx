// frontend/src/components/stockist/EmptyState.tsx
export interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-base p-6 text-center">
      <span className="material-symbols-outlined text-text-muted text-[32px]">
        {icon}
      </span>
      <span className="text-[13px] font-semibold text-text-primary">{title}</span>
      <span className="max-w-[240px] text-[11px] text-text-muted">{subtitle}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-lg border border-border-base px-3 py-1.5 text-[11px] font-semibold text-primary-container active:scale-95 transition-transform"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
