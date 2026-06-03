'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { sendBroadcast, fetchBroadcastLog } from '@/lib/adminCrmApi';
import type { BroadcastLog } from '@/lib/adminCrmTypes';

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'baru saja';
  if (diff < 3600)  return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export default function BroadcastPage() {
  const { user } = useUser();
  const branch = user?.branch || '';
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
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
      setResult(`✅ Terkirim ke ${r.sent} kapster`);
      setMessage('');
      loadLogs();
    } catch {
      setResult('❌ Gagal mengirim');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">📣 Broadcast ke Kapster</h2>

      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 300))}
          placeholder="Tulis pengumuman untuk semua kapster cabang..."
          rows={4}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">{message.length}/300</p>
          <button
            onClick={submit}
            disabled={sending || !message.trim()}
            className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {sending ? 'Mengirim...' : 'Kirim Push Notif'}
          </button>
        </div>
        {result && <p className="text-sm text-center font-medium text-gray-700">{result}</p>}
      </div>

      {logs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Riwayat Broadcast</p>
          {logs.map(log => (
            <div key={log.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
              <p className="text-sm text-gray-800">{log.message}</p>
              <p className="text-[11px] text-gray-400 mt-1">{timeAgo(log.sent_at)} · {log.channel}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
