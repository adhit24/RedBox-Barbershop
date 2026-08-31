export function ErrorState({
  message = 'Terjadi kesalahan. Silakan coba lagi.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[240px] w-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-rb-red-tint-fg">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-sm font-medium text-rb-text-secondary transition hover:bg-rb-divider"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}
