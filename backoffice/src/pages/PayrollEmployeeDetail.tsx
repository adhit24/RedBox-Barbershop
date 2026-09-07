import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { getEmployeeDetail, type PersonnelDetail } from '../services/crm';

const BRANCH_LABELS: Record<string, string> = {
  bypass: 'Bypass',
  csb: 'CSB',
  samadikun: 'Samadikun',
  sumber: 'Sumber',
  tegal: 'Tegal',
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'RB'
  );
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; person: PersonnelDetail; personType: 'regular' | 'barber' };

export function PayrollEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ status: 'not_found' });
      return;
    }

    getEmployeeDetail(id)
      .then((res) => {
        if (res.ok && res.person) {
          setState({ status: 'ready', person: res.person, personType: res.type });
        } else {
          setState({ status: 'not_found' });
        }
      })
      .catch((err) => {
        if (err?.status === 404 || err?.message?.includes('not found')) {
          setState({ status: 'not_found' });
        } else {
          setState({
            status: 'error',
            message: err?.message || 'Terjadi kesalahan saat memuat data payroll karyawan.',
          });
        }
      });
  }, [id]);

  if (state.status === 'loading') {
    return <LoadingState label="Memuat rincian payroll karyawan dari database..." />;
  }

  if (state.status === 'error') {
    return (
      <div className="p-4">
        <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">
          ← Kembali ke Payroll
        </Link>
        <ErrorState message={state.message} />
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="p-4">
        <Link to="/payroll" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">
          ← Kembali ke Payroll
        </Link>
        <EmptyState
          title="Data tidak ditemukan"
          description="Identifier karyawan atau kapster tidak ditemukan dalam database operasional."
        />
      </div>
    );
  }

  const { person, personType } = state;
  const isSundaze = person.business_unit.toLowerCase().includes('sundaze');
  const branchDisplay = person.branch ? (BRANCH_LABELS[person.branch.toLowerCase()] ?? person.branch) : '—';
  const backRoute = personType === 'barber' ? '/payroll/barber' : '/payroll/regular';
  const backLabel = personType === 'barber' ? '← Kembali ke Barber Payroll' : '← Kembali ke Regular Payroll';

  return (
    <>
      <Link to={backRoute} className="mb-4 inline-block text-sm font-semibold text-rb-text-muted hover:text-rb-text">
        {backLabel}
      </Link>

      {/* Header Profile */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-rb-card border border-rb-border bg-rb-surface p-5">
        <div className="flex items-center gap-3.5">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
              isSundaze
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
            }`}
          >
            {initials(person.name)}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-rb-text capitalize">{person.name}</h1>
              <span className="rounded-rb-pill bg-rb-green-tint-bg px-2 py-0.5 text-[10.5px] font-semibold text-rb-green-tint-fg">
                {person.is_active ? 'Aktif' : 'Non-Aktif'}
              </span>
            </div>
            <div className="text-xs text-rb-text-muted mt-0.5">
              {person.position} · {person.business_unit} · Cabang {branchDisplay}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-rb-pill bg-rb-divider px-3 py-1 text-xs font-semibold text-rb-text-secondary">
            Skema: {person.payroll_type}
          </span>
          <Link
            to={`/hr/employees/${person.id}`}
            className="rounded-rb-button border border-rb-border bg-rb-surface px-3 py-1.5 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
          >
            Profil HR →
          </Link>
        </div>
      </div>

      {/* Breakdown Card with Honest Unavailable States */}
      <div className="mb-6 rounded-rb-card border border-rb-border bg-rb-surface p-6">
        <div className="mb-4 flex items-center justify-between border-b border-rb-divider pb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-rb-text-muted">
            Rincian Kompensasi &amp; Komisi Periode Ini
          </div>
          <span className="rounded-rb-pill bg-rb-divider px-2.5 py-0.5 text-[11px] font-semibold text-rb-text-muted">
            Formula belum tervalidasi
          </span>
        </div>

        <div className="flex flex-col divide-y divide-rb-divider">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-semibold text-rb-text">
                {personType === 'barber' ? 'Pendapatan Layanan (Bagi Hasil)' : 'Gaji Pokok'}
              </div>
              <div className="text-xs text-rb-text-muted">
                {personType === 'barber'
                  ? 'Berdasarkan bagi hasil layanan potong & perawatan'
                  : 'Sesuai kontrak penempatan'}
              </div>
            </div>
            <div className="text-sm font-medium text-rb-text-muted italic">
              Rincian payroll periode ini belum tersedia
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-semibold text-rb-text">Komisi Produk</div>
              <div className="text-xs text-rb-text-muted">
                Penjualan pomade, vitamin, dan merchandise
              </div>
            </div>
            <div className="text-sm font-medium text-rb-text-muted italic">
              Formula belum tervalidasi
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-semibold text-rb-text">Penyesuaian Absensi / Keterlambatan</div>
              <div className="text-xs text-rb-text-muted">
                Potongan atau bonus berdasarkan kehadiran kerja
              </div>
            </div>
            <div className="text-sm font-medium text-rb-text-muted italic">
              Belum terhubung
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-semibold text-rb-text">Penyesuaian Lain / Lembur</div>
              <div className="text-xs text-rb-text-muted">
                Insentif atau adjustment manual
              </div>
            </div>
            <div className="text-sm font-medium text-rb-text-muted italic">
              Belum tersedia
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-rb-divider pt-4">
          <div>
            <div className="font-serif text-base font-semibold text-rb-text">Total Pembayaran (Net Pay)</div>
            <div className="text-xs text-rb-text-muted">
              Tidak dihitung secara artifisial sebelum formula disahkan Owner
            </div>
          </div>
          <div className="font-serif text-lg font-semibold text-rb-text-muted">
            —
          </div>
        </div>
      </div>

      <div className="rounded-rb-card border border-rb-border bg-rb-surface/60 p-4 text-xs text-rb-text-muted leading-relaxed">
        Pemberitahuan: Rincian slip gaji dan riwayat pembayaran lampau memerlukan integrasi modul penggajian internal khusus Owner dengan hak akses terbatas. Backoffice tidak mengarang data komisi atau potongan.
      </div>
    </>
  );
}
