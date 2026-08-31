import { StatusBadge } from './StatusBadge';

/** Marks a module backed by mock data — no production table exists yet (spec §5). */
export function DemoBadge() {
  return <StatusBadge label="DEMO — awaiting production database" tint="orange" />;
}
