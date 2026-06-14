// frontend/src/app/owner/kapster/page.tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Scissors, ChevronRight, Loader2 } from 'lucide-react';
import { BRANCHES } from '@/lib/branches';

interface Barber { id: string; name: string; branch: string }

export default function OwnerKapsterPage() {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/barbers');
      const data = await res.json();
      const list: Barber[] = Array.isArray(data) ? data : (data.barbers ?? []);
      setBarbers(list.filter(b => b && b.name));
    } catch {
      setError('Gagal memuat daftar kapster');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function enterKapster(name: string) {
    setEntering(name);
    setError('');
    try {
      const res = await fetch('/api/owner/impersonate-barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Gagal masuk sebagai kapster');
      }
      window.location.href = '/barber/home';
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal masuk');
      setEntering(null);
    }
  }

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Scissors size={16} style={{ color: '#5A4E50' }} />
        <h2 className="font-bold text-base" style={{ color: '#F0EAEB' }}>Kapster</h2>
      </div>
      <p className="text-[11px]" style={{ color: '#5A4E50' }}>
        Pilih kapster untuk masuk ke portal kapster dengan kontrol penuh.
      </p>

      {error && (
        <p className="text-xs font-medium rounded-lg px-3.5 py-2.5"
          style={{ background: 'rgba(199,40,32,0.12)', border: '1px solid rgba(199,40,32,0.25)', color: '#F07068' }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <motion.div key={i} animate={{ opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="h-12 rounded-2xl" style={{ background: '#1C1416' }} />
          ))}
        </div>
      ) : (
        BRANCHES.map(branch => {
          const group = barbers.filter(b => b.branch === branch.slug);
          if (group.length === 0) return null;
          return (
            <div key={branch.slug} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#5A4E50' }}>
                {branch.label}
              </p>
              <div className="space-y-2">
                {group.map((b, i) => (
                  <motion.button
                    key={b.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    disabled={entering !== null}
                    onClick={() => enterKapster(b.name)}
                    className="w-full flex items-center justify-between rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                    style={{ background: '#130E10', border: '1px solid #261E20' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068' }}>
                        {b.name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <p className="font-semibold text-sm" style={{ color: '#F0EAEB' }}>{b.name}</p>
                    </div>
                    {entering === b.name
                      ? <Loader2 size={16} className="animate-spin" style={{ color: '#E87068' }} />
                      : <ChevronRight size={16} style={{ color: '#4A3E40' }} />}
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
