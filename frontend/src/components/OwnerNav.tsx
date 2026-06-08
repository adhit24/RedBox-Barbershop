'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, User, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
  { href: '/owner/dashboard', label: 'Overview', Icon: LayoutDashboard },
  { href: '/owner/revenue',   label: 'Revenue',  Icon: TrendingUp },
  { href: '/owner/payment',   label: 'Payment',  Icon: CreditCard },
  { href: '/owner/profile',   label: 'Profil',   Icon: User },
];

export function OwnerNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md border-t"
      style={{ background: 'rgba(8,5,9,0.97)', borderColor: '#201618' }}
    >
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className="flex-1 flex flex-col items-center justify-center py-2.5 relative">
              {active && (
                <motion.div
                  layoutId="owner-nav-indicator"
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
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
