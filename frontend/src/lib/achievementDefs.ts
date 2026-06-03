// frontend/src/lib/achievementDefs.ts

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface BadgeDef {
  key: string;
  label: string;
  icon: string;
  description: string;
  rarity: Rarity;
  xp: number;
}

export const RARITY_CONFIG: Record<Rarity, {
  label: string; color: string; bg: string; border: string; glow: string; xp: number;
}> = {
  common:    { label: 'Common',    color: 'text-gray-600',   bg: 'bg-gray-50',    border: 'border-gray-200',   glow: '',                          xp: 25  },
  rare:      { label: 'Rare',      color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-200',   glow: '',                          xp: 50  },
  epic:      { label: 'Epic',      color: 'text-purple-600', bg: 'bg-purple-50',  border: 'border-purple-300', glow: 'shadow-purple-200',         xp: 100 },
  legendary: { label: 'Legendary', color: 'text-yellow-600', bg: 'bg-yellow-50',  border: 'border-yellow-400', glow: 'shadow-yellow-200',         xp: 250 },
  mythic:    { label: 'Mythic',    color: 'text-rose-600',   bg: 'bg-rose-50',    border: 'border-rose-400',   glow: 'shadow-rose-200 shadow-md',  xp: 500 },
};

export const BADGE_DEFS: BadgeDef[] = [
  // ── Customer ─────────────────────────────────────────────────
  { key: 'first_cut',        icon: '✂️',  label: 'First Cut',          description: 'Layani customer pertama',      rarity: 'common',    xp: 25  },
  { key: 'rookie_10',        icon: '💈',  label: 'Rookie Cutter',      description: 'Layani 10 customer',           rarity: 'common',    xp: 25  },
  { key: 'century',          icon: '💯',  label: 'Century Club',       description: 'Layani 100 customer',          rarity: 'rare',      xp: 50  },
  { key: 'diamond_hand',     icon: '💎',  label: 'Diamond Hand',       description: 'Layani 1000 customer',         rarity: 'epic',      xp: 100 },
  { key: 'five_thousand',    icon: '🌟',  label: '5000 Legend',        description: 'Layani 5000 customer',         rarity: 'mythic',    xp: 500 },

  // ── Rating ───────────────────────────────────────────────────
  { key: 'first_star',       icon: '⭐',  label: 'First Star',         description: 'Pertama dapat review bintang', rarity: 'common',    xp: 25  },
  { key: 'review_50',        icon: '🌟',  label: '50 Happy Clients',   description: '50 review positif',            rarity: 'rare',      xp: 50  },
  { key: 'review_100',       icon: '💫',  label: '100 Happy Clients',  description: '100 review positif',           rarity: 'epic',      xp: 100 },
  { key: 'review_500',       icon: '✨',  label: 'Review Master',      description: '500 review positif',           rarity: 'legendary', xp: 250 },

  // ── Streak ──────────────────────────────────────────────────
  { key: 'streak_master',    icon: '🔥',  label: 'Streak Master',      description: 'Streak 30 hari',               rarity: 'rare',      xp: 50  },
  { key: 'streak_60',        icon: '⚡',  label: 'Streak Legend',      description: 'Streak 60 hari',               rarity: 'epic',      xp: 100 },
  { key: 'streak_100',       icon: '💥',  label: 'Streak God',         description: 'Streak 100 hari',              rarity: 'legendary', xp: 250 },

  // ── Mission ─────────────────────────────────────────────────
  { key: 'first_mission',    icon: '🎯',  label: 'First Mission',      description: 'Selesaikan misi pertama',      rarity: 'common',    xp: 25  },
  { key: 'mission_hunter',   icon: '🏹',  label: 'Mission Hunter',     description: 'Selesaikan 20 misi',           rarity: 'rare',      xp: 50  },
  { key: 'mission_conqueror', icon: '⚔️', label: 'Mission Conqueror',  description: 'Selesaikan 50 misi',           rarity: 'epic',      xp: 100 },

  // ── Special ─────────────────────────────────────────────────
  { key: 'hair_cut_master',  icon: '✂️',  label: 'Hair Cut Master',    description: '500 potong rambut web',        rarity: 'rare',      xp: 50  },
  { key: 'home_service_hero', icon: '🏠', label: 'Home Service Hero',  description: '25 home service',              rarity: 'rare',      xp: 50  },
  { key: 'customer_king',    icon: '👑',  label: 'Customer King',      description: '#1 leaderboard 3x berturut',   rarity: 'legendary', xp: 250 },
  { key: 'barber_legend',    icon: '🏆',  label: 'Barber Legend',      description: 'Performance Score > 900',      rarity: 'mythic',    xp: 500 },
  { key: 'king_of_shop',     icon: '🌈',  label: 'King of The Shop',   description: 'Raih King of Shop 4x',         rarity: 'mythic',    xp: 500 },
];

// For backend achievement checking (gamificationService.js)
export const ACHIEVEMENT_THRESHOLDS: Record<string, { type: string; value: number; rarity: Rarity }> = {
  first_cut:          { type: 'total_customers', value: 1,    rarity: 'common'    },
  rookie_10:          { type: 'total_customers', value: 10,   rarity: 'common'    },
  century:            { type: 'total_customers', value: 100,  rarity: 'rare'      },
  diamond_hand:       { type: 'total_customers', value: 1000, rarity: 'epic'      },
  five_thousand:      { type: 'total_customers', value: 5000, rarity: 'mythic'    },
  first_star:         { type: 'total_reviews',   value: 1,    rarity: 'common'    },
  review_50:          { type: 'total_reviews',   value: 50,   rarity: 'rare'      },
  review_100:         { type: 'total_reviews',   value: 100,  rarity: 'epic'      },
  review_500:         { type: 'total_reviews',   value: 500,  rarity: 'legendary' },
  streak_master:      { type: 'streak',          value: 30,   rarity: 'rare'      },
  streak_60:          { type: 'streak',          value: 60,   rarity: 'epic'      },
  streak_100:         { type: 'streak',          value: 100,  rarity: 'legendary' },
  first_mission:      { type: 'missions_done',   value: 1,    rarity: 'common'    },
  mission_hunter:     { type: 'missions_done',   value: 20,   rarity: 'rare'      },
  mission_conqueror:  { type: 'missions_done',   value: 50,   rarity: 'epic'      },
};

export const TIER_CONFIG = {
  LEGEND:   { icon: '👑', label: 'LEGEND',   color: 'text-yellow-500', bg: 'bg-yellow-50' },
  ELITE:    { icon: '💎', label: 'ELITE',    color: 'text-purple-600', bg: 'bg-purple-50' },
  ADVANCED: { icon: '⭐', label: 'ADVANCED', color: 'text-blue-600',   bg: 'bg-blue-50' },
  RISING:   { icon: '🌱', label: 'RISING',   color: 'text-green-600',  bg: 'bg-green-50' },
} as const;

export const MISSION_LABELS: Record<string, { label: string; icon: string }> = {
  serve_customers: { label: 'Layani customer', icon: '👥' },
  get_reviews:     { label: 'Dapat review ⭐5', icon: '⭐' },
  no_cancel:       { label: 'Zero cancel/no-show', icon: '✅' },
};
