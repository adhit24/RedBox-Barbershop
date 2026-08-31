import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

/**
 * Foundation shell for Phase 1A. Real KPI/data wiring against
 * GET /api/admin/crm/command-center (and owner-overview / owner-revenue) is
 * Phase 1B — intentionally not built here (spec §9, Phase 1B).
 */
export function CommandCenter() {
  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={new Date().toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />
      <EmptyState
        title="Data KPI belum terhubung"
        description="Foundation layer (login, sidebar, routing) sudah siap. Wiring data real ke /api/admin/crm/command-center dilakukan di Phase 1B."
      />
    </>
  );
}
