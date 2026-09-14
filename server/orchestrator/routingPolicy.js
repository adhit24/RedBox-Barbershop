// Points/redeem DISPUTE detection (Round 3, Objective A) — distinct from a
// plain points-balance inquiry. A dispute claims the value changed, was cut,
// went missing, or otherwise looks wrong — never invent the cause here, this
// only classifies intent; verification/handoff happens downstream.
const POINTS_NOUN_SIGNAL = /\b(poin|point|redeem)(nya)?\b/;
const POINTS_DISPUTE_WORDS = /\b(berubah|kepotong|terpotong|berkurang|beda|hilang|salah|tadinya)\b/;
const POINTS_TWO_NUMBERS = /\d+[^\d]+\d+/;

// Barber availability read queries (Reddy barber-availability MVP). Distinct
// from booking_availability_inquiry (generic "is it available" with no clear
// barber/branch subject) — these require at least a barber name or an
// explicit branch-wide "who is free" shape, so the deterministic availability
// capability (barberAvailabilityQuery.js) has something concrete to look up.
const AVAILABILITY_SIGNAL_WORD = /\b(kosong|available|tersedia|free|bebas)\b/;
// Honorific expansion (staging-verification P1 fix): "abang", "kak", "om" are
// common real customer address forms alongside the original set.
const BARBER_NAME_PREFIX = /\b(mas|mbak|pak|bu|bang|abang|kak|om)\s+[\p{L}][\p{L}'.-]{1,30}\b/iu;
const SPECIFIC_TIME_SIGNAL = /\bjam\s*[0-2]?\d(?:[:.]\d{2})?\b/;
const WHO_IS_FREE_SIGNAL = /\bsiapa\s+(yang\s+)?(masih\s+)?(kosong|available|tersedia|free|bisa)\b/;
// Named barber + bare "ada" ("Mas Abdul hari ini ada?") is a real, common
// phrasing of the same question — word order (verb before/after the
// temporal word) doesn't matter here the way it does for
// barberPresenceIntent.js's anchored regex. Narrowed to a temporal word so
// "ada" alone (extremely common in unrelated sentences) doesn't over-match.
const NAMED_BARBER_TEMPORAL_ADA = /\bada\b/;
const TEMPORAL_WORD = /\b(hari ini|sekarang|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/;

function classifyAvailabilityIntent(normalized) {
  const hasAvailabilitySignal = AVAILABILITY_SIGNAL_WORD.test(normalized)
    || (NAMED_BARBER_TEMPORAL_ADA.test(normalized) && TEMPORAL_WORD.test(normalized));
  const hasSpecificTime = SPECIFIC_TIME_SIGNAL.test(normalized);
  const hasBarberName = BARBER_NAME_PREFIX.test(normalized);
  const hasWhoIsFree = WHO_IS_FREE_SIGNAL.test(normalized);

  if (hasWhoIsFree && !hasBarberName) {
    return { intent: 'branch_availability_query', confidence: 1 };
  }
  if (hasBarberName && hasSpecificTime && hasAvailabilitySignal) {
    return { intent: 'specific_time_availability_query', confidence: 1 };
  }
  if (hasBarberName && hasAvailabilitySignal) {
    return { intent: 'barber_availability_query', confidence: 1 };
  }
  return null;
}

// Staging-verification P1 fix: a bare barber name with no honorific ("abdul
// ada ga hari ini", "besok sofyan masuk?") previously missed classification
// entirely, since BARBER_NAME_PREFIX above requires an honorific and there
// is no general-purpose name detector without a roster. This is a NARROW,
// roster-aware addition — it only ever fires when the caller supplies the
// real active-barber roster (canonicalBarberNames), never a fuzzy/guessed
// match, and only when an availability/schedule signal word is also
// present (so "Abdul ganteng juga ya" / "Sofyan potongannya bagus" — a bare
// mention with no such signal — never match). A booking-write verb always
// wins and disqualifies this path entirely.
const BARE_AVAILABILITY_SIGNAL = /\b(ada|kosong|available|penuh|full|masuk|jadwal|slot|bisa|kerja)\b/;
const WRITE_VERB_SIGNAL = /\b(booking|bookingin|pesan slot|amankan|lock|kunci|reschedule|jadwal ulang|cancel|batalkan)\b/;

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifyBareBarberAvailability(normalized, canonicalBarberNames) {
  if (!Array.isArray(canonicalBarberNames) || !canonicalBarberNames.length) return null;
  if (WRITE_VERB_SIGNAL.test(normalized)) return null;
  if (!BARE_AVAILABILITY_SIGNAL.test(normalized)) return null;

  const matched = canonicalBarberNames.some((name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    return new RegExp(`\\b${escapeRegExp(trimmed.toLowerCase())}\\b`, 'i').test(normalized);
  });
  if (!matched) return null;

  const hasSpecificTime = SPECIFIC_TIME_SIGNAL.test(normalized);
  return { intent: hasSpecificTime ? 'specific_time_availability_query' : 'barber_availability_query', confidence: 1 };
}

// Booking-site technical failures need deterministic routing. Without this,
// short messages such as "gabisa verifikasi captcanya" can fall into a generic
// complaint route and Reddy may incorrectly blame the customer's internet or
// immediately push the problem to a branch admin.
const BOOKING_TECHNICAL_ISSUE = /(?:\b(?:booking|reservasi|website|web)\b.{0,40}\b(?:error|eror|gagal|bermasalah|nggak\s*bisa|ga\s*bisa|gabisa)\b)|(?:\b(?:captcha|captca|capcha|turnstile|verifikasi\s+keamanan|verifikasi\s+bot)\b)/;

// P1 structured-booking-summary guard.
// Customers sometimes paste a complete booking summary back into WhatsApp.
// It is NOT a request for a barber list and it is NOT proof that a booking
// exists. Route it to booking_status so downstream policy requires a trusted
// booking-backend lookup instead of letting generic booking/barber heuristics
// answer from surface words alone.
const STRUCTURED_BOOKING_FIELD_PATTERNS = [
  /(?:^|\n)\s*(?:nama|name)\s*:/im,
  /(?:^|\n)\s*(?:layanan|service)\s*:/im,
  /(?:^|\n)\s*(?:harga|price)\s*:/im,
  /(?:^|\n)\s*(?:durasi|duration)\s*:/im,
  /(?:^|\n)\s*(?:kapster|barber)\s*:/im,
  /(?:^|\n)\s*(?:tanggal|date|hari)\s*:/im,
  /(?:^|\n)\s*(?:jam|time)\s*:/im,
  /(?:^|\n)\s*(?:cabang|branch|lokasi|location)\s*:/im,
  /(?:^|\n)\s*(?:nomor\s*(?:wa|whatsapp|hp)|whatsapp|phone)\s*:/im,
];

function isStructuredBookingSummary(message) {
  const raw = String(message || '');
  if (!raw.trim()) return false;

  const matchedFields = STRUCTURED_BOOKING_FIELD_PATTERNS
    .reduce((count, pattern) => count + (pattern.test(raw) ? 1 : 0), 0);
  const hasBookingCore = /(?:^|\n)\s*(?:layanan|service)\s*:/im.test(raw)
    && (/(?:^|\n)\s*(?:tanggal|date|hari|jam|time)\s*:/im.test(raw)
      || /(?:^|\n)\s*(?:kapster|barber|cabang|branch|lokasi|location)\s*:/im.test(raw));

  return matchedFields >= 3 && hasBookingCore;
}

function classifyDeterministically(message, { canonicalBarberNames = [] } = {}) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  if (/\b(admin|manusia|customer service|cs)\b/.test(normalized) || /bicara (dengan |sama )?orang/.test(normalized)) {
    return { intent: 'human_request', confidence: 1 };
  }
  if (isStructuredBookingSummary(message)) {
    return { intent: 'booking_status', confidence: 1, reason: 'structured_booking_summary' };
  }
  if (BOOKING_TECHNICAL_ISSUE.test(normalized)) {
    return { intent: 'booking_request', confidence: 1, reason: 'booking_technical_issue' };
  }
  if (POINTS_NOUN_SIGNAL.test(normalized)
    && (POINTS_DISPUTE_WORDS.test(normalized) || POINTS_TWO_NUMBERS.test(normalized))) {
    return { intent: 'points_dispute', confidence: 1 };
  }
  if (/\bpoin(ku| saya)?\b|\bcek poin\b|\bpoin saya berapa\b/.test(normalized)) {
    return { intent: 'points_inquiry', confidence: 1 };
  }
  const aggregateSignal = /\b(paling\s+(sering|banyak|populer)|terbanyak|favorit\s+(customer|pelanggan))\b/.test(normalized);
  const barberSignal = /\b(kapster|barber)\b/.test(normalized);
  const bookingSelectionSignal = /\b(di\s*book(?:ing)?|dibook(?:ing)?|bookingnya|dipilih|booked)\b/.test(normalized);
  const explicitPopularitySignal = /\b(paling\s+populer|favorit\s+(customer|pelanggan))\b/.test(normalized);
  const whoBookingSignal = /\bsiapa\b/.test(normalized) && /\bbookingnya\b/.test(normalized);
  const servedVolumeSignal = /\bsiapa\b/.test(normalized)
    && /\b(melayani|dilayani|terlayani)\b/.test(normalized)
    && /\b(customer|pelanggan)\b/.test(normalized);
  if (aggregateSignal
    && (((bookingSelectionSignal || explicitPopularitySignal) && (barberSignal || whoBookingSignal)) || servedVolumeSignal)) {
    return { intent: 'barber_popularity_inquiry', confidence: 1 };
  }
  const personalSignal = /\b(aku|saya|ku|punya aku|milik saya)\b/.test(normalized);
  const bookingSignal = /\b(booking|reservasi)\b/.test(normalized);
  if (bookingSignal && /\bslot\b/.test(normalized) && /\b(terakhir|paling malam|terlambat)\b/.test(normalized)) {
    return { intent: 'booking_availability_inquiry', confidence: 1 };
  }
  if (personalSignal && bookingSignal && /\b(status|confirmed|konfirmasi|aman|masuk)\b/.test(normalized)) {
    return { intent: 'booking_status', confidence: 1 };
  }
  if (personalSignal && bookingSignal && /\b(terakhir|riwayat|history|sebelumnya)\b/.test(normalized)) {
    return { intent: 'customer_booking_history', confidence: 1 };
  }
  if (personalSignal && /\b(terakhir|riwayat|history)\b/.test(normalized)
    && /\b(favorit|favorite|biasanya)\b/.test(normalized)) {
    return { intent: 'customer_history', confidence: 1 };
  }
  const availabilityIntent = classifyAvailabilityIntent(normalized);
  if (availabilityIntent) return availabilityIntent;
  const bareBarberAvailability = classifyBareBarberAvailability(normalized, canonicalBarberNames);
  if (bareBarberAvailability) return bareBarberAvailability;
  return null;
}

module.exports = { classifyDeterministically, isStructuredBookingSummary };
