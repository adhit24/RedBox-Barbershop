'use strict';

const { getMemberPhoneVariants } = require('./member-identity');

// Conservative cap on how many booking ids get sent through a single
// .in(...) filter for the reviews count lookup. A customer with more
// bookings than this skips the lookup entirely (Ulasan hidden) rather
// than sending an unbounded id list. No pagination/RPC is built here —
// that's a deliberate scope boundary for this change.
const MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP = 300;

/**
 * Resolve how many reviews a customer has, scoped strictly by their
 * session-resolved WhatsApp number — this function takes no request
 * object and has no other input channel, so a caller cannot redirect it
 * at another customer's reviews.
 *
 * reviews has no direct customer/wa column; it only links back via
 * booking_id -> bookings.wa, so this is a two-step lookup (booking ids
 * for this customer, then a count of reviews against those ids) rather
 * than an embedded/nested join — .in() on a primary key never
 * duplicates rows, so this can't double-count.
 *
 * Returns:
 *   - a non-negative integer on success (0 is a real "this customer has
 *     no reviews", not "unavailable")
 *   - undefined when the count is not available: empty/malformed phone
 *     (no lookup is run at all), a query error, a bookings lookup that
 *     PostgREST's default row cap truncated, or a booking-id list past
 *     the conservative cap above. Callers must treat undefined as
 *     "unknown" and must never default it to 0.
 */
async function getCustomerReviewsCount(supabase, customerWa) {
  const reviewVariants = getMemberPhoneVariants(customerWa);
  if (!reviewVariants.length) return undefined;

  try {
    const reviewBookingFilter = reviewVariants.map(value => `wa.eq.${value}`).join(',');
    const { data: myBookingsForReviews, count: myBookingsTotalCount, error: myBookingsErr } =
      await supabase.from('bookings')
        .select('id', { count: 'exact' })
        .or(reviewBookingFilter);
    if (myBookingsErr) throw myBookingsErr;

    const myBookingIds = (myBookingsForReviews || []).map(b => b.id);

    if (typeof myBookingsTotalCount === 'number' && myBookingsTotalCount > myBookingIds.length) {
      // More matching bookings exist than were returned in this unpaginated
      // select — the id list is incomplete, so counting against it would
      // silently under-report. Unavailable, not a wrong low number.
      console.warn(`[member-reviews] skipped: bookings lookup truncated (${myBookingIds.length}/${myBookingsTotalCount})`);
      return undefined;
    }

    if (myBookingIds.length === 0) return 0;

    if (myBookingIds.length > MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP) {
      console.warn(`[member-reviews] skipped: ${myBookingIds.length} booking ids exceeds cap of ${MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP}`);
      return undefined;
    }

    const { count: reviewsCount, error: reviewsCountErr } = await supabase.from('reviews')
      .select('id', { count: 'exact', head: true })
      .in('booking_id', myBookingIds);
    if (reviewsCountErr) throw reviewsCountErr;

    return reviewsCount || 0;
  } catch (err) {
    console.warn('[member-reviews] reviews_count lookup failed:', err.message);
    return undefined;
  }
}

module.exports = { getCustomerReviewsCount, MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP };
