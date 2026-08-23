'use client';

import Link from 'next/link';

export interface QuickAction {
  key: string;
  href: string;
  icon: string;
  label: string;
}

export function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action) => (
        <Link
          key={action.key}
          href={action.href}
          className="min-h-[48px] flex items-center gap-2.5 p-3 rounded-xl border border-border-base bg-surface-elevated text-text-primary text-[12px] font-bold hover:border-primary-container hover:text-primary-container active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-primary-container text-[19px]">{action.icon}</span>
          {action.label}
        </Link>
      ))}
    </div>
  );
}
