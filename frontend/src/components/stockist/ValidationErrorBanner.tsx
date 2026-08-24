export function ValidationErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent-soft bg-tint-danger p-3 text-sm text-danger">
      <span className="material-symbols-outlined text-[18px]">error</span>
      <span>{message}</span>
    </div>
  );
}
