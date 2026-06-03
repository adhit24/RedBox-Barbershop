'use client';
import { useUser } from '@/hooks/useUser';
import { motion } from 'framer-motion';
import { User, Mail, Shield } from 'lucide-react';

export default function OwnerProfilePage() {
  const { user, signOut } = useUser();

  return (
    <div className="p-4 space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <User size={16} className="text-slate-500" />
        <h2 className="text-white font-bold text-base">Profil</h2>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-[#0F172A] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
            <User size={22} className="text-slate-400" />
          </div>
          <div>
            <p className="font-bold text-white">{user?.name}</p>
            <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] bg-green-500/15 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">
              <Shield size={9} /> Owner
            </span>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-3 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Mail size={13} className="text-slate-500" />
            <p className="text-sm text-slate-300">{user?.email}</p>
          </div>
        </div>
      </motion.div>

      <button onClick={signOut}
        className="w-full py-3 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-semibold active:scale-95 transition-all cursor-pointer">
        Keluar
      </button>
    </div>
  );
}
