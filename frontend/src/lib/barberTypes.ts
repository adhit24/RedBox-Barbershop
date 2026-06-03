import type { Booking } from './constants';

export interface BarberInfo {
  id: string;
  name: string;
  branch: string;
}

export interface BarberProfile {
  barber_id: string;
  phone: string;
  avatar_url: string | null;
  target_daily: number | null;
  target_monthly: number | null;
  setup_completed: boolean;
  notif_enabled: boolean;
}

export interface BarberMeResponse {
  barber: BarberInfo;
  profile: BarberProfile | null;
}

export interface BarberStats {
  period: 'day' | 'week' | 'month' | 'year';
  from: string;
  to: string;
  count: number;
  revenue: number;
  hours: number;
  rating: number;
}

export interface BarberUpcoming {
  next: Booking | null;
  today: Booking[];
  tomorrow: Booking[];
}

export interface BarberHistoryResponse {
  items: Booking[];
  period: string;
  from: string;
  to: string;
}

export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_hit_date: string | null;
}

export interface BadgeEarned {
  badge_key: string;
  earned_at: string;
}

export interface BadgeInProgress {
  badge_key: string;
  label: string;
  current: number;
  target: number;
}

export interface AchievementsResponse {
  earned: BadgeEarned[];
  in_progress: BadgeInProgress[];
}

export interface RecordsData {
  best_customer_per_day: number;
  best_customer_per_day_at: string | null;
  best_revenue_per_month: number;
  best_revenue_per_month_at: string | null;
  best_rating_per_month: number;
  best_rating_per_month_at: string | null;
  longest_streak_at: string | null;
}

export interface Mission {
  mission_key: string;
  target: number;
  progress: number;
  completed_at: string | null;
}

export interface MissionsResponse {
  week_start: string;
  missions: Mission[];
}

export interface LeaderboardEntry {
  rank: number;
  barber_id: string;
  name: string;
  branch: string;
  total_count: number;
  is_me: boolean;
}

export interface LeaderboardData {
  tier: 'LEGEND' | 'ELITE' | 'ADVANCED' | 'RISING';
  position_pct: number;
  next_tier_needed: number;
  my_count: number;
  barber_count: number;
  month: string;
  rankings: LeaderboardEntry[];
}

export interface FavoriteCustomer {
  name: string;
  visits: number;
  service: string;
}

export interface ReviewHighlight {
  rating: number;
  review_text: string;
  customer_name: string;
  created_at: string;
}

export interface PaceData {
  current_count: number;
  target_monthly: number;
  days_passed: number;
  days_remaining: number;
  current_pace: number;
  predicted_end: number;
  needed_per_day: number;
  on_track: boolean;
}


export interface XPData {
  total_xp: number;
  current_xp: number;
  level: number;
  prestige: number;
  xp_to_next_level: number;
  xp_multiplier: number;
}

export interface TitleData {
  level_title: string;
  special_title: string | null;
  active_title: string;
}

export interface SocialFeedItem {
  id: number;
  event_type: string;
  barber_name: string;
  branch: string;
  title: string;
  body: string;
  emoji: string | null;
  created_at: string;
}

export interface SocialFeedResponse {
  items: SocialFeedItem[];
  offset: number;
  limit: number;
}

export interface RivalData {
  rival_id: string;
  rival_name: string;
  rival_branch: string;
  my_count: number;
  rival_count: number;
  result: string | null;
  gap: number;
}

export interface KingData {
  barber_id: string;
  barber_name: string;
  total_count: number;
  is_me: boolean;
}

export interface LeaderboardCategoryItem {
  rank: number;
  barber_id: string;
  barber_name: string;
  branch: string;
  score: number;
  display_value: string;
}
