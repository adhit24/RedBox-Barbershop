"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

export interface LeaderboardRankingItem {
  userId: string
  rank: number
  userName: string
  byline?: string
  value: number
  displayed?: boolean
  valueLabel?: string
}

export interface LeaderboardRankingsProps extends React.HTMLAttributes<HTMLDivElement> {
  rankings: LeaderboardRankingItem[]
  currentUserId?: string
  showPagination?: boolean
  defaultPageSize?: number
}

const RANK_STYLE: Record<number, { text: string; bg: string }> = {
  1: { text: "text-amber-400 font-black", bg: "bg-amber-500/10 border-amber-500/20" },
  2: { text: "text-slate-300 font-black", bg: "bg-slate-400/10 border-slate-400/20" },
  3: { text: "text-orange-400 font-black", bg: "bg-orange-500/10 border-orange-500/20" },
}

export function LeaderboardRankings({
  rankings,
  currentUserId,
  showPagination = false,
  defaultPageSize = 10,
  className,
  ...props
}: LeaderboardRankingsProps) {
  const [currentPage, setCurrentPage] = React.useState(1)
  const displayedRankings = React.useMemo(() => {
    return rankings.filter((r) => r.displayed !== false)
  }, [rankings])

  const totalPages = Math.ceil(displayedRankings.length / defaultPageSize)
  
  const paginatedRankings = React.useMemo(() => {
    if (!showPagination) return displayedRankings
    const start = (currentPage - 1) * defaultPageSize
    const end = start + defaultPageSize
    return displayedRankings.slice(start, end)
  }, [displayedRankings, showPagination, currentPage, defaultPageSize])

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <div className="space-y-1.5">
        {paginatedRankings.map((item, idx) => {
          const isCurrentUser = item.userId === currentUserId
          const rankStyle = RANK_STYLE[item.rank]
          
          return (
            <motion.div
              key={item.userId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all duration-200",
                isCurrentUser 
                  ? "bg-[#C72820]/10 border-[#C72820]/40 shadow-[0_0_16px_rgba(199,40,32,0.1)]"
                  : "bg-white/[0.015] border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.03]"
              )}
            >
              {/* Rank */}
              <div className="w-8 flex-shrink-0 text-center">
                {rankStyle ? (
                  <span className={cn("text-sm", rankStyle.text)}>
                    #{item.rank}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 font-bold">
                    #{item.rank}
                  </span>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-semibold truncate",
                    isCurrentUser ? "text-white" : "text-slate-200"
                  )}
                >
                  {item.userName} {isCurrentUser && <span className="text-[10px] bg-[#C72820] text-white px-1.5 py-0.5 rounded-full ml-1 font-bold">You</span>}
                </p>
                {item.byline && (
                  <p className="text-[10px] text-slate-500 truncate mt-0.5 font-medium leading-none">
                    {item.byline}
                  </p>
                )}
              </div>

              {/* Value */}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-black text-slate-100 font-mono tracking-tight">
                  {item.valueLabel ?? item.value.toLocaleString()}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.05] text-xs">
          <p className="text-slate-500 font-medium">
            Halaman {currentPage} dari {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-white/5 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer text-slate-400"
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-white/5 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer text-slate-400"
              aria-label="Halaman berikutnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
