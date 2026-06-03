'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, CalendarDays, Trophy, Megaphone, User } from 'lucide-react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface Props {
  items: NavItem[];
}

// Map emoji/slug to lucide icon
const ICON_MAP: Record<string, LucideIcon> = {
  '🏠': Home,
  '📅': CalendarDays,
  '🏆': Trophy,
  '📣': Megaphone,
  '👤': User,
};

export function BottomNav({ items }: Props) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md border-t"
      style={{ background: 'rgba(8,5,9,0.97)', borderColor: '#201618' }}
    >
      <div className="flex">
        {items.map(item => {
          const active = pathname.startsWith(item.href);
          const Icon = ICON_MAP[item.icon] ?? User;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center py-2.5 relative"
            >
              {active && (
                <motion.div
                  layoutId="barber-nav-indicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full"
                  style={{ background: '#C72820' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <Icon
                size={20}
                style={{ color: active ? '#E87068' : '#4A3E40' }}
                className="transition-colors duration-200"
              />
              <span
                className="text-[10px] mt-0.5 font-medium transition-colors duration-200"
                style={{ color: active ? '#E87068' : '#4A3E40' }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
