'use client';
import { useEffect, useState, useCallback } from 'react';
import { useUser } from '@/hooks/useUser';
import { reassignBooking, createWalkIn } from '@/lib/adminCrmApi';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Check, UserX, Shuffle, Home, ChevronRight } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  pending:     { label: 'Pending',    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',    dot: 'bg-amber-400' },
  confirmed:   { label: 'Confirmed', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',       dot: 'bg-blue-400' },
  done:        { label: 'Selesai',   color: 'bg-green-500/15 text-green-400 border-green-500/30',    dot: 'bg-green-400' },
  cancelled:   { label: 'Batal',     color: 'bg-red-500/15 text-red-400 border-red-500/30',          dot: 'bg-red-400' },
  no_show:     { label: 'No-show',   color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',    dot: 'bg-slate-400' },
  departed:    { label: 'Berangkat', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', dot: 'bg-indigo-400' },
  arrived:     { label: 'Tiba',      color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',       dot: 'bg-cyan-400' },
  in_progress: { label: 'Dikerjakan',color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const STATUS_FILTERS = ['all','pending','confirmed','done','cancelled','no_show'];
const TYPE_FILTERS   = ['all','online','home_service','wedding','walk_in'];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BookingControlPage() {
  const { user } = useUser();
  const branch = user?.branch || '';

  const [bookings, setBookings]           = useState<any[]>([]);
  const [barbers, setBarbers]             = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
  const [dateFilter, setDateFilter]       = useState(today());
  const [statusFilter, setStatusFilter]   = useState('all');
  const [typeFilter, setTypeFilter]       = useState('all');
  const [walkinOpen, setWalkinOpen]       = useState(false);
  const [walkinData, setWalkinData]       = useState({ name:'', wa:'', barber_id:'', service:'' });
  const [reassignId, setReassignId]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    const params = new URLSearchParams({ location: branch, date: dateFilter });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const [bkRes, brRes] = await Promise.all([
      fetch(`/api/bookings?${params}`).then(r => r.json()),
      fetch(`/api/admin/barbers?branch=${branch}`).then(r => r.json()),
    ]);
    let bks = bkRes.bookings || bkRes || [];
    if (typeFilter === 'home_service') bks = bks.filter((b: any) => (b.notes||'').toUpperCase().includes('HOME SERVICE'));
    else if (typeFilter === 'wedding') bks = bks.filter((b: any) => (b.notes||'').toUpperCase().includes('WEDDING'));
    else if (typeFilter === 'walk_in')  bks = bks.filter((b: any) => (b.notes||'').toUpperCase().includes('WALK-IN'));
    else if (typeFilter === 'online')   bks = bks.filter((b: any) => !['HOME SERVICE','WEDDING','WALK-IN'].some(t => (b.notes||'').toUpperCase().includes(t)));
    setBookings(bks.sort((a: any, b: any) => a.time.localeCompare(b.time)));
    setBarbers(brRes.barbers || brRes || []);
  }, [branch, dateFilter, statusFilter, typeFilter]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function updateStatus(id: string, status: string) {
    await fetch('/api/admin/booking-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  async function doReassign(barber_id: string) {
    if (!reassignId) return;
    await reassignBooking(reassignId, barber_id);
    setReassignId(null);
    load();
  }

  async function submitWalkIn() {
    if (!walkinData.barber_id || !walkinData.service) return;
    await createWalkIn({ ...walkinData, branch });
    setWalkinOpen(false);
    setWalkinData({ name:'', wa:'', barber_id:'', service:'' });
    load();
  }

  const isHS = (b: any) => (b.notes||'').toUpperCase().includes('HOME SERVICE') || (b.notes||'').toUpperCase().includes('WEDDING');
  const branchBarbers = barbers.filter((b: any) => b.branch === branch && b.is_active);

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold text-base">Booking Control</h2>
        <button
          onClick={() => setWalkinOpen(true)}
          className="flex items-center gap-1.5 h-9 px-3 bg-green-500/15 text-green-400 border border-green-500/30 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
        >
          <Plus size={14} />
          Walk-in
        </button>
      </div>

      {/* Date */}
      <input
        type="date" value={dateFilter}
        onChange={e => setDateFilter(e.target.value)}
        className="w-full h-10 bg-[#0F172A] border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500"
      />

      {/* Status filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`flex-shrink-0 h-7 px-3 rounded-full text-xs font-medium border transition-all cursor-pointer ${
              statusFilter === s
                ? 'bg-white text-slate-900 border-white'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}>
            {s === 'all' ? 'Semua' : s}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {TYPE_FILTERS.map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`flex-shrink-0 h-7 px-3 rounded-full text-xs font-medium border transition-all cursor-pointer ${
              typeFilter === t
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : 'bg-slate-800/60 text-slate-400 border-slate-700'
            }`}>
            {t === 'all' ? 'Semua' : t.replace('_',' ')}
          </button>
        ))}
      </div>

      {/* Booking list */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <motion.div key={i} animate={{ opacity: [0.4,0.7,0.4] }} transition={{ duration:1.4, repeat:Infinity, delay: i*0.2 }}
              className="h-20 bg-slate-800 rounded-2xl" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-10">Tidak ada booking</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((bk: any, i: number) => (
            <motion.div key={bk.id}
              initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
              transition={{ delay: i*0.04, duration:0.2 }}
              className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-white text-sm truncate">{bk.name}</p>
                    {isHS(bk) && <Home size={12} className="text-purple-400 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{bk.time} · {bk.service}</p>
                  {bk.wa && bk.wa !== '-' && <p className="text-xs text-slate-600">{bk.wa}</p>}
                </div>
                <StatusBadge status={bk.status} />
              </div>

              {/* Actions */}
              <div className="flex gap-1.5 flex-wrap">
                {bk.status === 'pending' && <>
                  <ActionBtn color="green" icon={<Check size={12}/>} label="Konfirmasi"   onClick={() => updateStatus(bk.id,'confirmed')} />
                  <ActionBtn color="red"   icon={<X size={12}/>}     label="Batalkan"     onClick={() => updateStatus(bk.id,'cancelled')} />
                  <ActionBtn color="slate" icon={<Shuffle size={12}/>} label="Reassign"   onClick={() => setReassignId(bk.id)} />
                </>}
                {bk.status === 'confirmed' && <>
                  <ActionBtn color="green" icon={<Check size={12}/>}  label="Done"        onClick={() => updateStatus(bk.id,'done')} />
                  <ActionBtn color="slate" icon={<UserX size={12}/>}  label="No-show"     onClick={() => updateStatus(bk.id,'no_show')} />
                  <ActionBtn color="red"   icon={<X size={12}/>}      label="Batalkan"    onClick={() => updateStatus(bk.id,'cancelled')} />
                  {isHS(bk) && <ActionBtn color="indigo" icon={<ChevronRight size={12}/>} label="Berangkat" onClick={() => updateStatus(bk.id,'departed')} />}
                </>}
                {bk.status === 'departed'    && <ActionBtn color="cyan"   icon={<ChevronRight size={12}/>} label="Sampai"      onClick={() => updateStatus(bk.id,'arrived')} />}
                {bk.status === 'arrived'     && <ActionBtn color="purple" icon={<ChevronRight size={12}/>} label="Dikerjakan"  onClick={() => updateStatus(bk.id,'in_progress')} />}
                {bk.status === 'in_progress' && <ActionBtn color="green"  icon={<Check size={12}/>}        label="Selesai"     onClick={() => updateStatus(bk.id,'done')} />}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Walk-in Bottom Sheet */}
      <AnimatePresence>
        {walkinOpen && (
          <Sheet onClose={() => setWalkinOpen(false)} title="Walk-in Customer">
            <Input placeholder="Nama (opsional)" value={walkinData.name}
              onChange={e => setWalkinData(d => ({ ...d, name: e.target.value }))} />
            <Input placeholder="No HP (opsional)" value={walkinData.wa}
              onChange={e => setWalkinData(d => ({ ...d, wa: e.target.value }))} />
            <select value={walkinData.barber_id}
              onChange={e => setWalkinData(d => ({ ...d, barber_id: e.target.value }))}
              className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 focus:outline-none focus:border-slate-500">
              <option value="">Pilih Kapster</option>
              {branchBarbers.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Input placeholder="Service (contoh: Potong Rambut)" value={walkinData.service}
              onChange={e => setWalkinData(d => ({ ...d, service: e.target.value }))} />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setWalkinOpen(false)}
                className="flex-1 h-11 border border-slate-700 rounded-xl text-sm text-slate-400 cursor-pointer active:scale-95 transition-all">
                Batal
              </button>
              <button onClick={submitWalkIn}
                className="flex-1 h-11 bg-green-500 text-white rounded-xl text-sm font-semibold cursor-pointer active:scale-95 transition-all">
                Catat
              </button>
            </div>
          </Sheet>
        )}
      </AnimatePresence>

      {/* Reassign Bottom Sheet */}
      <AnimatePresence>
        {reassignId && (
          <Sheet onClose={() => setReassignId(null)} title="Pilih Kapster Pengganti">
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {branchBarbers.map((b: any) => (
                <button key={b.id} onClick={() => doReassign(b.id)}
                  className="w-full h-11 text-left px-4 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium text-slate-200 cursor-pointer active:scale-[0.98] transition-all">
                  {b.name}
                </button>
              ))}
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

type BtnColor = 'green' | 'red' | 'slate' | 'indigo' | 'cyan' | 'purple';

const BTN_COLORS: Record<BtnColor, string> = {
  green:  'bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/25',
  red:    'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25',
  slate:  'bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700',
  indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/25',
  cyan:   'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/25',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25',
};

function ActionBtn({ color, icon, label, onClick }: { color: BtnColor; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium border cursor-pointer active:scale-95 transition-all ${BTN_COLORS[color]}`}>
      {icon}{label}
    </button>
  );
}

function Input({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <input placeholder={placeholder} value={value} onChange={onChange}
      className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500" />
  );
}

function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 bg-black/70 z-50 flex items-end backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80 }} animate={{ y:0 }} exit={{ y: 80 }}
        transition={{ type:'spring', stiffness:400, damping:35 }}
        className="bg-[#0F172A] border-t border-slate-700 rounded-t-2xl w-full p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-white text-sm">{title}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
