'use client';

interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'lg';
  disabled?: boolean;
}

export function Stepper({ value, onChange, min = 0, max = Infinity, size = 'lg', disabled = false }: StepperProps) {
  const buttonSize = size === 'lg' ? 'h-[46px] w-[46px]' : 'h-10 w-10';
  const numberSize = size === 'lg' ? 'text-[26px]' : 'text-[19px]';

  function decrement() {
    if (disabled) return;
    onChange(Math.max(min, value - 1));
  }

  function increment() {
    if (disabled) return;
    onChange(Math.min(max, value + 1));
  }

  return (
    <div className="flex items-center justify-center gap-4 rounded-2xl border border-border-base bg-surface-container-lowest p-2">
      <button
        type="button"
        onClick={decrement}
        disabled={disabled || value <= min}
        aria-label="Kurangi"
        className={`flex shrink-0 items-center justify-center rounded-xl border border-border-base bg-surface-elevated text-text-primary disabled:opacity-40 active:scale-95 transition-transform ${buttonSize}`}
      >
        <span className="material-symbols-outlined text-[20px]">remove</span>
      </button>
      <span className={`min-w-[2ch] text-center font-bold text-text-primary font-display tabular-nums ${numberSize}`}>
        {value}
      </span>
      <button
        type="button"
        onClick={increment}
        disabled={disabled || value >= max}
        aria-label="Tambah"
        className={`flex shrink-0 items-center justify-center rounded-xl bg-primary-container text-white disabled:opacity-40 active:scale-95 transition-transform ${buttonSize}`}
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
      </button>
    </div>
  );
}
