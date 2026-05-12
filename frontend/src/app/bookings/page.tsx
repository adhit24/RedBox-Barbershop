import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function BookingsPage() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .order('booking_date', { ascending: false })
    .limit(10)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Recent Bookings</h1>
      
      {bookings && bookings.length > 0 ? (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <div 
              key={booking.id} 
              className="p-4 border rounded-lg shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-lg">
                    {booking.customer_name || 'Unknown Customer'}
                  </p>
                  <p className="text-gray-600 text-sm">
                    {booking.customer_phone}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {booking.status}
                </span>
              </div>
              <div className="mt-3 text-sm text-gray-500">
                <p>📅 {booking.booking_date} at {booking.booking_time}</p>
                <p>📍 {booking.location}</p>
                <p>💇 {booking.service_name}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500">No bookings found.</p>
      )}
    </div>
  )
}
