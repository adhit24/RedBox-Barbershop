'use strict';

const { REDBOX_SERVICES } = require('../../../public/js/services-data');
const { resolveCanonicalBarber } = require('../../services/canonicalBarberResolver');

const BRANCH_ALIASES = {
  bypass: ['bypass', 'bipas', 'ahmad yani'],
  samadikun: ['samadikun', 'samdikun'],
  csb: ['csb', 'csb mall', 'mall csb'],
  sumber: ['sumber'],
  tegal: ['tegal'],
};

// Aliases identify customer vocabulary only. The returned entity is always read
// from REDBOX_SERVICES, which remains the canonical service catalog.
const SERVICE_ALIASES = [
  { id: 'gentleman-grooming', pattern: /\b(gentleman grooming|haircut|cukur|potong|pangkas|fade)\b/i },
  { id: 'hair-spa', pattern: /\b(hair spa|creambath|spa rambut)\b/i },
  { id: 'hair-color', pattern: /\b(hair color|coloring|cat rambut|semir)\b/i },
  { id: 'hair-curly', pattern: /\b(hair curly|curly|keriting)\b/i },
  { id: 'down-perm', pattern: /\b(down perm|downperm|root lift)\b/i },
  { id: 'traditional-shave', pattern: /\b(traditional shaving|traditional shave|hot towel shave)\b/i },
  { id: 'shaving', pattern: /\b(shaving|cukur jenggot|cukur kumis)\b/i },
  { id: 'men-massage', pattern: /\b(men massage|massage|pijat)\b/i },
  { id: 'package-royal', pattern: /\b(royal grooming|paket royal)\b/i },
];

function getWibNow() {
  return new Date(Date.now() + (7 * 60 * 60 * 1000));
}

function formatDateIso(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function resolveRelativeDate(text, now = getWibNow()) {
  const lower = String(text || '').toLowerCase();
  if (/\b(besok|esok|tomorrow)\b/.test(lower)) {
    return { date: formatDateIso(new Date(now.getTime() + 86400000)), raw: 'besok' };
  }
  if (/\b(lusa|day after tomorrow)\b/.test(lower)) {
    return { date: formatDateIso(new Date(now.getTime() + 172800000)), raw: 'lusa' };
  }
  if (/\b(hari ini|today)\b/.test(lower)) return { date: formatDateIso(now), raw: 'hari ini' };

  const explicit = lower.match(/\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:[012]\d|3[01]))\b/);
  if (explicit) return { date: explicit[1], raw: explicit[1] };

  const days = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
  const targetDay = days.findIndex((day) => new RegExp(`\\b${day}\\b`, 'i').test(lower));
  if (targetDay >= 0) {
    let delta = targetDay - now.getUTCDay();
    if (delta <= 0) delta += 7;
    return { date: formatDateIso(new Date(now.getTime() + (delta * 86400000))), raw: days[targetDay] };
  }
  return null;
}

function resolveTimeAndPreference(text, priorContext = null) {
  const lower = String(text || '').toLowerCase();
  const periodMatch = lower.match(/\b(pagi|siang|sore|malam)\b/);
  const preference = periodMatch?.[1] || priorContext?.time_preference?.value || null;
  const match = lower.match(/\bjam\s*([0-2]?\d)(?:[:.]([0-5]\d))?\s*(pagi|siang|sore|malam)?\b/);
  if (!match) return { time: null, preference, timeAmbiguous: false };

  let hour = Number(match[1]);
  const minute = match[2] || '00';
  const period = match[3] || preference;
  if ((period === 'sore' || period === 'malam') && hour < 12) hour += 12;
  else if (period === 'siang' && hour < 10) hour += 12;
  else if (period === 'pagi' && hour === 12) hour = 0;
  else if (!period && (hour < 10 || hour > 22)) {
    return { time: null, preference, timeAmbiguous: true };
  }
  return { time: `${String(hour).padStart(2, '0')}:${minute}`, preference: period, timeAmbiguous: false };
}

function resolveBranch(text) {
  const lower = String(text || '').toLowerCase();
  return Object.entries(BRANCH_ALIASES)
    .find(([, aliases]) => aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(lower)))?.[0] || null;
}

function canonicalServiceById(id) {
  const service = REDBOX_SERVICES.find((candidate) => candidate.id === id);
  return service ? { id: service.id, slug: service.id, name: service.name } : null;
}

function resolveService(text) {
  const lower = String(text || '').toLowerCase();
  if (/\b(treatment|perawatan)\b/i.test(lower)
    && !/\b(hair spa|creambath|spa rambut|cat rambut|semir|coloring|keriting|curly|down\s?perm)\b/i.test(lower)) {
    return { id: null, slug: null, name: null, status: 'ambiguous', clarification_required: true };
  }

  const alias = SERVICE_ALIASES.find((entry) => entry.pattern.test(lower));
  if (!alias) return { id: null, slug: null, name: null, status: 'unknown' };
  const canonical = canonicalServiceById(alias.id);
  return canonical
    ? { ...canonical, status: 'verified' }
    : { id: null, slug: null, name: null, status: 'unresolved' };
}

