export const BRANCHES = [
  { key: 'all',       label: 'Semua' },
  { key: 'bypass',    label: 'Bypass' },
  { key: 'samadikun', label: 'Samadikun' },
  { key: 'csb',       label: 'CSB' },
  { key: 'sumber',    label: 'Sumber' },
  { key: 'tegal',     label: 'Tegal' },
] as const;

export type BranchKey = typeof BRANCHES[number]['key'];

export const BOOKING_STATUSES = ['pending', 'confirmed', 'done', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending:   'Pending',
  confirmed: 'Konfirmasi',
  done:      'Selesai',
  cancelled: 'Batal',
};

export const STATUS_COLORS: Record<BookingStatus, string> = {
  pending:   'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  done:      'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export const SERVICE_PRICES: Record<string, number> = {
  'Gunting':           45000,
  'Gunting + Cuci':    55000,
  'Full Service':      85000,
  'Fade Cut':          55000,
  'Hair Tattoo':       65000,
  'Cukur Jenggot':     35000,
  'Traditional Shave': 45000,
  'Creambath':         75000,
  'Hair Color':       120000,
  'Smoothing':        250000,
};

export interface Booking {
  id: string;
  date: string;
  time: string;
  customer_name: string;
  customer_phone: string;
  barber_id: string | null;
  barber_name: string | null;
  service: string;
  location: string;
  status: BookingStatus;
  price: number | null;
  address: string | null;
  type: string | null;
}

export interface Barber {
  id: string;
  name: string;
  branch: string;
  is_active: boolean;
  today_override: boolean | null;
  phone: string | null;
}

export interface StatsResponse {
  today: number;
  done: number;
  pending: number;
  customers: number;
}

export interface RevenueResponse {
  total: number;
  count: number;
  period: { from: string; to: string };
  by_branch: Array<{ name: string; revenue: number }>;
  by_barber: Array<{ name: string; revenue: number }>;
  by_date: Array<{ date: string; revenue: number }>;
}
