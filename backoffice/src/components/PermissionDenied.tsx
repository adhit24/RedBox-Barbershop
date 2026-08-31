export function PermissionDenied({
  message = 'Kamu tidak punya akses ke halaman ini.',
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-rb-card border border-rb-border bg-rb-surface p-10 text-center">
      <h2 className="font-serif text-lg font-semibold text-rb-text">Akses ditolak</h2>
      <p className="max-w-sm text-sm text-rb-text-muted">{message}</p>
    </div>
  );
}
