'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, User } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
  { href: '/owner/dashboard', label: 'Overview', Icon: LayoutDashboard },
  { href: '/owner/revenue',   label: 'Revenue',  Icon: TrendingUp },
  { href: '/owner/profile',   label: 'Profil',   Icon: User },
];

export function OwnerNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0F1E]/95 backdrop-blur-md border-t border-slate-800">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className="flex-1 flex flex-col items-center justify-center py-2.5 relative">
              {active && (
                <motion.div layoutId="owner-nav-indicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-green-400"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
              )}
              <Icon size={20} className={`transition-colors duration-200 ${active ? 'text-green-400' : 'text-slate-500'}`} />
              <span className={`text-[10px] mt-0.5 font-medium transition-colors duration-200 ${active ? 'text-green-400' : 'text-slate-500'}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