function createEmptyBookingContext() {
  return {
    service: { id: null, slug: null, name: null, value: null, status: 'unknown' },
    branch: { slug: null, value: null, status: 'unknown' },
    barber: { id: null, name: null, branch: null, value: null, status: 'unknown' },
    date: { value: null, raw: null, status: 'unknown' },
    time: { value: null, status: 'unknown' },
    time_preference: { value: null, status: 'unknown' },
    party_size: { value: 1, status: 'unknown' },
    booking_type: { value: 'outlet', status: 'inferred' },
    clarification_required: false,
    clarification_reason: null,
    booking_readiness: 'exploring',
  };
}

function extractBookingContext(text, priorContext = null, options = {}) {
  const context = priorContext ? JSON.parse(JSON.stringify(priorContext)) : createEmptyBookingContext();
  const lower = String(text || '').toLowerCase();
  const explicitBranch = resolveBranch(text);
  if (explicitBranch) context.branch = { slug: explicitBranch, value: explicitBranch, status: 'explicit' };

  const barberResult = resolveCanonicalBarber(text, options.canonicalBarbers || [], explicitBranch || null);
  if (barberResult.status === 'verified') {
    const barber = barberResult.barber;
    context.barber = { id: barber.id, name: barber.name, branch: barber.branch, value: barber.name, status: 'verified' };
    if (!explicitBranch && !context.branch.value) {
      context.branch = { slug: barber.branch, value: barber.branch, status: 'canonical_barber_relationship' };
    }
  } else if (barberResult.status === 'preference_any') {
    context.barber = { id: null, name: null, branch: null, value: 'any', status: 'explicit_preference' };
  } else if (/\b(sama|dengan|kapster|barber)\b/i.test(lower)) {
    context.barber = { id: null, name: null, branch: null, value: null, status: 'unresolved' };
  }

  if (explicitBranch && context.barber.id && context.barber.branch !== explicitBranch) {
    context.barber = { id: null, name: null, branch: null, value: null, status: 'unresolved' };
    context.clarification_required = true;
    context.clarification_reason = 'barber_branch_mismatch';
  }

  const service = resolveService(text);
  if (service.status === 'verified') {
    context.service = { ...service, value: service.name };
  } else if (service.status === 'ambiguous') {
    context.service = { id: null, slug: null, name: null, value: null, status: 'ambiguous' };
    context.clarification_required = true;
    context.clarification_reason = 'ambiguous_service';
  }

  const date = resolveRelativeDate(text);
  if (date) context.date = { value: date.date, raw: date.raw, status: 'explicit' };

  const resolvedTime = resolveTimeAndPreference(text, context);
  if (resolvedTime.time) context.time = { value: resolvedTime.time, status: 'explicit' };
  else if (resolvedTime.timeAmbiguous) {
    context.time = { value: null, status: 'ambiguous' };
    context.clarification_required = true;
    context.clarification_reason = 'ambiguous_time';
  }
  if (resolvedTime.preference) context.time_preference = { value: resolvedTime.preference, status: 'explicit' };

  const party = lower.match(/\b(2|dua|berdua|3|tiga|bertiga)\s*(orang)?\b/);
  if (party) context.party_size = { value: /^(2|dua|berdua)$/.test(party[1]) ? 2 : 3, status: 'explicit' };
  if (/\b(home\s*service|ke rumah|panggil barber)\b/.test(lower)) context.booking_type = { value: 'home_service', status: 'explicit' };
  else if (/\b(wedding|pernikahan|pengantin)\b/.test(lower)) context.booking_type = { value: 'wedding', status: 'explicit' };

  const resolvedCount = [context.service.id, context.branch.value, context.barber.id, context.date.value,
    context.time.value || context.time_preference.value].filter(Boolean).length;
  const bookingIntent = /\b(mau booking|bookingin|pesan slot|amankan slot|mohon booking|tolong booking)\b/.test(lower);
  context.booking_readiness = context.clarification_required ? 'needs_clarification'
    : (bookingIntent || resolvedCount >= 3 ? 'ready_for_handoff'
      : (resolvedCount === 2 ? 'partially_specified' : (resolvedCount === 1 ? 'considering' : 'exploring')));
  return context;
}

function buildPrefilledBookingUrl(context) {
  const params = new URLSearchParams();
  if (context?.branch?.slug) params.set('branch', context.branch.slug);
  if (context?.service?.id) params.set('service_id', context.service.id);
  if (context?.barber?.id) params.set('barber_id', context.barber.id);
  if (context?.date?.value) params.set('date', context.date.value);
  if (context?.time?.value) params.set('time', context.time.value);
  if (!context?.time?.value && context?.time_preference?.value) {
    params.set('time_preference', context.time_preference.value);
  }
  const query = params.toString();
  return `https://redboxbarbershop.com/booking.html${query ? `?${query}` : ''}`;
}

module.exports = {
  BRANCH_ALIASES,
  SERVICE_ALIASES,
  getWibNow,
  formatDateIso,
  resolveRelativeDate,
  resolveTimeAndPreference,
  resolveBranch,
  resolveService,
  createEmptyBookingContext,
  extractBookingContext,
  buildPrefilledBookingUrl,
};
