'use strict';

const HONORIFIC = '(?:(?:mas|mbak|pak|bu|bang|bapak|ibu)\\s+)?';
const BARBER_NAME = "[\\p{L}][\\p{L}'.-]{1,30}";
const NAME_PREFIX = `${HONORIFIC}${BARBER_NAME}`;

const CURRENT_PRESENCE_QUERY = new RegExp(
  `^\\s*${NAME_PREFIX}\\s+(?:`
    + 'ada(?:\\s+(?:kok|di\\s+[\\p{L}][\\p{L} .-]{0,30}))?'
    + '|masuk(?:\\s+(?:gak|nggak|enggak|ga))?'
    + '|kerja|hadir|standby'
    + '|lagi\\s+di\\s+[\\p{L}][\\p{L} .-]{0,30}'
    + '|di\\s+(?:sana|situ|sini)'
    + '|ready|free|available|tersedia'
    + '|bisa\\s+sekarang'
  + ')(?:\\s+(?:hari\\s+ini|sekarang))?\\s*(?:[?!.]+)?\\s*$',
  'iu',
);

const AVAILABILITY_SIGNAL = /\b(ready|free|available|tersedia)\b|\bbisa\s+sekarang\b/i;

/**
 * Classifies only named, current barber presence/availability questions.
 * Bare forms default to the current/today context; explicit future questions
 * intentionally do not match and remain with the existing schedule flow.
 */
function classifyBarberPresenceQuery(text) {
  const raw = String(text || '').trim();
  if (!raw || !CURRENT_PRESENCE_QUERY.test(raw)) {
    return { matched: false, claimType: null, temporalScope: null };
  }
  return {
    matched: true,
    claimType: AVAILABILITY_SIGNAL.test(raw) ? 'availability' : 'presence',
    temporalScope: 'current',
  };
}

module.exports = { classifyBarberPresenceQuery };
