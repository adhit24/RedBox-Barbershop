"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ProgressiveFluxPhase {
  at: number;
  label: string;
}

interface ProgressiveFluxLoaderProps {
  value: number;
  phases?: ProgressiveFluxPhase[];
  showLabel?: boolean;
  className?: string;
  barClassName?: string;
  textClassName?: string;
}

const DEFAULT_PHASES: ProgressiveFluxPhase[] = [
  { at: 0, label: "Memulai refresh" },
  { at: 30, label: "Mengambil data leaderboard" },
  { at: 65, label: "Mengolah performa" },
  { at: 90, label: "Hampir selesai" },
  { at: 100, label: "Data terbaru siap" },
];

function pickLabel(value: number, phases: ProgressiveFluxPhase[]) {
  return phases.reduce((label, phase) => value >= phase.at ? phase.label : label, phases[0]?.label ?? "Memuat");
}

export function ProgressiveFluxLoader({
  value,
  phases = DEFAULT_PHASES,
  showLabel = true,
  className,
  barClassName,
  textClassName,
}: ProgressiveFluxLoaderProps) {
  const reduced = useReducedMotion();
  const current = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const sortedPhases = React.useMemo(() => [...phases].sort((a, b) => a.at - b.at), [phases]);
  const label = pickLabel(current, sortedPhases);

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <AnimatePresence mode="wait">
          <motion.p
            key={label}
            className={cn("mb-2 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400", textClassName)}
            initial={reduced ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -5 }}
          >
            {label}
          </motion.p>
        </AnimatePresence>
      )}
      <div
        className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]", barClassName)}
        role="progressbar"
        aria-label="Progress refresh leaderboard"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${Math.round(current)}% - ${label}`}
      >
        <motion.div
          className="relative h-full rounded-full"
          style={{ background: "linear-gradient(90deg, #C72820 0%, #F28A5B 55%, #FFD0A8 100%)", boxShadow: "0 0 16px rgba(199,40,32,.45)" }}
          initial={false}
          animate={{ width: `${current}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {!reduced && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-white/70 to-transparent"
              animate={{ x: ["-120%", "220%"] }}
              transition={{ duration: 1.4, ease: "linear", repeat: Infinity }}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}

export default ProgressiveFluxLoader;
