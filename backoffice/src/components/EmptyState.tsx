import type { ReactNode } from 'react';

/**
 * Generic empty-state, parameterized by title/description/icon — used both as the
 * "not built yet" placeholder for routes outside Phase 1A scope, and (per the
 * design handoff) as the future basis for a locked-module state once package
 * entitlement gating is turned on. Not a page in its own right.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-rb-card border border-rb-border bg-rb-surface p-10 text-center">
      {icon && <div className="mb-4 text-rb-text-faint">{icon}</div>}
      <h2 className="font-serif text-lg font-semibold text-rb-text">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-rb-text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
