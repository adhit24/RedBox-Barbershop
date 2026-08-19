export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-surface-elevated border border-border-base rounded-xl p-4 min-h-[92px] animate-pulse flex flex-col gap-3 ${className}`}>
      <div className="h-3 w-2/3 bg-surface-container-high rounded" />
      <div className="h-6 w-1/2 bg-surface-container-high rounded" />
    </div>
  );
}
