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

function englishNamedBarberClaimType(sentence, barberNames = []) {
  for (const name of barberNames.filter(Boolean)) {
    const canonicalName = escapeRegExp(name);
    if (!canonicalName) continue;
    const availabilityClaim = new RegExp(
      `\\b${canonicalName}\\s+(?:is\\s+)?(?:ready|free|available)(?:\\s+now)?\\b`,
      'iu',
    );
    if (availabilityClaim.test(sentence)) return 'availability';
    const attendanceClaim = new RegExp(
      `\\b${canonicalName}\\s+(?:is\\s+)?(?:present|here|working|on\\s+duty)(?:\\s+(?:now|today))?\\b`,
      'iu',
    );
    if (attendanceClaim.test(sentence)) return 'attendance';
  }
  return null;
}

function englishNamedBarberClaim(sentence, barberNames = []) {
  return Boolean(englishNamedBarberClaimType(sentence, barberNames));
}

// International WhatsApp multilingual contract, correction round 2 (barber
// presence authority, tests 25/26): mirrors englishNamedBarberClaimType's
// exact name-anchored structure, just in Japanese/Spanish claim vocabulary.
// Bounded to these two languages — the ones the contract's own authority
// tests name — not a general-purpose translation layer.
function japaneseNamedBarberClaimType(sentence, barberNames = []) {
  for (const name of barberNames.filter(Boolean)) {
    const canonicalName = escapeRegExp(name);
    if (!canonicalName) continue;
    const availabilityClaim = new RegExp(
      `${canonicalName}(?:さん)?(?:は|が)[^。！？]{0,20}(?:空いて(?:います)?|対応できます|フリーです)`,
      'iu',
    );
    if (availabilityClaim.test(sentence)) return 'availability';
    const attendanceClaim = new RegExp(
      `${canonicalName}(?:さん)?(?:は|が)[^。！？]{0,20}(?:今[^。！？]{0,10}います|いますよ|出勤して(?:います)?|待機中です)`,
      'iu',
    );
    if (attendanceClaim.test(sentence)) return 'attendance';
  }
  return null;
}

function spanishNamedBarberClaimType(sentence, barberNames = []) {
  for (const name of barberNames.filter(Boolean)) {
    const canonicalName = escapeRegExp(name);
    if (!canonicalName) continue;
    const availabilityClaim = new RegExp(
      `\\b${canonicalName}\\s+est[aá]\\s+(?:disponible|libre)(?:\\s+ahora)?\\b`,
      'iu',
    );
    if (availabilityClaim.test(sentence)) return 'availability';
    const attendanceClaim = new RegExp(
      `\\b${canonicalName}\\s+est[aá]\\s+(?:aqu[ií]|ah[ií]|presente|trabajando)(?:\\s+(?:ahora|hoy))?\\b`,
      'iu',
    );
    if (attendanceClaim.test(sentence)) return 'attendance';
  }
  return null;
}

// Single dispatch point so sentenceHasViolation and the attendance/
// availability roll-up below never need to enumerate languages themselves —
// adding a language means adding one detector here, nowhere else.
const NAMED_BARBER_CLAIM_DETECTORS = [
  englishNamedBarberClaimType,
  japaneseNamedBarberClaimType,
  spanishNamedBarberClaimType,
];

function namedBarberClaimType(sentence, barberNames = []) {
  for (const detector of NAMED_BARBER_CLAIM_DETECTORS) {
    const claimType = detector(sentence, barberNames);
    if (claimType) return claimType;
  }
  return null;
}

function namedBarberClaim(sentence, barberNames = []) {
  return Boolean(namedBarberClaimType(sentence, barberNames));
}

