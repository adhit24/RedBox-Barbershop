import type { FavoriteCustomer } from '@/lib/barberTypes';

export function FavoriteCustomerList({ favorites }: { favorites: FavoriteCustomer[] }) {
  if (favorites.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">💝 Customer Setia</p>
      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
        {favorites.map((f, i) => (
          <div key={i} className="px-3 py-2 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-gray-900">{f.name}</p>
              <p className="text-xs text-gray-400">{f.service}</p>
            </div>
            <span className="text-sm text-gray-500">{f.visits}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}
