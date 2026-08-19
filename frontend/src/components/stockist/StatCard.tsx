'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { AnimatedNumber } from './AnimatedNumber';
import { cardHover } from '@/lib/stockist/motion';

export interface StatCardProps {
  label: string;
  value: number;
  formatter?: (n: number) => string;
  hint?: string;
  variant?: 'default' | 'hero' | 'danger';
  href?: string;
  onClick?: () => void;
  trailingBadge?: string;
}

function StatCardBody({ label, value, formatter, hint, variant = 'default', trailingBadge }: Omit<StatCardProps, 'href' | 'onClick'>) {
  const isHero = variant === 'hero';
  const isDanger = variant === 'danger';
  return (
    <>
      <span className={`text-[11px] font-semibold ${isDanger ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
      <div
        className={`font-display tabular-nums mt-2 flex items-baseline gap-2 ${
          isHero ? 'text-[30px] font-bold' : 'text-[19px] font-bold'
        } ${isDanger ? 'text-danger' : 'text-text-primary'}`}
      >
        <AnimatedNumber value={value} formatter={formatter} />
        {trailingBadge && (
          <span className="text-[10px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded border border-warning/20">
            {trailingBadge}
          </span>
        )}
      </div>
      {hint && <span className="text-[10px] text-text-muted mt-1 block">{hint}</span>}
    </>
  );
}

export function StatCard(props: StatCardProps) {
  const { href, onClick, variant = 'default' } = props;
  const isDanger = variant === 'danger';
  const isHero = variant === 'hero';
  const className = `flex flex-col text-left bg-surface-elevated border rounded-xl min-h-[92px] w-full ${
    isHero ? 'p-5' : 'p-4'
  } ${isDanger ? 'border-danger/30' : 'border-border-base'}`;

  if (href) {
    return (
      <Link href={href} className="block">
        <motion.div {...cardHover} className={className}>
          <StatCardBody {...props} />
        </motion.div>
      </Link>
    );
  }

  if (onClick) {
    return (
      <motion.button type="button" onClick={onClick} className={className} {...cardHover}>
        <StatCardBody {...props} />
      </motion.button>
    );
  }

  return (
    <div className={className}>
      <StatCardBody {...props} />
    </div>
  );
}
