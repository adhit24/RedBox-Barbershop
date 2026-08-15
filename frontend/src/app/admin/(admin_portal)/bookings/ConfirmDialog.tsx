'use client';
import { motion } from 'framer-motion';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmDialogProps {
  message: string;
  subtext?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  message,
  subtext,
  confirmLabel = 'Ya, lanjutkan',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.88, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        className="bg-[#0F172A] border border-slate-700 rounded-2xl p-5 w-full max-w-sm space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
            danger ? 'bg-red-500/15' : 'bg-amber-500/15'
          }`}>
            {danger
              ? <AlertTriangle size={18} className="text-red-400" />
              : <Info size={18} className="text-amber-400" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-snug">{message}</p>
            {subtext && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{subtext}</p>}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 h-10 border border-slate-700 rounded-xl text-sm text-slate-400 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
          >
            Tidak
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white cursor-pointer active:scale-95 transition-all disabled:opacity-50 ${
              danger
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {loading ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
