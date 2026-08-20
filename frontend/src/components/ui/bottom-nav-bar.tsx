'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type BottomNavBarProps = {
  items: BottomNavItem[];
  className?: string;
  stickyBottom?: boolean;
};

export function BottomNavBar({ items, className = '', stickyBottom = true }: BottomNavBarProps) {
  const pathname = usePathname() || '';

  return (
    <nav
      className={`${stickyBottom ? 'fixed bottom-0 left-1/2 -translate-x-1/2' : ''} w-full max-w-[430px] bg-surface-container-highest border-t border-border-base rounded-t-xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)] flex justify-around items-center px-2 py-2 z-50 ${className}`}
    >
      {items.map((item) => {
        // Exact match for the root Stockist route so it doesn't stay "active"
        // on every deeper page (which all start with the same prefix).
        const active = item.href === '/admin/stockist'
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] px-2 py-1 rounded-xl"
          >
            {active && (
              <motion.div
                layoutId="stockist-bottom-nav-indicator"
                className="absolute inset-0 rounded-xl bg-primary-container/10"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <Icon
              size={20}
              className={`relative transition-colors duration-200 ${active ? 'text-primary-container' : 'text-text-secondary'}`}
              strokeWidth={active ? 2.4 : 2}
            />
            <span className={`relative text-[10px] tracking-tight transition-colors duration-200 ${active ? 'text-primary-container font-bold' : 'text-text-secondary font-medium'}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
