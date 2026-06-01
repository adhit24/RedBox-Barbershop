'use client';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { fetchBookings } from '@/lib/api';
import { type Booking } from '@/lib/constants';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomeServicePage() {
  const { user } = useUser();
  const [jobs, setJobs] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.barber_id) return;
    fetchBookings({ date: todayStr(), barber_id: user.barber_id })
      .then((data) => {
        setJobs(data.filter((b) => b.type === 'home_service' && b.status !== 'cancelled'));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.barber_id]);

  if (loading) {
    return <div className="p-4 text-center py-10 text-gray-400">Memuat...</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Home Service</h2>

      {jobs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🏠</p>
          <p className="text-gray-500">Tidak ada job home service hari ini</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-gray-900">{job.customer_name}</p>
                  <p className="text-sm text-gray-500">⏰ {job.time} · {job.service}</p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    job.status === 'done'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-purple-100 text-purple-700'
                  }`}
                >
                  {job.status === 'done' ? 'Selesai' : 'Aktif'}
                </span>
              </div>

              {job.address && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">📍 Alamat</p>
                  <p className="text-sm text-gray-900">{job.address}</p>
                </div>
              )}

              <div className="flex gap-2">
                {job.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl text-center hover:bg-blue-700 transition-colors"
                  >
                    🗺️ Buka Maps
                  </a>
                )}
                {job.customer_phone && (
                  <a
                    href={`https://wa.me/${job.customer_phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 text-sm font-medium bg-green-600 text-white rounded-xl text-center hover:bg-green-700 transition-colors"
                  >
                    💬 WA Customer
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
