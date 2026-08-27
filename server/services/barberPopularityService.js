'use strict';

const METRIC = 'booking_selection_count';
const SERVED_VOLUME_METRIC = 'served_customer_count';
const DEFAULT_PERIOD_TYPE = 'rolling_30_days';
const BUSINESS_TIME_ZONE = 'Asia/Jakarta';

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function jakartaCalendarDate(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  const safeInstant = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(safeInstant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function resolvePopularityPeriod(message, now = new Date()) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  const end = jakartaCalendarDate(now);
  let start;
  let type = DEFAULT_PERIOD_TYPE;

  if (/\bbulan\s+ini\b/.test(normalized)) {
    type = 'current_month';
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  } else if (/\bminggu\s+ini\b/.test(normalized)) {
    type = 'current_week';
    const mondayOffset = end.getUTCDay() === 0 ? 6 : end.getUTCDay() - 1;
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - mondayOffset);
  } else {
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 30);
  }

  const hasUnsupportedPeriod = !/\b(30\s+hari\s+terakhir|bulan\s+ini|minggu\s+ini)\b/.test(normalized)
    && /\b(tahun|kemarin|hari\s+ini|minggu\s+terakhir|bulan\s+terakhir|periode)\b/.test(normalized);

  return {
    type,
    start_date: formatDate(start),
    end_date: formatDate(end),
    fallback_used: hasUnsupportedPeriod,
  };
}

function requestedMetric(message) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  if (/\b(melayani|dilayani|terlayani)\b/.test(normalized)) return SERVED_VOLUME_METRIC;
  return METRIC;
}

function emptyResult({ status, branch, period, metric = METRIC, fallbackReason }) {
  return {
    status,
    metric,
    branch,
    period,
    leaders: [],
    eligible_booking_count: 0,
    data_quality: {
      cross_branch_rows_excluded: 0,
      inactive_barber_rows_excluded: 0,
      unknown_barber_rows_excluded: 0,
    },
    fallback_used: true,
    fallback_reason: fallbackReason,
  };
}

