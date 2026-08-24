// frontend/src/components/stockist/SuccessScreen.tsx
import Link from 'next/link';

export interface SuccessScreenProps {
  title: string;
  body: string;
  summary: Array<{ label: string; value: string }>;
  secondaryAction: { label: string; href: string };
}

export function SuccessScreen({ title, body, summary, secondaryAction }: SuccessScreenProps) {
  return (
    <div className="flex flex-col items-center pt-14 px-4 text-center">
      <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-success bg-tint-success">
        <span className="material-symbols-outlined text-success text-[44px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          check_circle
        </span>
      </div>
      <h2 className="mt-5 text-[20px] font-extrabold text-text-primary font-display">{title}</h2>
      <p className="mt-2 max-w-[280px] text-[13px] font-medium text-text-secondary">{body}</p>

      <div className="mt-6 w-full max-w-[320px] rounded-xl border border-border-base bg-surface-elevated divide-y divide-border-base">
        {summary.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2.5 text-[12.5px]">
            <span className="text-text-muted">{row.label}</span>
            <span className="font-semibold text-text-primary">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex w-full max-w-[320px] flex-col gap-2.5">
        <Link
          href="/admin/stockist"
          className="flex h-[48px] items-center justify-center rounded-xl bg-primary-container text-[13px] font-bold text-white active:scale-95 transition-transform"
        >
          Kembali ke Beranda
        </Link>
        <Link
          href={secondaryAction.href}
          className="flex h-[48px] items-center justify-center rounded-xl border border-border-base text-[13px] font-bold text-text-primary active:scale-95 transition-transform"
        >
          {secondaryAction.label}
        </Link>
      </div>
    </div>
  );
}
