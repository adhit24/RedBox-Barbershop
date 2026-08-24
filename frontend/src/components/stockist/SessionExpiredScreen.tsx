export function SessionExpiredScreen({ onLoginAgain }: { onLoginAgain: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="material-symbols-outlined text-text-muted text-[52px]">schedule</span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] font-bold text-text-primary">Sesi Anda berakhir</h2>
        <p className="max-w-[280px] text-[13px] text-text-secondary">
          Masuk kembali untuk melanjutkan pekerjaan. Data form tersimpan.
        </p>
      </div>
      <button
        type="button"
        onClick={onLoginAgain}
        className="mt-2 h-[52px] w-full max-w-[240px] rounded-2xl bg-primary-container font-bold text-white active:scale-95 transition-transform"
      >
        Masuk Lagi
      </button>
    </div>
  );
}
