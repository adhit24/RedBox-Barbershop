export function LoadingState({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-rb-text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-rb-border border-t-rb-red" />
        {label}
      </div>
    </div>
  );
}
