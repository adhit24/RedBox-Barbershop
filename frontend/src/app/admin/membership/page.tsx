'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpCircle, CalendarDays, CheckCircle2, Clock3, CreditCard, RefreshCw, Repeat2, Search, X } from 'lucide-react';

type RegistrationStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED';

interface MembershipRegistration {
  id: string;
  registrationCode: string | null;
  userKey: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  tier: string;
  amount: number;
  registrationType: 'NEW' | 'RENEWAL' | 'UPGRADE';
  sourceRegistrationId: string | null;
  status: RegistrationStatus;
  registrationStatus: string;
  pendingExpiresAt: string | null;
  startsAt: string | null;
  membershipExpiresAt: string | null;
  activationId: string | null;
  branch: string | null;
  canRenew: boolean;
  canUpgrade: boolean;
  currentTier: string;
  createdAt: string | null;
}

type MembershipChangeKind = 'RENEWAL' | 'UPGRADE';

const PAY_METHODS = [
  { value: 'cash', label: 'Cash / Tunai' },
  { value: 'qris', label: 'QRIS' },
  { value: 'transfer', label: 'Transfer' },
];

const BRANCHES = [
  { value: 'bypass', label: 'Bypass' },
  { value: 'csb', label: 'CSB' },
  { value: 'samadikun', label: 'Samadikun' },
  { value: 'sumber', label: 'Sumber' },
  { value: 'tegal', label: 'Tegal' },
  { value: 'parker', label: 'Parker' },
];

const TABS: Array<{ value: RegistrationStatus; label: string; active: string }> = [
  { value: 'PENDING', label: 'Pending', active: 'bg-amber-300 text-slate-950 border-amber-300' },
  { value: 'ACTIVE', label: 'Aktif', active: 'bg-emerald-400 text-slate-950 border-emerald-400' },
  { value: 'EXPIRED', label: 'Kedaluwarsa', active: 'bg-slate-300 text-slate-950 border-slate-300' },
];

const TIER_PRICES: Record<string, number> = { silver: 100000, gold: 250000, platinum: 1500000 };
const TIER_ORDER: Record<string, number> = { silver: 1, gold: 2, platinum: 3 };
const TIER_OPTIONS = Object.keys(TIER_PRICES);

const tierColor: Record<string, string> = {
  silver: 'text-slate-200 border-slate-500/50 bg-slate-400/10',
  gold: 'text-amber-300 border-amber-400/40 bg-amber-300/10',
  platinum: 'text-cyan-200 border-cyan-300/40 bg-cyan-300/10',
};

