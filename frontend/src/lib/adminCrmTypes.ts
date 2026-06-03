// frontend/src/lib/adminCrmTypes.ts

export interface BarberWithStatus {
  id: string;
  name: string;
  branch: string;
  attendance_status: 'hadir' | 'terlambat' | 'izin' | 'sakit' | 'cuti' | null;
  today_count: number;
}

export interface MokaOpenBill {
  id: string;
  barber_name: string;
  service_name: string;
  time: string;
  external_id: string;
  unassigned: boolean;
}

export interface CommandCenterData {
  today: string;
  barbers: BarberWithStatus[];
  stats: {
    hadir: number;
    tidak_hadir: number;
    belum_check_in: number;
    booking_today: number;
    pending: number;
    home_service_active: number;
    moka_open_bills: number;
  };
  home_service: BookingRow[];
  booking_feed: BookingRow[];
  moka_open_bills: MokaOpenBill[];
  alerts: { type: 'warning' | 'info'; message: string }[];
}

export interface BookingRow {
  id: string;
  name: string;
  wa: string;
  service: string;
  barber_id: string | null;
  time: string;
  date: string;
  status: string;
  notes: string | null;
  location: string;
}

export interface AttendanceData {
  date: string;
  barbers: Array<{
    id: string;
    name: string;
    attendance: { status: string; note: string | null } | null;
    today_count: number;
  }>;
}

export interface CustomerRow {
  name: string;
  wa: string;
  count?: number;
  barber_id?: string;
  date?: string;
  service?: string;
}

export interface LeaderboardItem {
  rank: number;
  id: string;
  name: string;
  branch: string;
  score: number;
  display: string;
}

export interface ScheduleData {
  barbers: Array<{ id: string; name: string; work_days: string[] }>;
  days: string[];
  overrides: Record<string, Record<string, boolean>>;
}

export interface BroadcastLog {
  id: string;
  message: string;
  target: string;
  channel: string;
  sent_at: string;
}
