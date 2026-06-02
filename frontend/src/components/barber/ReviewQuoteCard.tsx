import type { ReviewHighlight } from '@/lib/barberTypes';

export function ReviewQuoteCard({ reviews }: { reviews: ReviewHighlight[] }) {
  if (reviews.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-3">🌟 Kata Mereka</p>
      <div className="space-y-2">
        {reviews.slice(0, 3).map((r, i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100">
            <p className="text-sm text-gray-700 italic">"{r.review_text}"</p>
            <p className="text-xs text-gray-400 mt-1">— {r.customer_name} ({'⭐'.repeat(r.rating)})</p>
          </div>
        ))}
      </div>
    </div>
  );
}
