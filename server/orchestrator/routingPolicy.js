// Points/redeem DISPUTE detection (Round 3, Objective A) — distinct from a
// plain points-balance inquiry. A dispute claims the value changed, was cut,
// went missing, or otherwise looks wrong — never invent the cause here, this
// only classifies intent; verification/handoff happens downstream.
const POINTS_NOUN_SIGNAL = /\b(poin|point|redeem)(nya)?\b/;
const POINTS_DISPUTE_WORDS = /\b(berubah|kepotong|terpotong|berkurang|beda|hilang|salah|tadinya)\b/;
const POINTS_TWO_NUMBERS = /\d+[^\d]+\d+/;

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

function classifyDeterministically(message) {
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
  return null;
}

module.exports = { classifyDeterministically, isStructuredBookingSummary };
