// frontend/src/app/owner/branches/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Building2, ChevronRight } from 'lucide-react';
import { BRANCHES } from '@/lib/branches';

export default function OwnerBranchesPage() {
  const router = useRouter();

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Building2 size={16} style={{ color: '#5A4E50' }} />
        <h2 className="font-bold text-base" style={{ color: '#F0EAEB' }}>Cabang</h2>
      </div>
      <p className="text-[11px]" style={{ color: '#5A4E50' }}>
        Pilih cabang untuk masuk ke panel admin dengan kontrol penuh.
      </p>

      <div className="space-y-2.5">
        {BRANCHES.map((b, i) => (
          <motion.button
            key={b.slug}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            onClick={() => router.push(`/admin/dashboard?branch=${b.slug}`)}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-4 text-left active:scale-[0.98] transition-all cursor-pointer"
            style={{ background: '#130E10', border: '1px solid #261E20' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(199,40,32,0.13)' }}
              >
                <Building2 size={18} style={{ color: '#E87068' }} />
              </div>
              <div>
                <p className="font-bold text-sm" style={{ color: '#F0EAEB' }}>{b.label}</p>
                <p className="text-[11px]" style={{ color: '#5A4E50' }}>Panel admin cabang</p>
              </div>
            </div>
            <ChevronRight size={16} style={{ color: '#4A3E40' }} />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
