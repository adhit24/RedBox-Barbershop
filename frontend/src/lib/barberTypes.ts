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