function findKnownBarberName(text, barberNames = []) {
  return barberNames.filter(Boolean).find((name) => {
    const canonicalName = escapeRegExp(name);
    return canonicalName && new RegExp(`\\b${canonicalName}\\b`, 'iu').test(text);
  }) || null;
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
  if (namedBarberClaim(sentence, knownBarberNames)) return true;

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
function buildSafeStatement(verifiedSchedule, {
  attendanceAttempted = false,
  availabilityAttempted = false,
  responseLanguage = 'indonesian',
  barberName = null,
} = {}) {
  const name = verifiedSchedule?.barberName;
  const lang = String(responseLanguage).toLowerCase();

  // The named-presence classifier reaches Indonesian/English/Japanese/
  // Spanish presentation paths (round 2 correction extended the latter two —
  // tests 25/26). Kept bounded to those actual paths; it is not a second
  // multilingual system.
  if (lang === 'english') {
    const englishName = name || barberName;
    if (verifiedSchedule?.status === 'scheduled' && englishName) {
      if (availabilityAttempted) {
        return `${englishName} is scheduled to work today, but I can't verify that he is free or available right now.`;
      }
      if (attendanceAttempted) {
        return `${englishName} is scheduled to work today, but I don't have verified check-in or attendance data to confirm that he is already at the branch.`;
      }
      return `${englishName} is scheduled to work today.`;
    }
    if (verifiedSchedule?.status === 'not_scheduled' && englishName) {
      return `${englishName} is not listed as scheduled to work today.`;
    }
    if (englishName) {
      return `I can't confirm ${englishName}'s current presence from verified data.`;
    }
    return `I can't confirm the barber's current presence from verified data.`;
  }

  if (lang === 'japanese') {
    const japaneseName = name || barberName;
    if (verifiedSchedule?.status === 'scheduled' && japaneseName) {
      if (availabilityAttempted) {
        return `${japaneseName}さんは本日出勤予定ですが、今すぐ対応可能かどうかは確認済みのデータでは分かりかねます。`;
      }
      if (attendanceAttempted) {
        return `${japaneseName}さんは本日出勤予定ですが、今この瞬間の在店状況を確認できるデータはございません。`;
      }
      return `${japaneseName}さんは本日出勤予定です。`;
    }
    if (verifiedSchedule?.status === 'not_scheduled' && japaneseName) {
      return `${japaneseName}さんは本日の出勤予定に入っておりません。`;
    }
    if (japaneseName) {
      return `${japaneseName}さんが今いるかどうか、確認済みのデータでは分かりかねます。`;
    }
    return 'そのスタイリストの現在の状況を、確認済みのデータでは分かりかねます。';
  }

  if (lang === 'spanish') {
    const spanishName = name || barberName;
    if (verifiedSchedule?.status === 'scheduled' && spanishName) {
      if (availabilityAttempted) {
        return `${spanishName} sí está programado para trabajar hoy, pero no puedo confirmar con datos verificados si está disponible en este momento.`;
      }
      if (attendanceAttempted) {
        return `${spanishName} sí está programado para trabajar hoy, pero no tengo datos verificados de asistencia para confirmar que esté ahí ahora mismo.`;
      }
      return `${spanishName} sí está programado para trabajar hoy.`;
    }
    if (verifiedSchedule?.status === 'not_scheduled' && spanishName) {
      return `${spanishName} no figura programado para trabajar hoy.`;
    }
    if (spanishName) {
      return `No puedo confirmar si ${spanishName} está ahí ahora mismo con datos verificados.`;
    }
    return 'No puedo confirmar la presencia actual de ese barbero con datos verificados.';
  }

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
  const {
    verifiedSchedule = null,
    requestedClaim = null,
    knownBarberNames = [],
    responseLanguage = 'indonesian',
    forceSafeResponse = false,
  } = options;
  if (typeof reply !== 'string' || !reply.trim()) {
    return { sanitizedReply: reply, triggered: false };
  }

  const sentences = splitIntoSentences(reply);
  const boundBarberNames = [...knownBarberNames, verifiedSchedule?.barberName].filter(Boolean);
  const violatingSentences = forceSafeResponse
    ? sentences
    : sentences.filter((sentence) => sentenceHasViolation(
      sentence,
      verifiedSchedule,
      boundBarberNames,
    ));

  if (violatingSentences.length === 0) {
    return { sanitizedReply: reply, triggered: false };
  }

  const namedClaimTypes = sentences.map((sentence) => namedBarberClaimType(sentence, boundBarberNames));
  const attendanceAttempted = sentences.some((sentence) => ATTENDANCE_PATTERNS.some((pattern) => pattern.test(sentence)))
    || namedClaimTypes.includes('attendance');
  const availabilityAttempted = requestedClaim === 'availability'
    || sentences.some((sentence) => AVAILABILITY_PATTERNS.some((pattern) => pattern.test(sentence)))
    || namedClaimTypes.includes('availability');
  const keptSentences = sentences
    .filter((sentence) => !violatingSentences.includes(sentence))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const safeStatement = buildSafeStatement(verifiedSchedule, {
    attendanceAttempted,
    availabilityAttempted,
    responseLanguage,
    barberName: findKnownBarberName(violatingSentences.join(' '), boundBarberNames),
  });

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
  englishNamedBarberClaimType,
  japaneseNamedBarberClaimType,
  spanishNamedBarberClaimType,
  namedBarberClaim,
  namedBarberClaimType,
};
