import type { Booking } from '@/lib/constants';

function minutesUntil(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

interface Props {
  booking: Booking;
}

export function UpcomingBookingCard({ booking }: Props) {
  const mins = minutesUntil(booking.time);
  const label = mins <= 0 ? 'Sekarang' : mins < 60 ? `${mins} menit lagi` : `${Math.round(mins / 60)} jam lagi`;
  return (
    <div className="bg-gradient-to-br from-red-500 to-red-600 text-white rounded-2xl p-4 shadow-sm">
      <p className="text-xs opacity-80 mb-1">⏰ BERIKUTNYA</p>
      <p className="text-lg font-bold">{booking.customer_name}</p>
      <p className="text-sm opacity-90">{booking.service}</p>
      <div className="flex justify-between items-end mt-3">
        <span className="text-2xl font-bold">{booking.time}</span>
        <span className="text-sm opacity-90">{label}</span>
      </div>
    </div>
  );
}
