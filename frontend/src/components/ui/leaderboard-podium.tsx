"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { Trophy, Award } from "lucide-react"

export interface LeaderboardRanking {
  userId: string
  userName: string
  rank: number
  value: number
  avatarUrl?: string
}

export interface LeaderboardPodiumProps extends React.HTMLAttributes<HTMLDivElement> {
  rankings: LeaderboardRanking[]
}

const PODIUM_CONFIG: Record<number, {
  height: string
  color: string
  borderColor: string
  bgColor: string
  textColor: string
  label: string
  delay: number
  glow: string
}> = {
  1: {
    height: "h-36 sm:h-44",
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgColor: "from-amber-500/10 to-amber-500/5",
    textColor: "text-amber-400",
    label: "1st",
    delay: 0.1,
    glow: "shadow-[0_0_24px_rgba(245,158,11,0.12)]",
  },
  2: {
    height: "h-28 sm:h-36",
    color: "text-slate-300",
    borderColor: "border-slate-400/30",
    bgColor: "from-slate-400/10 to-slate-400/5",
    textColor: "text-slate-300",
    label: "2nd",
    delay: 0.2,
    glow: "shadow-[0_0_20px_rgba(203,213,225,0.08)]",
  },
  3: {
    height: "h-20 sm:h-28",
    color: "text-orange-400",
    borderColor: "border-orange-500/25",
    bgColor: "from-orange-500/10 to-orange-500/5",
    textColor: "text-orange-400",
    label: "3rd",
    delay: 0.3,
    glow: "shadow-[0_0_16px_rgba(249,115,22,0.06)]",
  },
}

export function LeaderboardPodium({ rankings, className, ...props }: LeaderboardPodiumProps) {
  // Sort podium so that Rank 2 is on the Left, Rank 1 in the Center, Rank 3 on the Right.
  const podiumOrder = React.useMemo(() => {
    const r1 = rankings.find((r) => r.rank === 1)
    const r2 = rankings.find((r) => r.rank === 2)
    const r3 = rankings.find((r) => r.rank === 3)
    return [r2, r1, r3]
  }, [rankings])

  return (
    <div
      className={cn("flex items-end justify-center gap-2 sm:gap-4 px-2 py-4", className)}
      {...props}
    >
      {podiumOrder.map((item, idx) => {
        if (!item) {
          // Empty slot placeholder
          return <div key={`empty-${idx}`} className="flex-1 max-w-[110px]" />
        }

        const config = PODIUM_CONFIG[item.rank]
        const initials = item.userName
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()

        return (
          <div
            key={item.userId}
            className="flex-1 flex flex-col items-center max-w-[110px]"
          >
            {/* Avatar & Icon block */}
            <motion.div
              initial={{ scale: 0, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: config.delay,
              }}
              className="relative mb-3 flex flex-col items-center"
            >
              {/* Crown/Trophy Icon */}
              {item.rank === 1 ? (
                <Trophy size={18} className="text-amber-400 mb-1 animate-bounce" />
              ) : (
                <Award size={16} className={config.color} />
              )}

              {/* Avatar circle */}
              <div
                className={cn(
                  "w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 flex items-center justify-center font-bold text-xs sm:text-sm shadow-md",
                  config.borderColor
                )}
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)",
                }}
              >
                {item.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.avatarUrl}
                    alt={item.userName}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className={config.textColor}>{initials}</span>
                )}
              </div>

              {/* Rank Badge */}
              <span
                className={cn(
                  "absolute -bottom-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border leading-none shadow-sm",
                  config.color,
                  config.borderColor
                )}
                style={{ background: "#0F172A" }}
              >
                {config.label}
              </span>
            </motion.div>

            {/* Podium column */}
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              transition={{ duration: 0.6, ease: "easeOut", delay: config.delay }}
              className="w-full"
            >
              <div
                className={cn(
                  "w-full rounded-t-2xl border border-b-0 px-2 py-3 flex flex-col items-center justify-between text-center",
                  config.height,
                  config.borderColor,
                  config.glow
                )}
                style={{
                  background: `linear-gradient(180deg, ${config.bgColor.split(" ")[0]} 0%, ${config.bgColor.split(" ")[2]} 100%)`,
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                }}
              >
                <div className="min-w-0 w-full">
                  <p className="text-[10px] sm:text-xs font-bold text-white truncate max-w-full leading-snug">
                    {item.userName.split(" ")[0]}
                  </p>
                  {item.userName.split(" ")[1] && (
                    <p className="text-[9px] font-medium text-slate-500 truncate max-w-full leading-none mt-0.5">
                      {item.userName.split(" ")[1]}
                    </p>
                  )}
                </div>

                <p className={cn("text-[10px] sm:text-xs font-black font-mono tracking-tight", config.textColor)}>
                  {item.value.toLocaleString()}
                </p>
              </div>
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}
