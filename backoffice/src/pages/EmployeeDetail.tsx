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

function formatDate(iso: string | null) {
  if (!iso) return 'Belum tersedia';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Belum tersedia';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return 'Belum tersedia';
  }
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; person: PersonnelDetail; personType: 'regular' | 'barber' };

export function EmployeeDetail() {
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
            message: err?.message || 'Terjadi kesalahan saat memuat data karyawan.',
          });
        }
      });
  }, [id]);

  if (state.status === 'loading') {
    return <LoadingState label="Memuat profil karyawan dari database..." />;
  }

  if (state.status === 'error') {
    return (
      <div className="p-4">
        <Link to="/hr" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">
          ← Kembali ke HR &amp; People
        </Link>
        <ErrorState message={state.message} />
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="p-4">
        <Link to="/hr" className="mb-4 inline-block text-sm font-semibold text-rb-text-muted">
          ← Kembali ke HR &amp; People
        </Link>
        <EmptyState
          title="Karyawan tidak ditemukan"
          description="Data karyawan atau kapster dengan identifier tersebut tidak ditemukan di database Supabase."
        />
      </div>
    );
  }

  const { person, personType } = state;
  const isSundaze = person.business_unit.toLowerCase().includes('sundaze');
  const branchDisplay = person.branch ? (BRANCH_LABELS[person.branch.toLowerCase()] ?? person.branch) : '—';

  const fields = [
    { label: 'Kode / ID', value: person.code },
    { label: 'Tipe Karyawan', value: personType === 'barber' ? 'Kapster (Barber)' : 'Karyawan Reguler' },
    { label: 'Unit Bisnis', value: person.business_unit },
    { label: 'Cabang Penempatan', value: branchDisplay },
    { label: 'Posisi / Peran', value: person.position || '—' },
    { label: 'Tipe Payroll', value: person.payroll_type },
    { label: 'Tanggal Bergabung', value: formatDate(person.join_date) },
    { label: 'Status Kepegawaian', value: person.is_active ? 'Aktif' : 'Tidak Aktif' },
  ];

  return (
    <>
      <div className="mb-4 text-sm text-rb-text-muted">
        <Link to="/hr" className="font-medium text-rb-text-muted hover:text-rb-text">
          HR &amp; People
        </Link>
        <span className="mx-1.5">›</span>
        <span className="font-semibold text-rb-text">{person.name}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        {/* Profile Card */}
        <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <span
              className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold ${
                isSundaze
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'bg-rb-red-tint-bg text-rb-red-tint-fg'
              }`}
            >
              {initials(person.name)}
            </span>
            <span className="rounded-rb-pill bg-rb-green-tint-bg px-2.5 py-1 text-xs font-semibold text-rb-green-tint-fg">
              {person.is_active ? 'Aktif' : 'Non-Aktif'}
            </span>
          </div>

          <h1 className="font-serif text-xl font-semibold capitalize text-rb-text">
            {person.name}
          </h1>
          {person.nickname && (
            <div className="text-xs text-rb-text-muted font-medium">
              Panggilan: {person.nickname}
            </div>
          )}
          <div className="mt-1 mb-3 text-xs text-rb-text-muted">
            {person.position} · {person.business_unit}
          </div>

          <div className="my-4 h-px bg-rb-divider" />

          <div className="flex flex-col gap-2.5 text-sm">
            {fields.map((f) => (
              <div key={f.label} className="flex items-center justify-between gap-2">
                <span className="text-rb-text-muted">{f.label}</span>
                <span className="font-semibold text-rb-text text-right">{f.value}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-rb-divider">
            <Link
              to={`/payroll/employees/${person.id}`}
              className="inline-flex w-full items-center justify-center rounded-rb-button border border-rb-border bg-rb-surface px-4 py-2 text-xs font-semibold text-rb-text hover:bg-rb-surface-hover"
            >
              Lihat Status Payroll →
            </Link>
          </div>
        </div>

        {/* Operational / Performance Sections */}
        <div className="flex flex-col gap-4">
          {/* Performance & Services */}
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-rb-text">
                Ringkasan Performa &amp; Layanan
              </h2>
              <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-muted">
                Belum tersedia
              </span>
            </div>
            <EmptyState
              title="Data performa belum terhubung"
              description="Metrik performa individual (jumlah customer dilayani, rating, dan repeat rate) belum terhubung secara personal ke akun ini."
            />
          </div>

          {/* Attendance History */}
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-rb-text">
                Riwayat Kehadiran
              </h2>
              <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-muted">
                Belum tersedia
              </span>
            </div>
            <EmptyState
              title="Data absensi belum terhubung"
              description={
                personType === 'barber'
                  ? 'Histori absensi harian tercatat di modul Command Center per cabang. Rekap absensi bulanan belum terintegrasi.'
                  : 'Data fingerprint mesin absen belum terhubung ke sistem Backoffice.'
              }
            />
          </div>

          {/* Branch History */}
          <div className="rounded-rb-card border border-rb-border bg-rb-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-rb-text">
                Riwayat Penempatan Cabang
              </h2>
              <span className="rounded-rb-pill bg-rb-divider px-2 py-0.5 text-[10.5px] font-semibold text-rb-text-muted">
                Belum tersedia
              </span>
            </div>
            <EmptyState
              title="Riwayat mutasi belum dicatat"
              description="Histori perpindahan penempatan cabang antar waktu belum dicatat dalam database operasional."
            />
          </div>
        </div>
      </div>
    </>
  );
}
