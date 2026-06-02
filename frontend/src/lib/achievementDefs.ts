// frontend/src/lib/achievementDefs.ts

export interface BadgeDef {
  key: string;
  label: string;
  icon: string;
  description: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  { key: 'hair_cut_master',   icon: '✂️', label: 'Hair Cut Master',   description: '500 potong rambut' },
  { key: 'color_expert',      icon: '🎨', label: 'Color Expert',      description: '100 hair color' },
  { key: 'home_service_hero', icon: '🏠', label: 'Home Service Hero', description: '25 home service' },
  { key: 'early_bird',        icon: '🌅', label: 'Early Bird',        description: '10 booking sebelum jam 10 pagi' },
  { key: 'night_owl',         icon: '🌙', label: 'Night Owl',         description: '10 booking setelah jam 20 malam' },
  { key: 'diamond_hand',      icon: '💎', label: 'Diamond Hand',      description: '1000 customer total' },
  { key: 'streak_master',     icon: '🔥', label: 'Streak Master',     description: '30 hari streak tanpa putus' },
];

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
