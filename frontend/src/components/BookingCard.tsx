import { type Booking } from '@/lib/constants';
import { StatusBadge } from './StatusBadge';

interface Props {
  booking: Booking;
  onStatusChange?: (id: string, status: string) => void;
  showBranch?: boolean;
}

export function BookingCard({ booking, onStatusChange, showBranch = false }: Props) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-semibold text-gray-900">{booking.customer_name}</p>
          <p className="text-sm text-gray-500">{booking.time} · {booking.service}</p>
          {showBranch && (
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{booking.location}</p>
          )}
          {booking.type === 'home_service' && (
            <span className="inline-block mt-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              Home Service
            </span>
          )}
        </div>
        <StatusBadge status={booking.status} />
      </div>
      {booking.barber_name && (
        <p className="text-sm text-gray-600">{booking.barber_name}</p>
      )}
      {onStatusChange && booking.status !== 'done' && booking.status !== 'cancelled' && (
        <div className="flex gap-2 mt-3">
          {booking.status === 'pending' && (
            <button
              onClick={() => onStatusChange(booking.id, 'confirmed')}
              className="flex-1 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
            >
              Konfirmasi
            </button>
          )}
          <button
            onClick={() => onStatusChange(booking.id, 'done')}
            className="flex-1 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
          >
            Selesai
          </button>
          <button
            onClick={() => onStatusChange(booking.id, 'cancelled')}
            className="py-1.5 px-3 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
          >
            Batal
          </button>
        </div>
      )}
    </div>
  );
}
