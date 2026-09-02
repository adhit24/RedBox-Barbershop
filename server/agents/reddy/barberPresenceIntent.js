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

const AVAILABILITY_SIGNAL =
  /\b(ready|free|available|tersedia|kosong)\b|\bbisa\s+(?:langsung|sekarang)\b|空いて|フリー|対応できます|disponible|libre/i;

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
    + '(?:います|いますか|いる|いますでしょうか|居ますか|居ますでしょうか|空いていますか|空いてる|フリー|対応できますか)'
    + '\\s*[?？!!]*\\s*$',
  'iu',
);
const SPANISH_PRESENCE_QUERY = new RegExp(
  '^\\s*¿?\\s*(?:está|esta)\\s+'
    + `${BARBER_NAME}`
    + '\\s*(?:ahí|ahi|aquí|aqui|disponible|libre)?\\s*(?:ahora)?\\s*\\??\\s*$',
  'iu',
);

const SPATIAL_SEAT_INDICATORS = /\b(kursi\s*(?:no\.?|nomor)?\s*\d+|sebelah\s*(?:kiri|kanan|depan|belakang)|bangku\s*\d*|posisi\s*(?:kapster|barber))\b/i;
const PERSON_IDENTITY_INDICATORS = /\b(siapa|mas\s+siapa|nama(?:nya)?|bukan)\b/i;

const DIRECT_POSITION_IDENTITY_PATTERNS = [
  /\b(?:kursi\s*(?:no\.?|nomor)?\s*\d+)\b.*\b(?:siapa|nama)\b/i,
  /\b(?:sebelah\s*(?:kiri|kanan|depan|belakang))\b.*\b(?:siapa|nama|mas|bukan)\b/i,
  /\bposisi\s*(?:kapster|barber)\b/i,
  /\b(?:yang\s+(?:lagi\s+)?di\s+kursi)\b.*\b(?:siapa|nama)\b/i,
];

/**
 * Classifies barber seat / position identity queries (P1-C).
 * Positive: "yang di kursi 2 itu siapa?", "kapster di kursi 3 namanya siapa?", "yang sebelah kiri Mas siapa?"
 * Negative: "posisi cabang Tegal di mana?", "posisi booking saya bagaimana?", "kursi tunggu ada?"
 */
function classifyBarberPositionIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return { matched: false };

  // Guard against generic location, booking status, or facility false-positives
  const isGenericLocationOrBooking = /\b(?:posisi\s*(?:cabang|outlet|lokasi|toko|booking|pesanan|antrian)|kursi\s*tunggu)\b/i.test(raw);
  if (isGenericLocationOrBooking) return { matched: false };

  const hasDirectPattern = DIRECT_POSITION_IDENTITY_PATTERNS.some((p) => p.test(raw));
  const hasSpatial = SPATIAL_SEAT_INDICATORS.test(raw);
  const hasIdentity = PERSON_IDENTITY_INDICATORS.test(raw);

  if (hasDirectPattern || (hasSpatial && hasIdentity)) {
    return { matched: true, intent: 'barber_position_identity' };
  }
  return { matched: false };
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
