import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

/**
 * Placeholder for every screen outside Phase 1A scope (HR, Attendance, Payroll,
 * Operations, CRM, Membership, Stockist, Moka, Reports, System). Keeps the full
 * sidebar navigable (design fidelity, spec §7) without dead links, while making
 * unbuilt scope obvious rather than silently blank. Replaced route-by-route in
 * later phases.
 */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title="Belum dibangun"
        description="Screen ini termasuk dalam desain Command Center tapi belum diimplementasikan — dijadwalkan pada phase build berikutnya."
      />
    </>
  );
}
