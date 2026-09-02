'use strict';

const HONORIFIC = '(?:(?:mas|mbak|pak|bu|bang|bapak|ibu)\\s+)?';
const BARBER_NAME = "[\\p{L}][\\p{L}'.-]{1,30}";
const NAME_PREFIX = `${HONORIFIC}${BARBER_NAME}`;

const CURRENT_PRESENCE_QUERY = new RegExp(
  `^\\s*(?:${NAME_PREFIX}|(?:si\\s+)?${BARBER_NAME}|barbernya|kapsternya)?\\s*(?:`
    + 'ada(?:\\s+(?:kok|di\\s+[\\p{L}][\\p{L} .-]{0,30}|sekarang))?'
    + '|masuk(?:\\s+(?:gak|nggak|enggak|ga))?'
    + '|kerja|hadir|standby'
    + '|(?:lagi|sedang)\\s+(?:nyukur(?:\\s+(?:atau|n\\/a|gak|nggak|enggak))?|cukur(?:\\s+orang)?|kerja|sibuk|kosong|ada\\s+customer|di\\s+[\\p{L}][\\p{L} .-]{0,30})'
    + '|di\\s+(?:sana|situ|sini)'
    + '|ready|free|available|tersedia'
    + '|bisa\\s+langsung(?:\\s+sekarang)?'
    + '|bisa\\s+sekarang'
  + ')(?:\\s+(?:hari\\s+ini|sekarang))?\\s*(?:[?!.]+)?\\s*$',
  'iu',
);

const GENERAL_PRESENCE_PATTERNS = [
  /\b(?:lagi|sedang)\s+(?:nyukur|cukur(?:\s+orang)?|kerja|sibuk|kosong|ada\s+customer)\b/i,
  /\b(?:bisa\s+langsung|kapsternya\s+ada|barbernya\s+ada)\b/i,
];

// International WhatsApp multilingual contract, correction round 2: the
// contract's own required examples ("Husenさんは今いますか？",
// "¿Está Husen ahí ahora?") are current-presence questions phrased in
// Japanese/Spanish, not Indonesian/English vocabulary — CURRENT_PRESENCE_QUERY
// never matched them, so a presence question in either language silently
// skipped the whole deterministic-authority guard chain. Bounded to the
// contract's own example shapes (name-first for Japanese, verb-first for
// Spanish — its natural word order), not a general JA/ES question parser.
const JAPANESE_PRESENCE_QUERY = new RegExp(
  `^\\s*${BARBER_NAME}\\s*(?:さん)?\\s*(?:は|が)?\\s*(?:今|現在)?\\s*`
    + '(?:います|いますか|いる|いますでしょうか|居ますか|居ますでしょうか)'
    + '\\s*[?？!!]*\\s*$',
  'iu',
);
const SPANISH_PRESENCE_QUERY = new RegExp(
  '^\\s*¿?\\s*(?:está|esta)\\s+'
    + `${BARBER_NAME}`
    + '\\s*(?:ahí|ahi|aquí|aqui)?\\s*(?:ahora)?\\s*\\??\\s*$',
  'iu',
);

const POSITION_INTENT_PATTERNS = [
  /\b(?:kursi|kursi\s*n(?:o|omor)?\s*\d+|posisi|sebelah\s*(?:kiri|kanan|depan|belakang)|di\s+kursi)\b/i,
  /\b(?:siapa\s+yang\s+(?:duduk|berdiri|di\s+kursi))\b/i,
  /\b(?:yang\s+lagi\s+di\s+kursi)\b/i,
];

/**
 * Classifies barber seat / position identity queries (P1-C).
 * Example: "yang di kursi 2 itu siapa?", "yang sebelah kiri Mas siapa?"
 */
function classifyBarberPositionIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return { matched: false };
  const matched = POSITION_INTENT_PATTERNS.some((pattern) => pattern.test(raw));
  if (!matched) return { matched: false };
  return { matched: true, intent: 'barber_position_identity' };
}

/**
 * Classifies only named, current barber presence/availability questions.
 * Bare forms default to the current/today context; explicit future questions
 * intentionally do not match and remain with the existing schedule flow.
 */
function classifyBarberPresenceQuery(text) {
  const raw = String(text || '').trim();
  const positionCheck = classifyBarberPositionIntent(raw);
  if (positionCheck.matched) {
    return { matched: false, isPositionIntent: true, claimType: null, temporalScope: null };
  }
  const matched = raw && (
    CURRENT_PRESENCE_QUERY.test(raw)
    || GENERAL_PRESENCE_PATTERNS.some((p) => p.test(raw))
    || JAPANESE_PRESENCE_QUERY.test(raw)
    || SPANISH_PRESENCE_QUERY.test(raw)
  );
  if (!matched) {
    return { matched: false, claimType: null, temporalScope: null };
  }
  return {
    matched: true,
    claimType: AVAILABILITY_SIGNAL.test(raw) ? 'availability' : 'presence',
    temporalScope: 'current',
  };
}

module.exports = { classifyBarberPresenceQuery, classifyBarberPositionIntent };
