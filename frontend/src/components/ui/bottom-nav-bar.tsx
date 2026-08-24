'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  activePrefixes?: string[];
};

export type BottomNavBarProps = {
  items: BottomNavItem[];
  className?: string;
};

export function BottomNavBar({ items, className = '' }: BottomNavBarProps) {
  const pathname = usePathname() || '';

  return (
    <nav
      aria-label="Navigasi utama"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[430px] items-stretch bg-surface-elevated border-t border-border-base px-1 pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]',
        className
      )}
    >
      {items.map((item) => {
        // Exact match for the root Stockist route so it doesn't stay "active"
        // on every deeper page (which all start with the same prefix).
        const active = item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? (item.href === '/admin/stockist'
          ? pathname === item.href
          : pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl transition-colors active:scale-95',
              active ? 'text-primary-container' : 'text-text-muted hover:text-text-secondary'
            )}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} aria-hidden />
            <span className="text-[10px] font-bold tracking-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default BottomNavBar;
