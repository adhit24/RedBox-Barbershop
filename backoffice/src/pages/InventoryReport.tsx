import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

export function InventoryReport() {
  return (
    <>
      <Link to="/reports" className="mb-2.5 inline-block text-sm font-semibold text-rb-text-muted">← Reports</Link>
      <PageHeader
        title="Inventory Report"
        subtitle="Ringkasan stok dan pergerakan inventory antar cabang"
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
        description="Data Stockist belum bisa diakses dari Backoffice — kendala akses backend (auth), bukan data kosong. Stockist tetap menjadi source of truth untuk inventory operasional; Backoffice hanya membaca dan merangkum, tidak membuat flow input stok baru. stockist.redboxbarbershop.com tetap menjadi sumber kebenaran operasional inventory."
      />
    </>
  );
}
