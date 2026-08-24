// frontend/src/components/stockist/SkeletonCard.tsx
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-border-base bg-surface-elevated p-4 ${className}`}>
      <div className="h-[60px] w-full animate-shimmer rounded-lg bg-surface-container" />
      <div className="h-3 w-[70%] animate-shimmer rounded bg-surface-container" />
      <div className="h-3 w-[45%] animate-shimmer rounded bg-surface-container" />
    </div>
  );
}