async function getBarberPopularity({ supabase, branch, message = '', now = new Date() } = {}) {
  const canonicalBranch = String(branch || '').trim().toLocaleLowerCase('id-ID');
  const period = resolvePopularityPeriod(message, now);
  const metric = requestedMetric(message);

  if (metric === SERVED_VOLUME_METRIC) {
    return emptyResult({
      status: 'unsupported_metric',
      branch: canonicalBranch || 'unknown',
      period,
      metric,
      fallbackReason: 'served_volume_metric_not_supported',
    });
  }

  if (!supabase || typeof supabase.from !== 'function') {
    return emptyResult({
      status: 'unavailable', branch: canonicalBranch || 'unknown', period,
      fallbackReason: 'supabase_client_unavailable',
    });
  }
  if (!canonicalBranch) {
    return emptyResult({
      status: 'unavailable', branch: 'unknown', period, fallbackReason: 'branch_required',
    });
  }

  let bookingsResult;
  try {
    bookingsResult = await supabase
      .from('bookings')
      .select('barber_id,location,date,status')
      .eq('location', canonicalBranch)
      .gte('date', period.start_date)
      .lte('date', period.end_date)
      .not('barber_id', 'is', null)
      .neq('status', 'cancelled');
  } catch (_) {
    return emptyResult({
      status: 'unavailable', branch: canonicalBranch, period,
      fallbackReason: 'bookings_query_failed',
    });
  }
  if (bookingsResult?.error || !Array.isArray(bookingsResult?.data)) {
    return emptyResult({
      status: 'unavailable', branch: canonicalBranch, period,
      fallbackReason: 'bookings_query_failed',
    });
  }

  const bookingRows = bookingsResult.data.filter(row => row
    && row.barber_id != null
    && String(row.location || '').toLocaleLowerCase('id-ID') === canonicalBranch
    && typeof row.date === 'string'
    && row.date >= period.start_date
    && row.date <= period.end_date
    && String(row.status || '').toLocaleLowerCase('id-ID') !== 'cancelled');
  const barberIds = [...new Set(bookingRows.map(row => row.barber_id))];
  if (barberIds.length === 0) {
    return emptyResult({
      status: 'no_data', branch: canonicalBranch, period,
      fallbackReason: 'insufficient_booking_data',
    });
  }

  let barbersResult;
  try {
    barbersResult = await supabase
      .from('barbers')
      .select('id,name,branch,is_active')
      .in('id', barberIds);
  } catch (_) {
    return emptyResult({
      status: 'unavailable', branch: canonicalBranch, period,
      fallbackReason: 'barbers_query_failed',
    });
  }
  if (barbersResult?.error || !Array.isArray(barbersResult?.data)) {
    return emptyResult({
      status: 'unavailable', branch: canonicalBranch, period,
      fallbackReason: 'barbers_query_failed',
    });
  }

  const barberById = new Map(barbersResult.data
    .filter(row => row && row.id != null)
    .map(row => [row.id, row]));
  const counts = new Map();
  let crossBranchRowsExcluded = 0;
  let inactiveBarberRowsExcluded = 0;
  let unknownBarberRowsExcluded = 0;

  for (const booking of bookingRows) {
    const barber = barberById.get(booking.barber_id);
    if (!barber) {
      unknownBarberRowsExcluded += 1;
      continue;
    }
    if (String(barber.branch || '').toLocaleLowerCase('id-ID') !== canonicalBranch) {
      crossBranchRowsExcluded += 1;
      continue;
    }
    // Current-popularity answers rank only barbers who are canonically active today.
    if (barber.is_active !== true) {
      inactiveBarberRowsExcluded += 1;
      continue;
    }
    const name = String(barber.name || '').trim();
    if (!name) {
      unknownBarberRowsExcluded += 1;
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const sorted = [...counts.entries()]
    .map(([barber_name, booking_count]) => ({ barber_name, booking_count }))
    .sort((a, b) => b.booking_count - a.booking_count
      || a.barber_name.localeCompare(b.barber_name, 'id-ID', { sensitivity: 'base' }));
  let previousCount = null;
  let previousRank = 0;
  const leaders = sorted.map((leader, index) => {
    if (leader.booking_count !== previousCount) previousRank = index + 1;
    previousCount = leader.booking_count;
    return { ...leader, rank: previousRank };
  });
  const eligibleBookingCount = leaders.reduce((sum, leader) => sum + leader.booking_count, 0);

  if (eligibleBookingCount === 0) {
    const result = emptyResult({
      status: 'no_data', branch: canonicalBranch, period,
      fallbackReason: 'insufficient_booking_data',
    });
    result.data_quality = {
      cross_branch_rows_excluded: crossBranchRowsExcluded,
      inactive_barber_rows_excluded: inactiveBarberRowsExcluded,
      unknown_barber_rows_excluded: unknownBarberRowsExcluded,
    };
    return result;
  }

  return {
    status: 'success',
    metric: METRIC,
    branch: canonicalBranch,
    period,
    leaders,
    eligible_booking_count: eligibleBookingCount,
    data_quality: {
      cross_branch_rows_excluded: crossBranchRowsExcluded,
      inactive_barber_rows_excluded: inactiveBarberRowsExcluded,
      unknown_barber_rows_excluded: unknownBarberRowsExcluded,
    },
    fallback_used: period.fallback_used,
    fallback_reason: period.fallback_used ? 'unsupported_period_defaulted' : null,
  };
}

module.exports = {
  BUSINESS_TIME_ZONE,
  DEFAULT_PERIOD_TYPE,
  METRIC,
  SERVED_VOLUME_METRIC,
  getBarberPopularity,
  requestedMetric,
  resolvePopularityPeriod,
};
