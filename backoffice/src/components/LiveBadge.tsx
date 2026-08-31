import { StatusBadge } from './StatusBadge';

/** Marks a module wired to real production data (spec §5). */
export function LiveBadge({ partial = false }: { partial?: boolean }) {
  return <StatusBadge label={partial ? 'PARTIAL LIVE' : 'LIVE'} tint="green" />;
}
