import { StatusBadge, type BadgeTint } from './StatusBadge';

export interface LiveBadgeProps {
  partial?: boolean;
  status?: 'live' | 'delayed' | 'stale' | 'unavailable';
  ageMinutes?: number | null;
  label?: string;
}

/** Marks a module wired to real production data (spec §5) with live freshness support. */
export function LiveBadge({ partial = false, status, ageMinutes, label }: LiveBadgeProps) {
  if (label) {
    const tint: BadgeTint = status === 'delayed' ? 'yellow' : status === 'stale' ? 'orange' : status === 'unavailable' ? 'neutral' : 'green';
    return <StatusBadge label={label} tint={tint} />;
  }

  if (status === 'unavailable') {
    return <StatusBadge label="UNAVAILABLE" tint="neutral" />;
  }

  if (status === 'stale') {
    const text = ageMinutes != null ? `STALE · ${ageMinutes}m ago` : 'STALE';
    return <StatusBadge label={text} tint="orange" />;
  }

  if (status === 'delayed') {
    const text = ageMinutes != null ? `DELAYED · ${ageMinutes}m ago` : 'DELAYED';
    return <StatusBadge label={text} tint="yellow" />;
  }

  if (status === 'live') {
    const text = ageMinutes != null && ageMinutes > 0 ? `LIVE · ${ageMinutes}m ago` : 'LIVE';
    return <StatusBadge label={text} tint="green" />;
  }

  return <StatusBadge label={partial ? 'PARTIAL LIVE' : 'LIVE'} tint="green" />;
}
