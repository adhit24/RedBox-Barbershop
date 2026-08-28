'use strict';

/**
 * Task 14.1 correction round 2 (Blocker 3) — deterministic real-time barber
 * fact guard. Prompt-only instructions already failed once in production
 * ("Mas Opan ada di cabang hari ini" from nothing but canonical roster
 * data); this is the same class of fix as bookingGuards.js's outbound
 * safeguards, applied to presence/attendance claims instead of booking
 * claims.
 *
 * Locked authority separation:
 *   roster        (barber belongs to a branch)         != scheduled today
 *   planned schedule (barber_working_hours + overrides) != physically present now
 *   attendance/check-in (does not exist anywhere in this codebase)
 *
 * ATTENDANCE_PATTERNS are never allowed — there is no attendance/check-in
 * source to back them, verified schedule or not. PRESENCE_TODAY_PATTERNS are
 * allowed ONLY when the reply uses "dijadwalkan" (scheduled) phrasing AND a
 * verified 'scheduled' fact was actually supplied for this turn — the model
 * cannot bypass the guard by simply choosing that word without real backing.
 */

const ATTENDANCE_PATTERNS = [
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(sudah|udah|telah)\s+(hadir|datang)\b/iu,
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(ada|hadir)\s+(sekarang|saat ini)\b/iu,
  /\bsedang\s+(hadir|di\s*cabang(\s+sekarang)?)\b/i,
];

const PRESENCE_TODAY_PATTERNS = [
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(ada|masuk|tersedia)\s+hari\s*ini\b/iu,
  /\b[\p{L}][\p{L} '.-]{1,40}\s+sedang\s+bertugas\b/iu,
];

function safeUncertainty(verifiedSchedule) {
  const name = verifiedSchedule?.barberName;
  if (verifiedSchedule?.status === 'not_scheduled' && name) {
    return `${name} tidak tercatat dijadwalkan masuk hari ini, Kak.`;
  }
  if (name) {
    return `Aku belum bisa memastikan ${name} masuk hari ini, Kak. Jadwal/kehadiran hari ini belum tersedia dari sistem yang bisa aku verifikasi.`;
  }
  return 'Aku belum bisa memastikan itu dari data yang terverifikasi, Kak. Untuk kepastian jadwal kapster, boleh hubungi cabang langsung ya.';
}

/**
 * @param {string} reply - model-generated text, already past other guards
 * @param {object} options
 * @param {{barberName:string, status:'scheduled'|'not_scheduled', date:string}|null} options.verifiedSchedule
 *   A real schedule fact actually fetched and supplied to the model THIS
 *   turn (never assumed) — see server/services/barberScheduleAuthority.js.
 */
function guardRealtimeBarberFacts(reply, options = {}) {
  const { verifiedSchedule = null } = options;
  if (typeof reply !== 'string' || !reply.trim()) {
    return { sanitizedReply: reply, triggered: false };
  }

  const attendanceViolation = ATTENDANCE_PATTERNS.some((pattern) => pattern.test(reply));
  if (attendanceViolation) {
    return { sanitizedReply: safeUncertainty(verifiedSchedule), triggered: true };
  }

  const presenceViolation = PRESENCE_TODAY_PATTERNS.some((pattern) => pattern.test(reply));
  if (!presenceViolation) {
    return { sanitizedReply: reply, triggered: false };
  }

  const usesScheduledWording = /dijadwalkan/i.test(reply);
  if (verifiedSchedule?.status === 'scheduled' && usesScheduledWording) {
    return { sanitizedReply: reply, triggered: false };
  }

  return { sanitizedReply: safeUncertainty(verifiedSchedule), triggered: true };
}

module.exports = { guardRealtimeBarberFacts, ATTENDANCE_PATTERNS, PRESENCE_TODAY_PATTERNS };
