export function OfflineBanner() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning bg-tint-warning p-3.5 text-warning">
      <span className="material-symbols-outlined text-[20px]">wifi_off</span>
      <div className="flex flex-col">
        <span className="text-[12px] font-semibold">Koneksi sedang bermasalah.</span>
        <span className="text-[11px] text-text-secondary">Data terakhir masih ditampilkan.</span>
      </div>
    </div>
  );
}
