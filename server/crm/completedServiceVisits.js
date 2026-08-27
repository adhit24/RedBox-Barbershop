'use strict';

const FALLBACK_DEDUP_WINDOW_MS = 15 * 60 * 1000;
const COMPLETED_BOOKING_STATUSES = new Set(['done', 'completed']);

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
}

function cleanDisplay(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
  return cleaned || null;
}

function calendarDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function eventChronology(dateValue, timeValue) {
  const date = calendarDate(dateValue);
  if (!date) return { date: null, timestamp: null, precision: 'unknown' };

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return { date, timestamp: dateValue.getTime(), precision: 'datetime' };
  }
  if (typeof dateValue === 'string' && /(?:T|\s)\d{1,2}:\d{2}/.test(dateValue)) {
    const parsed = Date.parse(dateValue);
    if (Number.isFinite(parsed)) return { date, timestamp: parsed, precision: 'datetime' };
  }
  if (typeof timeValue === 'string') {
    const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] || 0);
      if (hours < 24 && minutes < 60 && seconds < 60) {
        return {
          date,
          timestamp: Date.parse(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}Z`),
          precision: 'datetime',
        };
      }
    }
  }
  return { date, timestamp: null, precision: 'date_only' };
}

function isFinancialOnlyServiceName(value) {
  const normalized = normalizeText(value)
    .replace(/[+&,/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  const financialOnly = new Set([
    'tip', 'tips', 'gratuity', 'gratuity only',
    'custom amount', 'financial adjustment', 'adjustment',
  ]);
  if (financialOnly.has(normalized)) return true;
  const stripped = normalized
    .replace(/\bcustom amount\b/g, '')
    .replace(/\b(?:tips?|gratuity(?: only)?|financial adjustment|adjustment)\b/g, '')
    .trim();
  return stripped.length === 0;
}

function buildCatalog(services = []) {
  const byId = new Map();
  const byName = new Map();
  for (const service of services) {
    if (!service) continue;
    const name = cleanDisplay(service.name || service.moka_variant_name);
    if (!name || isFinancialOnlyServiceName(name)) continue;
    if (service.id) byId.set(String(service.id), name);
    for (const alias of [service.name, service.moka_variant_name]) {
      const normalized = normalizeText(alias);
      if (normalized) byName.set(normalized, name);
    }
  }
  return { byId, byName };
}

function resolveGenuineService({ serviceId, names = [], catalog }) {
  if (serviceId != null && catalog.byId.has(String(serviceId))) {
    return catalog.byId.get(String(serviceId));
  }
  const genuine = [];
  for (const rawName of names) {
    const display = cleanDisplay(rawName);
    if (!display || isFinancialOnlyServiceName(display)) continue;
    const canonical = catalog.byName.get(normalizeText(display)) || display;
    if (!genuine.some(value => normalizeText(value) === normalizeText(canonical))) genuine.push(canonical);
  }
  return genuine.length > 0 ? genuine.join(', ') : null;
}

function looksLikeInternalId(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text) || /^(?:barber|uuid)[-_][a-z0-9-]+$/i.test(text);
}

function buildBarberResolver(barbers = []) {
  const byId = new Map();
  const byName = new Map();
  for (const barber of barbers) {
    const name = cleanDisplay(barber?.name);
    if (!barber?.id || !name) continue;
    const canonical = { id: String(barber.id), name };
    byId.set(String(barber.id), canonical);
    byName.set(normalizeText(name), canonical);
  }
  return function resolveBarber(id, name) {
    if (id != null && byId.has(String(id))) return byId.get(String(id));
    const display = cleanDisplay(name);
    if (display && byName.has(normalizeText(display))) return byName.get(normalizeText(display));
    if (display && !looksLikeInternalId(display)) return { id: null, name: display };
    return null;
  };
}

function sourceRank(source) {
  if (source === 'schedule') return 3;
  if (source === 'booking') return 2;
  return 1;
}

function sameBoundedFallbackVisit(left, right) {
  if (!Number.isFinite(left.timestamp) || !Number.isFinite(right.timestamp)) return false;
  if (Math.abs(left.timestamp - right.timestamp) > FALLBACK_DEDUP_WINDOW_MS) return false;
  for (const field of ['branch', 'barber', 'service']) {
    if (!left[field] || !right[field]) return false;
    if (normalizeText(left[field]) !== normalizeText(right[field])) return false;
  }
  return true;
}

function mergeCandidate(target, candidate) {
  target.sources.add(candidate.source);
  if (candidate.rank > target.rank) {
    target.date = candidate.date;
    target.timestamp = candidate.timestamp;
    target.precision = candidate.precision;
    target.rank = candidate.rank;
    target.source = candidate.source;
  }
  for (const field of ['branch', 'barber', 'barber_id', 'service']) {
    if (!target[field] && candidate[field]) target[field] = candidate[field];
  }
  return target;
}

function buildCompletedServiceVisits({
  bookings = [], schedules = [], transactions = [], barbers = [], outlets = [], services = [],
} = {}) {
  const catalog = buildCatalog(services);
  const resolveBarber = buildBarberResolver(barbers);
  const outletMap = new Map(outlets.filter(Boolean).map(outlet => [String(outlet.id), cleanDisplay(outlet.name || outlet.slug)]));
  const scheduleById = new Map(schedules.filter(row => row?.id).map(row => [String(row.id), row]));
  const candidates = [];
  let excludedNonServiceCount = 0;

  function addCandidate(candidate) {
    if (!candidate.date) return;
    if (!candidate.service) {
      excludedNonServiceCount += 1;
      return;
    }
    candidates.push(candidate);
  }

  for (const row of schedules) {
    if (normalizeText(row?.status) !== 'completed') continue;
    const chronology = eventChronology(row.start_time || row.created_at, null);
    const barber = resolveBarber(row.barber_id, row.barber_name);
    addCandidate({
      source: 'schedule', rank: sourceRank('schedule'), source_id: row.id || null,
      schedule_key: row.id ? `schedule:${row.id}` : null,
      ...chronology,
      branch: row.outlet_id ? (outletMap.get(String(row.outlet_id)) || cleanDisplay(row.outlet_slug || row.location)) : cleanDisplay(row.outlet_slug || row.location),
      barber: barber?.name || null,
      barber_id: barber?.id || null,
      service: resolveGenuineService({ serviceId: row.service_id, names: [row.service_name, row.service], catalog }),
    });
  }

  for (const row of bookings) {
    if (!COMPLETED_BOOKING_STATUSES.has(normalizeText(row?.status))) continue;
    const chronology = eventChronology(row.date || row.created_at, row.start_time || row.time || row.booking_time);
    const barber = resolveBarber(row.barber_id, row.barber_name);
    addCandidate({
      source: 'booking', rank: sourceRank('booking'), source_id: row.id || null,
      schedule_key: row.schedule_id ? `schedule:${row.schedule_id}` : null,
      ...chronology,
      branch: cleanDisplay(row.location || row.branch_slug || row.branch),
      barber: barber?.name || null,
      barber_id: barber?.id || null,
      service: resolveGenuineService({ serviceId: row.service_id, names: [row.service, row.service_name], catalog }),
    });
  }

  for (const row of transactions) {
    if (normalizeText(row?.status) !== 'completed') continue;
    const chronology = eventChronology(row.created_at, null);
    const items = Array.isArray(row.transaction_items) ? row.transaction_items : [];
    const linkedSchedule = row.schedule_id ? scheduleById.get(String(row.schedule_id)) : null;
    const barber = linkedSchedule ? resolveBarber(linkedSchedule.barber_id, linkedSchedule.barber_name) : null;
    const linkedOutletId = row.outlet_id || linkedSchedule?.outlet_id || null;
    addCandidate({
      source: 'transaction', rank: sourceRank('transaction'), source_id: row.id || null,
      schedule_key: row.schedule_id ? `schedule:${row.schedule_id}` : null,
      ...chronology,
      branch: linkedOutletId ? (outletMap.get(String(linkedOutletId)) || cleanDisplay(row.outlet_slug || row.location || linkedSchedule?.location)) : cleanDisplay(row.outlet_slug || row.location),
      barber: barber?.name || null,
      barber_id: barber?.id || null,
      service: resolveGenuineService({
        serviceId: linkedSchedule?.service_id || null,
        names: [...items.map(item => item?.service_name), linkedSchedule?.service_name, linkedSchedule?.service],
        catalog,
      }),
    });
  }

  const visits = [];
  const bySchedule = new Map();
  for (const candidate of candidates) {
    let target = candidate.schedule_key ? bySchedule.get(candidate.schedule_key) : null;
    if (!target && !candidate.schedule_key) {
      target = visits.find(visit => sameBoundedFallbackVisit(visit, candidate)) || null;
    }
    if (target) {
      mergeCandidate(target, candidate);
      continue;
    }
    const visit = { ...candidate, sources: new Set([candidate.source]) };
    visits.push(visit);
    if (candidate.schedule_key) bySchedule.set(candidate.schedule_key, visit);
  }

  const publicVisits = visits.map(visit => ({
    date: visit.date,
    timestamp: visit.timestamp,
    precision: visit.precision,
    branch: visit.branch || null,
    barber: visit.barber || null,
    barber_id: visit.barber_id || null,
    service: visit.service,
    source: visit.source,
  }));

  return {
    visits: publicVisits,
    metadata: {
      visit_event_count: candidates.length,
      deduplicated_event_count: publicVisits.length,
      excluded_non_service_count: excludedNonServiceCount,
    },
  };
}

function chronologyValue(visit) {
  return Number.isFinite(visit.timestamp)
    ? visit.timestamp
    : Date.parse(`${visit.date}T00:00:00.000Z`);
}

function summarizePreference(visits = [], field, storedFallback = null) {
  const groups = new Map();
  for (const visit of visits) {
    const value = cleanDisplay(visit[field]);
    if (!value) continue;
    const key = normalizeText(value);
    const existing = groups.get(key) || {
      value, id: field === 'barber' ? visit.barber_id || null : null,
      visit_count: 0, last_seen: null, last_seen_value: -1,
    };
    existing.visit_count += 1;
    const recent = chronologyValue(visit);
    if (recent > existing.last_seen_value) {
      existing.last_seen_value = recent;
      existing.last_seen = visit.date;
    }
    groups.set(key, existing);
  }

  const winner = [...groups.values()].sort((left, right) =>
    right.visit_count - left.visit_count
    || right.last_seen_value - left.last_seen_value
    || normalizeText(left.value).localeCompare(normalizeText(right.value), 'id-ID')
    || String(left.id || '').localeCompare(String(right.id || ''))
  )[0];

  if (winner) {
    return {
      value: winner.value,
      basis: 'completed_service_visit_frequency',
      visit_count: winner.visit_count,
      last_seen: winner.last_seen,
      confidence: field !== 'barber' || winner.id ? 'verified' : 'partial',
    };
  }

  const fallback = cleanDisplay(storedFallback);
  if (!fallback || looksLikeInternalId(fallback)) return null;
  return {
    value: fallback,
    basis: 'stored_profile_fallback',
    visit_count: 0,
    last_seen: null,
    confidence: 'unverified',
  };
}

function resolveLastVisit(visits = []) {
  if (visits.length === 0) return null;
  const latestDate = visits.map(visit => visit.date).filter(Boolean).sort().at(-1);
  const sameDay = visits.filter(visit => visit.date === latestDate);
  const fullyTimed = sameDay.every(visit => Number.isFinite(visit.timestamp));
  let contenders = sameDay;
  if (fullyTimed) {
    const latestTimestamp = Math.max(...sameDay.map(visit => visit.timestamp));
    contenders = sameDay.filter(visit => visit.timestamp === latestTimestamp);
  }
  if (contenders.length === 1) return { ...contenders[0], confidence: contenders[0].branch && contenders[0].barber && contenders[0].service ? 'verified' : 'partial' };

  const merged = { date: latestDate, timestamp: null, precision: 'date_only' };
  for (const field of ['branch', 'barber', 'service']) {
    const values = [...new Set(contenders.map(visit => visit[field]).filter(Boolean))];
    merged[field] = values.length === 1 ? values[0] : null;
  }
  const sources = [...new Set(contenders.map(visit => visit.source))];
  merged.source = sources.length === 1 ? sources[0] : 'hybrid';
  const conflicting = ['branch', 'barber', 'service'].some(field => new Set(contenders.map(visit => visit[field]).filter(Boolean)).size > 1);
  merged.confidence = conflicting ? 'conflicting' : (merged.branch && merged.barber && merged.service ? 'verified' : 'partial');
  return merged;
}

module.exports = {
  FALLBACK_DEDUP_WINDOW_MS,
  buildCompletedServiceVisits,
  isFinancialOnlyServiceName,
  resolveLastVisit,
  summarizePreference,
};
