// frontend/src/components/stockist/StatCard.tsx
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
  icon?: string;
  tint?: 'info' | 'success' | 'warning' | 'danger';
  heroTrend?: string;
  heroStats?: { label: string; value: string }[];
}

const TINT_BG: Record<NonNullable<StatCardProps['tint']>, string> = {
  info: 'bg-tint-info border-info/20',
  success: 'bg-tint-success border-success/20',
  warning: 'bg-tint-warning border-warning/20',
  danger: 'bg-tint-danger border-danger/20',
};

const TINT_ICON: Record<NonNullable<StatCardProps['tint']>, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

function StatCardBody(props: Omit<StatCardProps, 'href' | 'onClick'>) {
  const { label, value, formatter, hint, variant = 'default', trailingBadge, icon, tint, heroTrend, heroStats } = props;
  const isHero = variant === 'hero';
  const isDanger = variant === 'danger';

  if (isHero) {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-white/80 uppercase tracking-wide">{label}</span>
          {heroTrend && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-white bg-white/15 px-2 py-1 rounded-full shrink-0">
              <span className="material-symbols-outlined text-[13px]">trending_up</span>
              {heroTrend}
            </span>
          )}
        </div>
        <div className="font-display tabular-nums mt-2 text-[30px] font-bold text-white truncate">
          <AnimatedNumber value={value} formatter={formatter} />
        </div>
        {hint && <span className="text-[10px] text-white/70 mt-1 block">{hint}</span>}
        {heroStats && heroStats.length > 0 && (
          <div className="flex gap-2 mt-3">
            {heroStats.map((stat) => (
              <div key={stat.label} className="flex-1 bg-white/10 rounded-xl px-2.5 py-2 flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] font-bold text-white tabular-nums truncate">{stat.value}</span>
                <span className="text-[10px] text-white/75 truncate">{stat.label}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className={`material-symbols-outlined text-[18px] ${tint ? TINT_ICON[tint] : isDanger ? 'text-danger' : 'text-text-muted'}`}>
            {icon}
          </span>
        )}
        <span className={`text-[11px] font-semibold ${isDanger ? 'text-danger' : 'text-text-muted'}`}>{label}</span>
      </div>
      <div
        className={`font-display tabular-nums mt-2 flex items-baseline gap-2 truncate text-[19px] font-bold ${
          isDanger ? 'text-danger' : 'text-text-primary'
        }`}
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
  const { href, onClick, variant = 'default', tint } = props;
  const isDanger = variant === 'danger';
  const isHero = variant === 'hero';

  const className = isHero
    ? 'flex flex-col text-left rounded-xl min-h-[92px] w-full p-5 border border-transparent bg-gradient-to-br from-primary-container to-inverse-primary shadow-[0_10px_26px_rgba(199,40,32,0.22)]'
    : `flex flex-col text-left border rounded-xl min-h-[92px] w-full p-4 ${
        tint ? TINT_BG[tint] : isDanger ? 'bg-surface-elevated border-danger/30' : 'bg-surface-elevated border-border-base'
      }`;

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
