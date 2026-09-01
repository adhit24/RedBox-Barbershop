import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

export function StockistDashboard() {
  return (
    <>
      <PageHeader
        title="Stockist & Inventory"
        subtitle="Monitoring & analitik — pekerjaan operasional detail ada di aplikasi Stockist"
        actions={
          <a
            href="https://stockist.redboxbarbershop.com"
            target="_blank"
            rel="noreferrer"
            className="rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-sm font-semibold text-rb-text-secondary"
          >
            Open Stockist Application ↗
          </a>
        }
      />
      <EmptyState
        title="UNAVAILABLE"
        description="Data Stockist belum bisa diakses dari Backoffice — kendala akses backend (auth), bukan data kosong. stockist.redboxbarbershop.com tetap menjadi sumber kebenaran operasional inventory."
      />
    </>
  );
}
