'use strict';

/**
 * Task 14.1 correction — deterministic real-time barber fact guard.
 * Prompt-only instructions already failed once in production ("Mas Opan ada
 * di cabang hari ini" from nothing but canonical roster data); this is the
 * same class of fix as bookingGuards.js's outbound safeguards, applied to
 * presence/schedule/attendance claims instead of booking claims.
 *
 * Locked authority separation:
 *   roster            (barber belongs to a branch)          != scheduled today
 *   planned schedule  (barber_working_hours + overrides)     != physically present now
 *   attendance/check-in (does not exist anywhere in this codebase)
 *
 * Round 3 correction: a SCHEDULE claim ("dijadwalkan", "terjadwal", "ada
 * jadwal hari ini"...) now requires BOTH a verified 'scheduled' fact for
 * THIS turn AND that the fact's barberName is the one actually named in the
 * claim — round 2 checked only the former, so a verified fact about barber A
 * could silently authorize a claim about barber B. No NLP: binding is a
 * bounded, honorific-stripped substring check; if it cannot be established,
 * the guard blocks rather than guesses.
 */

const ATTENDANCE_PATTERNS = [
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(sudah|udah|telah)\s+(hadir|datang)\b/iu,
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(ada|hadir)\s+(sekarang|saat ini)\b/iu,
  /\bsedang\s+(hadir|di\s*cabang(\s+sekarang)?)\b/i,
];

// Bare presence-today phrasing ("ada/masuk/tersedia hari ini", "sedang
// bertugas") — requires a name-shaped prefix immediately before the verb.
const PRESENCE_TODAY_PATTERNS = [
  /\b[\p{L}][\p{L} '.-]{1,40}\s+(ada|masuk|tersedia)\s+hari\s*ini\b/iu,
  /\b[\p{L}][\p{L} '.-]{1,40}\s+sedang\s+bertugas\b/iu,
];

// Explicit PLANNED SCHEDULE claim vocabulary — deliberately its own category
// (not folded into PRESENCE_TODAY_PATTERNS) since "dijadwalkan"/"terjadwal"/
// "ada jadwal" etc. can appear without the verb-directly-before-"hari ini"
// shape PRESENCE_TODAY_PATTERNS requires (e.g. "Opan ada jadwal hari ini"
// has "jadwal" between "ada" and "hari ini", which does not match the bare
// presence pattern but is unambiguously a schedule claim).
const SCHEDULE_CLAIM_PATTERNS = [
  /\bdijadwalkan\b/i,
  /\bterjadwal\b/i,
  /\bjadwalnya\s+masuk\b/i,
  /\bada\s+jadwal\b/i,
  /\bschedule[d]?\s+(hari\s*ini|masuk)\b/i,
];

const HONORIFIC_PATTERN = /\b(mas|mbak|kak|pak|bu|bang|bapak|ibu)\b/g;

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(HONORIFIC_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bounded, deterministic entity binding: no NLP, just "does the verified
 * fact's barber name appear (honorific-stripped, case-insensitive) in the
 * reply". If the name is missing/empty, binding cannot be established and
 * this returns false — the caller blocks rather than guesses.
 */
function nameIsBoundInReply(reply, barberName) {
  const normalizedName = normalizeName(barberName);
  if (!normalizedName) return false;
  const normalizedReply = normalizeName(reply);
  return normalizedReply.includes(normalizedName);
}

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

  // Attendance-tier claims are NEVER allowed — no attendance/check-in source
  // exists, verified schedule or not.
  const attendanceViolation = ATTENDANCE_PATTERNS.some((pattern) => pattern.test(reply));
  if (attendanceViolation) {
    return { sanitizedReply: safeUncertainty(verifiedSchedule), triggered: true };
  }

  const makesScheduleClaim = SCHEDULE_CLAIM_PATTERNS.some((pattern) => pattern.test(reply))
    || PRESENCE_TODAY_PATTERNS.some((pattern) => pattern.test(reply));
  if (!makesScheduleClaim) {
    return { sanitizedReply: reply, triggered: false };
  }

  const authorized = verifiedSchedule?.status === 'scheduled'
    && nameIsBoundInReply(reply, verifiedSchedule.barberName);
  if (authorized) {
    return { sanitizedReply: reply, triggered: false };
  }

  return { sanitizedReply: safeUncertainty(verifiedSchedule), triggered: true };
}

module.exports = {
  guardRealtimeBarberFacts,
  ATTENDANCE_PATTERNS,
  PRESENCE_TODAY_PATTERNS,
  SCHEDULE_CLAIM_PATTERNS,
  nameIsBoundInReply,
};
