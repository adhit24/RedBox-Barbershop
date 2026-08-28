'use strict';

const REDDY_BOOKING_EXECUTION = 'DISABLED';

const PROHIBITED_PATTERNS = [
  /\b(sudah|telah|udah)\s+(aku|saya|kami)?\s*(booking|dibooking|amankan|diamankan|simpan|lock|kunci|catat)\b/i,
  /\b(aku|saya|kami)\s+(sudah|telah|udah)\s*(booking|amankan|simpan|lock|kunci|catat|reschedule|cancel|batalkan)\b/i,
  /\b[\p{L}][\p{L} '-]{1,30}\s+(sudah|telah|udah)\s+(aku|saya|kami)?\s*(booking|lock|kunci|amankan|dipilih)\b/iu,
  /\b(booking|reservasi|slot|barber|kapster)\s*(sudah|telah|udah)?\s*(dibuat|dicatat|disimpan|diamankan|dilock|dikunci|dikonfirmasi|dipilih|masuk|dibatalkan|diubah)\b/i,
  /\b(reschedule|jadwal ulang|pembatalan|cancel)\s*(berhasil|sukses|sudah selesai|sudah dilakukan)\b/i,
  /\b(sudah|telah|udah)\s+(di)?(reschedule|jadwal ulang|cancel|batalkan)\b/i,
  /\b(slotnya|barbernya|kapsternya)\s*(aman|terkunci|sudah dipilih)\b/i,
];

const UNVERIFIED_AVAILABILITY_PATTERNS = [
  /\b(jam|slot)\s*\d{1,2}(?::[0-5]\d)?\s*(masih)?\s*(kosong|tersedia|available|bebas)\b/i,
  /\b(slot|jam)\s*(kosong|tersedia|available)\b/i,
  /\b[\p{L}][\p{L} '-]{1,30}\s+(kosong|tersedia|available|bisa)\s+(di\s+)?jam\s*\d{1,2}\b/iu,
  /\b(slotnya|jamnya)\s*(masih)?\s*(kosong|ada|tersedia)\b/i,
];

function containsProhibitedClaim(text) {
  return typeof text === 'string' && PROHIBITED_PATTERNS.some((pattern) => pattern.test(text));
}

function containsUnverifiedAvailabilityClaim(text) {
  return typeof text === 'string' && UNVERIFIED_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(text));
}

function guardReddyReply(reply, options = {}) {
  const bookingUrl = options.bookingUrl || 'https://redboxbarbershop.com/booking.html';
  const blockedProhibitedClaim = containsProhibitedClaim(reply);
  const blockedUnverifiedAvailability = !options.isBackendVerified
    && containsUnverifiedAvailabilityClaim(reply);

  if (!blockedProhibitedClaim && !blockedUnverifiedAvailability) {
    return { sanitizedReply: reply, blockedProhibitedClaim: false, blockedUnverifiedAvailability: false };
  }

  const sanitizedReply = blockedProhibitedClaim
    ? `Booking belum dibuat atau diubah lewat WhatsApp ya Kak. Untuk memilih dan mengonfirmasi reservasi, lanjutkan di website resmi: ${bookingUrl}`
    : `Ketersediaan kapster dan jam perlu dicek real-time di website resmi ya Kak: ${bookingUrl}`;

  return { sanitizedReply, blockedProhibitedClaim, blockedUnverifiedAvailability };
}

module.exports = {
  REDDY_BOOKING_EXECUTION,
  PROHIBITED_PATTERNS,
  UNVERIFIED_AVAILABILITY_PATTERNS,
  containsProhibitedClaim,
  containsUnverifiedAvailabilityClaim,
  guardReddyReply,
};
