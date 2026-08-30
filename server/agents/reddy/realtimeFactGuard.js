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
 * Final round correction: binding is now CLAIM-LOCAL, not reply-global. A
 * verified fact about barber A no longer authorizes a schedule sentence
 * merely because A's name appears SOMEWHERE in the reply — it must appear
 * inside the specific sentence/clause making the claim. No NLP: sentences
 * are split on . ! ?, then further on commas/"dan"/"serta" so a single
 * compound sentence naming two barbers ("Opan dijadwalkan..., dan Bob juga
 * dijadwalkan...") is evaluated per name-bearing clause, not as one blob.
 * Any sentence containing an unbound or attendance-tier claim is replaced
 * wholesale with one accurate, verified statement about the actual barber
 * the fact is about — legitimate non-claim sentences (roster facts, etc.)
 * are left untouched.
 */

const BARBER_NAME_TOKEN = '(?!(?:dijadwalkan|terjadwal|jadwalnya|scheduled)\\b)[\\p{L}][\\p{L}\'.-]{1,30}';
// Honorific-bound names may occur anywhere in a sentence. A bare name must
// start the sentence (or a comma-delimited clause), preventing ordinary text
// such as "Harga sudah tersedia" from treating "sudah" as a barber name.
const NAMED_BARBER = `(?:(?:mas|mbak|kak|pak|bu|bang|bapak|ibu)\\s+${BARBER_NAME_TOKEN}|(?:^|,)\\s*${BARBER_NAME_TOKEN})`;
const PRESENCE_LOCATION = '(?:sini|sana|situ|cabang|bypass|samadikun|csb(?:\\s+mall)?|sumber|tegal)';

const ATTENDANCE_PATTERNS = [
  new RegExp(`${NAMED_BARBER}\\s+(?:sudah|udah|telah)\\s+(?:hadir|datang)\\b`, 'iu'),
  new RegExp(`${NAMED_BARBER}\\s+(?:ada(?:\\s+(?:di\\s+${PRESENCE_LOCATION}|kok|sekarang|saat\\s+ini))?|hadir|masuk|standby)\\b`, 'iu'),
  new RegExp(`${NAMED_BARBER}\\s+(?:lagi|sedang)\\s+(?:hadir|di\\s+${PRESENCE_LOCATION})\\b`, 'iu'),
];

const AVAILABILITY_PATTERNS = [
  new RegExp(`${NAMED_BARBER}\\s+(?:ready|free|available|tersedia)\\b`, 'iu'),
  new RegExp(`${NAMED_BARBER}\\s+bisa\\s+sekarang\\b`, 'iu'),
];

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function englishNamedBarberClaim(sentence, barberNames = []) {
  return barberNames.filter(Boolean).some((name) => {
    const canonicalName = escapeRegExp(name);
    if (!canonicalName) return false;
    const namedClaim = new RegExp(
      `\\b${canonicalName}\\s+(?:is\\s+)?(?:present|here|working|on\\s+duty|ready|free|available)(?:\\s+now)?\\b`,
      'iu',
    );
    return namedClaim.test(sentence);
  });
}

// Bare presence-today phrasing ("ada/masuk/tersedia hari ini", "sedang
// bertugas") — requires a name-shaped prefix immediately before the verb.
const PRESENCE_TODAY_PATTERNS = [
  new RegExp(`${NAMED_BARBER}\\s+(?:ada|masuk)\\s+hari\\s*ini\\b`, 'iu'),
  new RegExp(`${NAMED_BARBER}\\s+sedang\\s+bertugas\\b`, 'iu'),
];

// Explicit PLANNED SCHEDULE claim vocabulary — its own category since
// "dijadwalkan"/"terjadwal"/"ada jadwal" etc. can appear without the
// verb-directly-before-"hari ini" shape PRESENCE_TODAY_PATTERNS requires.
const SCHEDULE_CLAIM_PATTERNS = [
  /\bdijadwalkan\b/i,
  /\bterjadwal\b/i,
  /\bjadwalnya\s+masuk\b/i,
  /\bada\s+jadwal\b/i,
  /\bschedule[d]?\s+(hari\s*ini|masuk)\b/i,
];

const HONORIFIC_PATTERN = /\b(mas|mbak|kak|pak|bu|bang|bapak|ibu)\b/g;
const CLAUSE_SPLIT_PATTERN = /,|\bdan\b|\bserta\b/i;

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(HONORIFIC_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bounded, deterministic entity binding: no NLP, just "does the verified
 * fact's barber name appear (honorific-stripped, case-insensitive) in this
 * specific text". If the name is missing/empty, binding cannot be
 * established and this returns false — the caller blocks rather than
 * guesses. Called per-clause, never on the whole reply, so a barber
 * mentioned elsewhere in the reply cannot authorize an unrelated claim.
 */
function nameIsBoundInText(text, barberName) {
  const normalizedName = normalizeName(barberName);
  if (!normalizedName) return false;
  const normalizedText = normalizeName(text);
  return normalizedText.includes(normalizedName);
}

function splitIntoSentences(text) {
  return text.match(/[^.!?]+[.!?]*/g) || [text];
}

function splitIntoClauses(sentence) {
  return sentence.split(CLAUSE_SPLIT_PATTERN).map((clause) => clause.trim()).filter(Boolean);
}

function isClaimClause(clause) {
  return SCHEDULE_CLAIM_PATTERNS.some((pattern) => pattern.test(clause))
    || PRESENCE_TODAY_PATTERNS.some((pattern) => pattern.test(clause));
}

/**
 * A sentence is a violation if it makes an attendance-tier claim (never
 * allowed, verified or not), or if ANY of its claim-bearing clauses is not
 * bound to the verified, currently-scheduled barber.
 */
function sentenceHasViolation(sentence, verifiedSchedule, knownBarberNames = []) {
  if (ATTENDANCE_PATTERNS.some((pattern) => pattern.test(sentence))) return true;
  if (AVAILABILITY_PATTERNS.some((pattern) => pattern.test(sentence))) return true;
  if (englishNamedBarberClaim(sentence, knownBarberNames)) return true;

  const claimClauses = splitIntoClauses(sentence).filter(isClaimClause);
  if (claimClauses.length === 0) return false;

  const authorized = verifiedSchedule?.status === 'scheduled';
  return claimClauses.some((clause) => !authorized || !nameIsBoundInText(clause, verifiedSchedule.barberName));
}

/**
 * Builds the one accurate, verified statement to substitute for any removed
 * violation. Schedule-known and attendance-known are reported separately —
 * saying "jadwal/kehadiran belum tersedia" when the schedule IS actually
 * known would itself be inaccurate.
 */
function buildSafeStatement(verifiedSchedule, { attendanceAttempted = false, availabilityAttempted = false } = {}) {
  const name = verifiedSchedule?.barberName;

  if (verifiedSchedule?.status === 'scheduled' && name) {
    const scheduleFact = `${name} memang dijadwalkan masuk hari ini, Kak`;
    if (availabilityAttempted) {
      return `${scheduleFact}, tapi aku belum bisa memastikan beliau sedang free/tersedia sekarang dari data yang terverifikasi.`;
    }
    if (attendanceAttempted) {
      return `${scheduleFact}, tapi aku belum punya data kehadiran/check-in untuk memastikan beliau sudah hadir sekarang.`;
    }
    return `${scheduleFact}.`;
  }

  if (verifiedSchedule?.status === 'not_scheduled' && name) {
    return `${name} tidak tercatat dijadwalkan masuk hari ini, Kak.`;
  }

  if (name) {
    return `Aku belum bisa memastikan jadwal ${name} hari ini dari sistem.`;
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
  const { verifiedSchedule = null, requestedClaim = null, knownBarberNames = [] } = options;
  if (typeof reply !== 'string' || !reply.trim()) {
    return { sanitizedReply: reply, triggered: false };
  }

  const sentences = splitIntoSentences(reply);
  const boundBarberNames = [...knownBarberNames, verifiedSchedule?.barberName].filter(Boolean);
  const violatingSentences = sentences.filter((sentence) => sentenceHasViolation(
    sentence,
    verifiedSchedule,
    boundBarberNames,
  ));

  if (violatingSentences.length === 0) {
    return { sanitizedReply: reply, triggered: false };
  }

  const attendanceAttempted = sentences.some((sentence) => ATTENDANCE_PATTERNS.some((pattern) => pattern.test(sentence)));
  const availabilityAttempted = requestedClaim === 'availability'
    || sentences.some((sentence) => AVAILABILITY_PATTERNS.some((pattern) => pattern.test(sentence)));
  const keptSentences = sentences
    .filter((sentence) => !violatingSentences.includes(sentence))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const safeStatement = buildSafeStatement(verifiedSchedule, { attendanceAttempted, availabilityAttempted });

  const sanitizedReply = [...keptSentences, safeStatement].join('\n').trim();
  return { sanitizedReply, triggered: true };
}

module.exports = {
  guardRealtimeBarberFacts,
  ATTENDANCE_PATTERNS,
  AVAILABILITY_PATTERNS,
  PRESENCE_TODAY_PATTERNS,
  SCHEDULE_CLAIM_PATTERNS,
  nameIsBoundInText,
  englishNamedBarberClaim,
};
