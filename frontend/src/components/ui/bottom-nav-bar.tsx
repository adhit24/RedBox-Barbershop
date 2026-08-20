'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
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
  stickyBottom?: boolean;
};

const LABEL_WIDTH = 88;

export function BottomNavBar({ items, className = '', stickyBottom = true }: BottomNavBarProps) {
  const pathname = usePathname() || '';
  // A single-item nav (Owner's Command Center) always shows its label —
  // there's nothing to disambiguate via icon-only collapse when there's
  // only one destination, and the old inline nav it replaced always showed
  // this label too.
  const alwaysExpanded = items.length === 1;

  return (
    <motion.nav
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      aria-label="Navigasi utama"
      className={cn(
        'bg-surface-container-highest border border-border-base rounded-full flex items-center p-2 gap-1 shadow-[0_-8px_32px_rgba(0,0,0,0.4)] w-fit min-w-[220px] max-w-[95vw] h-[52px]',
        stickyBottom && 'fixed inset-x-0 bottom-4 mx-auto z-50',
        className
      )}
    >
      {items.map((item) => {
        // Exact match for the root Stockist route so it doesn't stay "active"
        // on every deeper page (which all start with the same prefix).
        const active = item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? (item.href === '/admin/stockist'
          ? pathname === item.href
          : pathname.startsWith(item.href));
        const expanded = alwaysExpanded || active;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container/50"
          >
            <motion.span
              whileTap={{ scale: 0.97 }}
              className={cn(
                'flex items-center h-10 min-w-[40px] min-h-[40px] px-2.5 rounded-full transition-colors duration-200',
                active
                  ? 'bg-primary-container/10 text-primary-container'
                  : 'bg-transparent text-text-secondary hover:bg-surface-container-high'
              )}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.4 : 2}
                aria-hidden
                className="shrink-0 transition-colors duration-200"
              />
              <motion.span
                initial={false}
                animate={{
                  width: expanded ? LABEL_WIDTH : 0,
                  opacity: expanded ? 1 : 0,
                  marginLeft: expanded ? 8 : 0,
                }}
                transition={{
                  width: { type: 'spring', stiffness: 350, damping: 32 },
                  opacity: { duration: 0.19 },
                  marginLeft: { duration: 0.19 },
                }}
                className="overflow-hidden flex items-center"
              >
                <span
                  className={cn(
                    'font-bold text-[10px] tracking-tight whitespace-nowrap select-none',
                    active ? 'text-primary-container' : 'text-text-secondary'
                  )}
                >
                  {item.label}
                </span>
              </motion.span>
            </motion.span>
          </Link>
        );
      })}
    </motion.nav>
  );
}

export default BottomNavBar;
