'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { sendBroadcast, fetchBroadcastLog } from '@/lib/adminCrmApi';
import type { BroadcastLog } from '@/lib/adminCrmTypes';
import { motion, AnimatePresence } from 'framer-motion';
import { Megaphone, Send, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'baru saja';
  if (diff < 3600)  return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

function BroadcastPageInner() {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const readonly = searchParams.get('readonly') === 'true';
  const branch = user?.branch || '';
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [logs, setLogs] = useState<BroadcastLog[]>([]);

  const loadLogs = async () => {
    if (!branch) return;
    const r = await fetchBroadcastLog(branch).catch(() => null);
    if (r) setLogs(r.logs);
  };

  useEffect(() => {
    loadLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  async function submit() {
    if (!message.trim() || !branch) return;
    setSending(true);
    setResult(null);
    try {
      const r = await sendBroadcast(branch, message.trim());
      setResult({ ok: true, text: `Terkirim ke ${r.sent} kapster` });
      setMessage('');
      loadLogs();
    } catch {
      setResult({ ok: false, text: 'Gagal mengirim, coba lagi' });
    } finally {
      setSending(false);
    }
  }

  const remaining = 300 - message.length;

  return (
    <div className="p-4 space-y-4 pb-6">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Megaphone size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Broadcast ke Kapster</h2>
      </div>

      {/* Compose */}
      {readonly ? (
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3 text-center">
          <p className="text-slate-500 text-sm">Mode read-only — tidak bisa kirim broadcast</p>
        </div>
      ) : (
      <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-4 space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 300))}
          placeholder="Tulis pengumuman untuk semua kapster cabang..."
          rows={4}
          className="w-full bg-transparent text-slate-200 placeholder-slate-600 text-sm resize-none focus:outline-none leading-relaxed"
        />

        <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
          <p className={`text-xs tabular-nums ${remaining < 30 ? 'text-amber-400' : 'text-slate-600'}`}>
            {remaining} karakter tersisa
          </p>
          <button
            onClick={submit}
            disabled={sending || !message.trim()}
            className="flex items-center gap-2 bg-green-500/15 text-green-400 border border-green-500/30 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-green-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Send size={13} />
                </motion.div>
                Mengirim...
              </>
            ) : (
              <>
                <Send size={13} />
                Kirim Push Notif
              </>
            )}
          </button>
        </div>

        {/* Result feedback */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
                result.ok
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              {result.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
              {result.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}

      {/* Broadcast Log */}
      {logs.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-slate-500" />
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Riwayat</p>
          </div>
          {logs.map((log, i) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-[#0F172A] border border-slate-800 rounded-2xl px-4 py-3"
            >
              <p className="text-sm text-slate-200 leading-relaxed">{log.message}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">{timeAgo(log.sent_at)} · {log.channel}</p>
            </motion.div>
          ))}
        </section>
      )}
    </div>
  );
}

export default function BroadcastPage() {
  return <Suspense><BroadcastPageInner /></Suspense>;
}
