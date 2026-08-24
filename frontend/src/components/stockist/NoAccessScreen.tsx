export function NoAccessScreen() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-surface-elevated px-8 text-center">
      <span className="material-symbols-outlined text-text-muted text-[52px]">lock</span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] font-bold text-text-primary">Anda tidak memiliki akses ke data ini.</h2>
        <p className="max-w-[280px] text-[13px] text-text-secondary">
          Hubungi owner untuk membuka akses.
        </p>
      </div>
    </div>
  );
}
