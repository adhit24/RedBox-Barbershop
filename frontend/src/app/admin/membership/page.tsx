'use client';
import { useEffect, useState, Suspense } from 'react';
import { useUser } from '@/hooks/useUser';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, CheckCircle, Clock, Search, X, CreditCard } from 'lucide-react';

interface Member {
  user_key: string;
  full_name: string;
  email: string;
  membership_status: string;
  current_tier: string;
  total_points: number;
  total_visits: number;
  created_at: string;
}

const PAY_METHODS = [
  { value: 'cash',     label: 'Cash / Tunai' },
  { value: 'qris',     label: 'QRIS' },
  { value: 'transfer', label: 'Transfer Bank' },
];

function Skeleton() {
  return (
    <motion.div
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 1.4, repeat: Infinity }}
      className="h-16 bg-slate-800 rounded-xl"
    />
  );
}

function MembershipPageInner() {
  const { user } = useUser();
  const branch = user?.branch || '';

  const [members, setMembers]     = useState<Member[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState<'all' | 'inactive' | 'active'>('inactive');
  const [activating, setActivating] = useState<string | null>(null);
  const [payMethod, setPayMethod]   = useState('cash');
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]           = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/crm/membership');
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleActivate() {
    if (!activating) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/admin/crm/membership/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey: activating, branch, payMethod }),
      });
      const data = await res.json();
      if (data.success) {
        setToast('✓ Membership berhasil diaktifkan!');
        setActivating(null);
        await load();
      } else {
        setToast('Gagal mengaktifkan. Coba lagi.');
      }
    } finally {
      setProcessing(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  const filtered = members.filter(m => {
    const matchSearch = !search ||
      m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'inactive' ? m.membership_status !== 'ACTIVE' :
                              m.membership_status === 'ACTIVE';
    return matchSearch && matchFilter;
  });

  const totalActive   = members.filter(m => m.membership_status === 'ACTIVE').length;
  const totalInactive = members.filter(m => m.membership_status !== 'ACTIVE').length;

  const activatingMember = members.find(m => m.user_key === activating);

  return (
    <div className="min-h-screen bg-[#020617] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#020617]/95 backdrop-blur-md border-b border-slate-800 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={18} className="text-green-400" />
          <h1 className="text-white font-bold text-base">Aktivasi Member</h1>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <p className="text-green-400 font-bold text-xl">{totalActive}</p>
            <p className="text-slate-500 text-xs">Aktif</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
            <p className="text-orange-400 font-bold text-xl">{totalInactive}</p>
            <p className="text-slate-500 text-xs">Belum Aktif</p>
          </div>
        </div>
        {/* Search */}
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Cari nama atau email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-slate-600"
          />
        </div>
        {/* Filter tabs */}
        <div className="flex gap-2">
          {(['inactive', 'active', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                filter === f
                  ? 'bg-green-400 text-slate-900'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {f === 'inactive' ? 'Belum Aktif' : f === 'active' ? 'Aktif' : 'Semua'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 pt-3 flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-500 py-16 text-sm">Tidak ada member ditemukan</div>
        ) : filtered.map(m => {
          const isActive = m.membership_status === 'ACTIVE';
          const join = new Date(m.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
          return (
            <motion.div
              key={m.user_key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#0F172A] border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
                {(m.full_name || m.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate">{m.full_name || '—'}</p>
                <p className="text-slate-500 text-xs truncate">{m.email}</p>
                <p className="text-slate-600 text-[10px] mt-0.5">Bergabung {join}</p>
              </div>
              {isActive ? (
                <span className="text-green-400 text-[10px] font-bold bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5 shrink-0">
                  ✓ Aktif
                </span>
              ) : (
                <button
                  onClick={() => { setActivating(m.user_key); setPayMethod('cash'); }}
                  className="bg-green-400/15 border border-green-400/40 text-green-400 text-xs font-bold rounded-xl px-3 py-1.5 shrink-0 active:scale-95 transition-transform"
                >
                  Aktifkan
                </button>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Bottom sheet: konfirmasi aktivasi */}
      <AnimatePresence>
        {activating && activatingMember && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-40"
              onClick={() => !processing && setActivating(null)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-[#0F172A] border-t border-slate-700 rounded-t-2xl p-5"
            >
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-base">Aktifkan Member</h2>
                <button onClick={() => !processing && setActivating(null)}>
                  <X size={20} className="text-slate-400" />
                </button>
              </div>

              <div className="bg-slate-800/50 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {(activatingMember.full_name || activatingMember.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{activatingMember.full_name || '—'}</p>
                  <p className="text-slate-400 text-xs">{activatingMember.email}</p>
                </div>
              </div>

              <p className="text-slate-400 text-xs font-semibold mb-2 uppercase tracking-wide">Metode Bayar</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {PAY_METHODS.map(pm => (
                  <button
                    key={pm.value}
                    onClick={() => setPayMethod(pm.value)}
                    className={`rounded-xl py-2.5 text-sm font-semibold border transition-all ${
                      payMethod === pm.value
                        ? 'bg-green-400 text-slate-900 border-green-400'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleActivate}
                disabled={processing}
                className="w-full bg-green-400 text-slate-900 font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 active:scale-[.98] transition-transform disabled:opacity-60"
              >
                <CheckCircle size={16} />
                {processing ? 'Memproses...' : 'Aktifkan — Rp 100.000'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-4 right-4 z-50 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm font-medium text-center shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MembershipPage() {
  return (
    <Suspense>
      <MembershipPageInner />
    </Suspense>
  );
}
