function classifyDeterministically(message) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  if (/\b(admin|manusia|customer service)\b/.test(normalized) || /bicara (dengan )?orang/.test(normalized)) {
    return { intent: 'human_request', confidence: 1 };
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

module.exports = { classifyDeterministically };
