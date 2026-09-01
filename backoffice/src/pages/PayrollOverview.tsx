import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { DemoBadge } from '../components/DemoBadge';

export function PayrollOverview() {
  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Data contoh — belum ada tabel payroll produksi"
        actions={<DemoBadge />}
      />
      <section className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard value={70} label="Total Karyawan (contoh)" tint="blue" />
        <Link to="/payroll/regular" className="block no-underline">
          <StatCard value={38} label="Fixed Salary →" tint="purple" />
        </Link>
        <Link to="/payroll/barber" className="block no-underline">
          <StatCard value={32} label="Revenue Sharing →" tint="orange" />
        </Link>
        <StatCard value={4} label="Pending Review (contoh)" tint="yellow" />
        <StatCard value={2} label="Need Adjustment (contoh)" tint="red" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link to="/payroll/regular" className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-purple-tint-bg text-rb-purple-tint-fg">R</div>
          <div className="mb-1.5 text-[15px] font-semibold text-rb-text">Regular Payroll — Fixed Salary</div>
          <p className="text-sm leading-relaxed text-rb-text-muted">Cashier, barista, admin, manager, dan staf operasional lainnya. Basic salary + allowance + overtime − deduction.</p>
          <div className="mt-3.5 text-xs font-semibold text-rb-red">Lihat 38 karyawan →</div>
        </Link>
        <Link to="/payroll/barber" className="block rounded-rb-card border border-rb-border bg-rb-surface p-5.5 no-underline">
          <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-rb-orange-tint-bg text-rb-orange-tint-fg">B</div>
          <div className="mb-1.5 text-[15px] font-semibold text-rb-text">Barber Payroll — Revenue Sharing</div>
          <p className="text-sm leading-relaxed text-rb-text-muted">32 barber dengan skema komisi layanan &amp; revenue sharing (contoh). Komisi mengikuti identitas barber, bukan cabang.</p>
          <div className="mt-3.5 text-xs font-semibold text-rb-red">Lihat 32 barber →</div>
        </Link>
      </div>
    </>
  );
}