const fmtRp = (amount: number) => `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;

function fmtDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Skeleton() {
  return <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />;
}

function MembershipPageInner() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const defaultBranch = searchParams.get('branch') || user?.branch || '';
  const [registrations, setRegistrations] = useState<MembershipRegistration[]>([]);
  const [activeTab, setActiveTab] = useState<RegistrationStatus>('PENDING');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MembershipRegistration | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [activationBranch, setActivationBranch] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [changeSelection, setChangeSelection] = useState<{
    registration: MembershipRegistration;
    kind: MembershipChangeKind;
  } | null>(null);
  const [destinationTier, setDestinationTier] = useState('silver');
  const [changeProcessing, setChangeProcessing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);

  const notify = useCallback((message: string, ok = true) => {
    setToast({ message, ok });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const loadRegistrations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/crm/membership/registrations?status=all');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Data pendaftaran tidak dapat dimuat.');
      setRegistrations(Array.isArray(data.registrations) ? data.registrations : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Data pendaftaran tidak dapat dimuat.', false);
      setRegistrations([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadRegistrations(); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadRegistrations]);

  const visibleRegistrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return registrations.filter((registration) => {
      if (registration.status !== activeTab) return false;
      if (!query) return true;
      return [registration.fullName, registration.email, registration.phone, registration.registrationCode]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [activeTab, registrations, search]);

  const counts = useMemo(() => registrations.reduce<Record<RegistrationStatus, number>>((accumulator, registration) => {
    accumulator[registration.status] += 1;
    return accumulator;
  }, { PENDING: 0, ACTIVE: 0, EXPIRED: 0 }), [registrations]);

  function openActivation(registration: MembershipRegistration) {
    setSelected(registration);
    setPayMethod('cash');
    setPaymentReference('');
    setActivationBranch(defaultBranch);
    setPaymentConfirmed(false);
  }

  function openMembershipChange(registration: MembershipRegistration, kind: MembershipChangeKind) {
    const currentTier = registration.currentTier || registration.tier;
    const options = kind === 'UPGRADE'
      ? TIER_OPTIONS.filter((tier) => TIER_ORDER[tier] > (TIER_ORDER[currentTier] || 0))
      : TIER_OPTIONS;
    if (!options.length) return notify('Tier ini tidak memiliki tujuan upgrade yang lebih tinggi.', false);
    setDestinationTier(kind === 'RENEWAL' && options.includes(currentTier) ? currentTier : options[0]);
    setChangeSelection({ registration, kind });
  }

  async function handleMembershipChange() {
    if (!changeSelection || !destinationTier) return;
    setChangeProcessing(true);
    try {
      const response = await fetch(`/api/admin/crm/membership/registrations/${changeSelection.registration.id}/change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: destinationTier }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Pendaftaran membership lanjutan gagal.');
      notify(`${data.registrationType === 'UPGRADE' ? 'Upgrade' : 'Renewal'} ${destinationTier} dibuat Pending sebesar ${fmtRp(data.amount)}.`);
      setChangeSelection(null);
      setActiveTab('PENDING');
      await loadRegistrations();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Pendaftaran membership lanjutan gagal.', false);
    } finally {
      setChangeProcessing(false);
    }
  }

  async function handleActivate() {
    if (!selected || !paymentReference.trim() || !activationBranch || !paymentConfirmed) return;
    setProcessing(true);
    try {
      const response = await fetch(`/api/admin/crm/membership/registrations/${selected.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: payMethod,
          paymentReference: paymentReference.trim(),
          branch: activationBranch,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Aktivasi membership gagal.');
      notify(`Membership ${data.tier || selected.tier} aktif sampai ${fmtDate(data.expiresAt)}.`);
      setSelected(null);
      await loadRegistrations();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Aktivasi membership gagal.', false);
    } finally {
      setProcessing(false);
    }
  }

  async function handleSyncMoka(registration: MembershipRegistration) {
    if (!registration.phone) return notify('Nomor WhatsApp tidak tersedia.', false);
    setSyncing(registration.id);
    try {
      const response = await fetch('/api/admin/crm/membership/sync-moka', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wa: registration.phone.replace(/^\+/, '') }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Sync Moka gagal.');
      notify(`Moka tersinkron: ${data.visits} kunjungan, ${data.points} poin.`);
      await loadRegistrations();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Sync Moka gagal.', false);
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#020617] pb-24 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-[#020617]/95 px-4 pb-3 pt-4 backdrop-blur-md">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><CreditCard size={19} className="text-amber-300" /><div><h1 className="text-base font-bold text-white">Membership Berbayar</h1><p className="text-[11px] text-slate-500">Verifikasi pembayaran dan aktivasi kasir</p></div></div>
            <button onClick={() => void loadRegistrations()} disabled={loading} className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-50" aria-label="Muat ulang data"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {TABS.map((tab) => <button key={tab.value} onClick={() => setActiveTab(tab.value)} className={`rounded-xl border px-2 py-2 text-center transition ${activeTab === tab.value ? tab.active : 'border-slate-800 bg-slate-900 text-slate-400'}`}><span className="block text-lg font-bold">{counts[tab.value]}</span><span className="block text-[10px] font-semibold uppercase tracking-wide">{tab.label}</span></button>)}
          </div>
          <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari kode, nama, email, atau WhatsApp..." className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-slate-600" /></div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-3 px-4 pt-4">
        {loading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} />) : visibleRegistrations.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">Tidak ada pendaftaran pada status ini.</div> : visibleRegistrations.map((registration) => {
          const active = registration.status === 'ACTIVE';
          const pending = registration.status === 'PENDING';
          const deadline = pending
            ? registration.pendingExpiresAt
            : registration.membershipExpiresAt || registration.pendingExpiresAt;
          return <motion.article key={registration.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-start gap-3">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-bold ${tierColor[registration.tier] || 'border-slate-600 bg-slate-800 text-slate-200'}`}>{(registration.fullName || '?').slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold text-white">{registration.fullName || '—'}</h2><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${tierColor[registration.tier] || 'border-slate-600 text-slate-300'}`}>{registration.tier}</span></div><p className="mt-1 truncate font-mono text-[11px] text-slate-400">{registration.registrationCode || registration.id}</p><p className="mt-1 truncate text-xs text-slate-500">{registration.phone || registration.email || 'Kontak tidak tersedia'}</p><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"><span className="font-bold text-white">{fmtRp(registration.amount)}</span><span className="inline-flex items-center gap-1 text-slate-500">{active ? <CalendarDays size={12} /> : <Clock3 size={12} />}{active ? `Berakhir ${fmtDate(deadline)}` : pending ? `Bayar sebelum ${fmtDate(deadline)}` : `Kedaluwarsa ${fmtDate(deadline)}`}</span></div></div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${pending ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : active ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-600 bg-slate-800 text-slate-400'}`}>{pending ? 'Pending' : active ? 'Aktif' : 'Kedaluwarsa'}</span>
                {pending && <button onClick={() => openActivation(registration)} className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400 hover:text-slate-950">Aktifkan</button>}
                {registration.canUpgrade && <button onClick={() => openMembershipChange(registration, 'UPGRADE')} className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 transition hover:bg-cyan-300 hover:text-slate-950"><ArrowUpCircle size={11} />Upgrade</button>}
                {registration.canRenew && <button onClick={() => openMembershipChange(registration, 'RENEWAL')} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200 transition hover:bg-amber-300 hover:text-slate-950"><Repeat2 size={11} />Perpanjang</button>}
                {active && <button onClick={() => void handleSyncMoka(registration)} disabled={syncing === registration.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-50"><RefreshCw size={10} className={syncing === registration.id ? 'animate-spin' : ''} />{syncing === registration.id ? 'Sync…' : 'Sync Moka'}</button>}
              </div>
            </div>
          </motion.article>;
        })}
      </main>

      <AnimatePresence>{selected && <><motion.button aria-label="Tutup aktivasi" onClick={() => !processing && setSelected(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 cursor-default bg-black/70" /><motion.section role="dialog" aria-modal="true" aria-labelledby="activationTitle" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-2xl rounded-t-3xl border-t border-slate-700 bg-[#0f172a] p-5 shadow-2xl"><div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" /><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-300">Konfirmasi kasir</p><h2 id="activationTitle" className="mt-1 text-base font-bold text-white">Aktifkan {selected.fullName || 'member'}</h2></div><button onClick={() => !processing && setSelected(null)} className="rounded-lg p-1 text-slate-400 hover:text-white" aria-label="Tutup"><X size={20} /></button></div><div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/70 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tier dan nominal tersimpan</p><div className="mt-2 grid grid-cols-2 gap-3"><div><p className={`text-sm font-bold uppercase ${tierColor[selected.tier]?.split(' ')[0] || 'text-white'}`}>{selected.tier}</p><p className="font-mono text-[11px] text-slate-500">{selected.registrationCode}</p></div><input aria-label="Nominal membership tersimpan" readOnly value={fmtRp(selected.amount)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-right text-sm font-bold text-white outline-none" /></div></div><div className="mb-4 grid grid-cols-3 gap-2">{PAY_METHODS.map((method) => <button key={method.value} onClick={() => setPayMethod(method.value)} className={`rounded-xl border px-1 py-2.5 text-xs font-semibold transition ${payMethod === method.value ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{method.label}</button>)}</div><div className="mb-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-400">Cabang<select value={activationBranch} onChange={(event) => setActivationBranch(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400"><option value="">Pilih cabang</option>{BRANCHES.map((branch) => <option key={branch.value} value={branch.value}>{branch.label}</option>)}</select></label><div><p className="text-xs font-semibold text-slate-400">Sesi staff</p><p className="mt-2 truncate rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-300">{user?.name || user?.email || 'Memuat staff…'}</p></div></div><label className="block text-xs font-semibold text-slate-400">Referensi pembayaran<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="No. struk / referensi transaksi" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400" /></label><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-xs leading-relaxed text-slate-300"><input type="checkbox" checked={paymentConfirmed} onChange={(event) => setPaymentConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-400" /><span>Saya sudah menerima dan memverifikasi pembayaran sesuai tier serta nominal tersimpan di atas.</span></label><button onClick={() => void handleActivate()} disabled={processing || !paymentReference.trim() || !activationBranch || !paymentConfirmed} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"><CheckCircle2 size={17} />{processing ? 'Menyimpan aktivasi…' : 'Konfirmasi Pembayaran & Aktifkan'}</button></motion.section></>}</AnimatePresence>

      <AnimatePresence>{changeSelection && <><motion.button aria-label="Tutup perubahan membership" onClick={() => !changeProcessing && setChangeSelection(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 cursor-default bg-black/70" /><motion.section role="dialog" aria-modal="true" aria-labelledby="membershipChangeTitle" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-2xl rounded-t-3xl border-t border-slate-700 bg-[#0f172a] p-5 shadow-2xl"><div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" /><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-cyan-300">{changeSelection.kind === 'UPGRADE' ? 'Upgrade berbayar' : 'Renewal berbayar'}</p><h2 id="membershipChangeTitle" className="mt-1 text-base font-bold text-white">{changeSelection.registration.fullName || 'Member'}</h2></div><button onClick={() => !changeProcessing && setChangeSelection(null)} className="rounded-lg p-1 text-slate-400 hover:text-white" aria-label="Tutup"><X size={20} /></button></div><p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100">Pilih tier tujuan. Sistem membuat pendaftaran Pending dengan harga penuh tier tujuan. Membership baru aktif setelah pembayaran dikonfirmasi kasir dan berlaku satu tahun dari aktivasi.</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{TIER_OPTIONS.filter((tier) => changeSelection.kind === 'RENEWAL' || TIER_ORDER[tier] > (TIER_ORDER[changeSelection.registration.currentTier || changeSelection.registration.tier] || 0)).map((tier) => <button key={tier} onClick={() => setDestinationTier(tier)} className={`rounded-xl border p-3 text-left transition ${destinationTier === tier ? 'border-cyan-300 bg-cyan-300/15' : 'border-slate-700 bg-slate-800'}`}><span className={`block text-xs font-bold uppercase ${tierColor[tier]?.split(' ')[0] || 'text-white'}`}>{tier}</span><span className="mt-1 block text-sm font-bold text-white">{fmtRp(TIER_PRICES[tier])}</span></button>)}</div><div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/70 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Nominal penuh tersimpan</p><input aria-label="Nominal penuh tier tujuan" readOnly value={fmtRp(TIER_PRICES[destinationTier])} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-right text-sm font-bold text-white outline-none" /></div><button onClick={() => void handleMembershipChange()} disabled={changeProcessing || !destinationTier} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45">{changeSelection.kind === 'UPGRADE' ? <ArrowUpCircle size={17} /> : <Repeat2 size={17} />}{changeProcessing ? 'Membuat pendaftaran…' : `Buat Pending ${changeSelection.kind === 'UPGRADE' ? 'Upgrade' : 'Renewal'}`}</button></motion.section></>}</AnimatePresence>

      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} className={`fixed bottom-5 left-4 right-4 z-[60] mx-auto max-w-md rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${toast.ok ? 'border-emerald-400/40 bg-emerald-950 text-emerald-100' : 'border-red-400/40 bg-red-950 text-red-100'}`}>{toast.message}</motion.div>}</AnimatePresence>
    </div>
  );
}

export default function MembershipPage() {
  return <Suspense fallback={<div className="min-h-screen bg-[#020617]" />}><MembershipPageInner /></Suspense>;
}
