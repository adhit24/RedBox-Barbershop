'use strict';

async function safeSupabaseQuery(query) {
  if (!query) return { data: [], error: null };
  try {
    const res = await query;
    return res && typeof res === 'object' && Array.isArray(res.data) ? res : { data: (Array.isArray(res) ? res : []), error: null };
  } catch (err) {
    return { data: [], error: err?.message || null };
  }
}

/**
 * Redbox Customer 360 Read Service
 * 0-LLM, pure deterministic read layer querying Supabase database tables.
 */

const { resolveCustomerIdentity } = require('./customerIdentity');
const { resolveMembershipTier, isActiveMembership } = require('../membership-policy');
const { normalizeMemberPhone, getMemberPhoneVariants } = require('../member-identity');
const {
  buildCompletedServiceVisits,
  resolveLastVisit,
  summarizePreference,
} = require('./completedServiceVisits');

/**
 * Dedicated CRM points read helper for trusted phone identity (CUSTOMER_SELF).
 * Solves duplicate legacy customer rows by anchoring points to unique member_profiles row.
 * @param {object} supabase - Supabase client
 * @param {string} targetPhone - Raw or canonical phone number
 * @returns {Promise<object>} Points resolution result
 */
async function getCustomerPointsByTrustedPhone(supabase, targetPhone) {
  if (!targetPhone || typeof targetPhone !== 'string' || !targetPhone.trim()) {
    return { found: false, resolution: 'missing_input' };
  }

  const canonical = normalizeMemberPhone(targetPhone);
  if (!canonical || canonical.length < 9) {
    return { found: false, resolution: 'invalid_phone_format' };
  }

  const variants = getMemberPhoneVariants(canonical);
  const profileConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `phone.eq.${digits},phone.eq.+${digits}`;
  }).join(',');

  const customerConditions = variants.map(v => {
    const digits = String(v).replace(/\D/g, '');
    return `wa.eq.${digits},phone_e164.eq.${digits},phone_e164.eq.+${digits}`;
  }).join(',');

  const [profRes, custRes] = await Promise.all([
    supabase.from('member_profiles').select('*').or(profileConditions),
    supabase.from('customers').select('*').or(customerConditions),
  ]);

  if (profRes.error || custRes.error) {
    return {
      found: false,
      resolution: 'db_error',
      error: profRes.error?.message || custRes.error?.message || 'database_error',
    };
  }

  const profileRows = Array.isArray(profRes.data) ? profRes.data : [];
  const customerRows = Array.isArray(custRes.data) ? custRes.data : [];

  // Multiple member_profile records for the same phone MUST fail closed as ambiguous
  if (profileRows.length > 1) {
    return {
      found: false,
      resolution: 'ambiguous',
      reason: 'multiple_member_profile_records',
    };
  }

  const uniqueProfile = profileRows[0] || null;

  if (!uniqueProfile && customerRows.length > 1) {
    const distinctCustIds = new Set(customerRows.map(c => c.id).filter(Boolean));
    if (distinctCustIds.size > 1) {
      const distinctNames = new Set(customerRows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
      if (distinctNames.size > 1) {
        return { found: false, resolution: 'ambiguous', reason: 'conflicting_customer_names' };
      }
    }
  }

  let profilePoints = null;
  if (uniqueProfile && typeof uniqueProfile.total_points === 'number' && uniqueProfile.total_points >= 0) {
    profilePoints = uniqueProfile.total_points;
  }

  const customerPointsList = customerRows
    .map(c => c.points)
    .filter(pts => typeof pts === 'number' && pts >= 0);

  let finalPoints = null;
  let status = 'available';

  if (profilePoints !== null) {
    if (customerPointsList.length > 0) {
      const allMatch = customerPointsList.every(pts => pts === profilePoints);
      if (!allMatch) {
        status = 'ambiguous_balance_conflict';
        finalPoints = null;
      } else {
        finalPoints = profilePoints;
      }
    } else {
      finalPoints = profilePoints;
    }
  } else if (customerPointsList.length > 0) {
    const distinctCustPoints = new Set(customerPointsList);
    if (distinctCustPoints.size > 1) {
      status = 'ambiguous_balance_conflict';
      finalPoints = null;
    } else {
      finalPoints = customerPointsList[0];
    }
  } else if (uniqueProfile || customerRows.length > 0) {
    finalPoints = 0;
  } else {
    return { found: false, resolution: 'not_found' };
  }

  return {
    found: true,
    resolution: uniqueProfile ? 'member_profile_match' : 'customer_phone_match',
    points_balance: finalPoints,
    status: status,
  };
}

/**
 * Formats a Date object or string to YYYY-MM-DD
 */
function formatDateStr(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function extractBookingCalendarDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function normalizeBookingClock(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return {
    value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${match[3] ? `:${String(seconds).padStart(2, '0')}` : ''}`,
    seconds: (hours * 60 * 60) + (minutes * 60) + seconds,
  };
}

function parseAbsoluteRecordTimestamp(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // A timezone-less database timestamp is deliberately not interpreted as local time.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function bookingChronology(record = {}) {
  const scheduledDate = extractBookingCalendarDate(record.date);
  const clock = normalizeBookingClock(record.start_time || record.time || record.booking_time);
  const fallbackTimestamp = parseAbsoluteRecordTimestamp(record.updated_at)
    ?? parseAbsoluteRecordTimestamp(record.created_at);
  const fallbackDate = fallbackTimestamp === null
    ? null
    : new Date(fallbackTimestamp).toISOString().slice(0, 10);
  const date = scheduledDate || fallbackDate;
  const precision = scheduledDate
    ? (clock ? 'scheduled_datetime' : 'scheduled_date')
    : (fallbackTimestamp === null ? 'unknown' : 'record_timestamp');
  const tieBreaker = String(record.id || [
    record.status,
    record.location || record.branch_slug || record.branch,
    record.service,
    record.barber_id || record.barber_name,
  ].map(value => value || '').join('|'));

  return {
    record,
    date,
    time: scheduledDate && clock ? clock.value : null,
    precision,
    sortKey: [
      date || '',
      scheduledDate && clock ? 1 : 0,
      scheduledDate && clock ? clock.seconds : -1,
      fallbackTimestamp ?? -1,
      tieBreaker,
    ],
  };
}

function resolveLatestBooking(bookings = []) {
  return bookings
    .map(bookingChronology)
    .reduce((latest, candidate) => {
      if (!latest) return candidate;
      for (let index = 0; index < candidate.sortKey.length; index += 1) {
        if (candidate.sortKey[index] === latest.sortKey[index]) continue;
        return candidate.sortKey[index] > latest.sortKey[index] ? candidate : latest;
      }
      return latest;
    }, null);
}

/**
 * Calculates frequency mode from an array of strings with deterministic tie-breaking.
 */
function calculateMode(items = [], recentOrder = []) {
  const filtered = items.filter(Boolean);
  if (filtered.length === 0) return null;

  const counts = new Map();
  for (const item of filtered) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  let maxCount = 0;
  let candidates = [];
  for (const [item, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      candidates = [item];
    } else if (count === maxCount) {
      candidates.push(item);
    }
  }

  if (candidates.length === 1) return candidates[0];

  for (const recentItem of recentOrder) {
    if (candidates.includes(recentItem)) {
      return recentItem;
    }
  }

  return candidates.sort()[0];
}

/**
 * Fetches Customer 360 facts.
 * @param {object} supabase - Supabase client instance
 * @param {object} identityInput - { phone, customer_id, user_key }
 * @returns {Promise<object>} Complete versioned Customer360 object
 */
async function getCustomer360(supabase, identityInput = {}) {
  // Step 1: Resolve identity
  const identity = await resolveCustomerIdentity(supabase, identityInput);

  if (identity.resolution === 'db_error') {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: null,
        resolution: 'db_error',
        error: identity.error || 'database_query_error',
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: 'db_error',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  if (identity.resolution === 'ambiguous' || !identity.found) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: null,
        resolution: identity.resolution || 'not_found',
        reason: identity.reason || null,
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: identity.resolution || 'not_found',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  const customerId = identity.customer_id;
  const aliasCustomerIds = Array.isArray(identity.alias_customer_ids) && identity.alias_customer_ids.length > 0
    ? identity.alias_customer_ids
    : (customerId ? [customerId] : []);
  const canonicalPhone = identity.canonical_phone;
  const phoneVariants = canonicalPhone ? getMemberPhoneVariants(canonicalPhone) : [];

  const profileOrConditions = phoneVariants.length > 0
    ? phoneVariants.map(v => {
        const digits = String(v).replace(/\D/g, '');
        return `phone.eq.${digits},phone.eq.+${digits}`;
      }).join(',')
    : (customerId ? `id.eq.${customerId}` : '');

  const customerOrConditions = [];
  if (aliasCustomerIds.length > 0) {
    customerOrConditions.push(...aliasCustomerIds.map(id => `id.eq.${id}`));
  }
  if (phoneVariants.length > 0) {
    customerOrConditions.push(...phoneVariants.map(v => {
      const digits = String(v).replace(/\D/g, '');
      return `wa.eq.${digits},phone_e164.eq.${digits},phone_e164.eq.+${digits}`;
    }));
  }

  const bookingOrConditions = [];
  if (aliasCustomerIds.length > 0) {
    bookingOrConditions.push(...aliasCustomerIds.map(id => `customer_id.eq.${id}`));
  }
  if (phoneVariants.length > 0) {
    bookingOrConditions.push(...phoneVariants.map(v => {
      const digits = String(v).replace(/\D/g, '');
      return `wa.eq.${digits},wa.eq.+${digits}`;
    }));
  }

  const profileQuery = profileOrConditions
    ? supabase.from('member_profiles').select('*').or(profileOrConditions)
    : Promise.resolve({ data: [] });

  const customerQuery = customerOrConditions.length > 0
    ? supabase.from('customers').select('*').or(customerOrConditions.join(','))
    : Promise.resolve({ data: [] });

  const txSelect = supabase.from('transactions').select('*, transaction_items(*)');
  const txQuery = aliasCustomerIds.length > 0
    ? (typeof txSelect.in === 'function'
        ? txSelect.in('customer_id', aliasCustomerIds).eq('status', 'completed').order('created_at', { ascending: false })
        : txSelect.eq('customer_id', customerId).eq('status', 'completed').order('created_at', { ascending: false }))
    : Promise.resolve({ data: [] });

  const bookingQuery = bookingOrConditions.length > 0
    ? supabase.from('bookings').select('*').or(bookingOrConditions.join(',')).order('date', { ascending: false })
    : Promise.resolve({ data: [] });

  const [profRes, custRes, txRes, bookingsRes] = await Promise.all([
    profileQuery,
    customerQuery,
    txQuery,
    bookingQuery,
  ]);

  const txData = txRes.data || [];
  const bkData = bookingsRes.data || [];

  // Bounded metadata lookups for canonical completed-service visits.
  const outletIdsToFetch = Array.from(new Set(txData.map(t => t.outlet_id).filter(Boolean)));
  const scheduleIdsToFetch = Array.from(new Set([
    ...txData.map(t => t.schedule_id),
    ...bkData.map(b => b.schedule_id),
  ].filter(Boolean)));
  const directBookingBarberIds = bkData.map(b => b.barber_id).filter(Boolean);

  const outSel = supabase.from('outlets').select('id, name, slug');
  const outletsQuery = (outletIdsToFetch.length > 0 && typeof outSel.in === 'function')
    ? outSel.in('id', outletIdsToFetch)
    : Promise.resolve({ data: [] });
  const allOutletsQuery = supabase.from('outlets').select('id, name, slug');

  const relatedSchedulesSelect = supabase.from('schedules')
    .select('id, customer_id, outlet_id, barber_id, service_id, service_name, start_time, status, source, created_at');
  const relatedSchedulesQuery = (scheduleIdsToFetch.length > 0 && typeof relatedSchedulesSelect.in === 'function')
    ? relatedSchedulesSelect.in('id', scheduleIdsToFetch)
    : Promise.resolve({ data: [] });

  const customerSchedulesSelect = supabase.from('schedules')
    .select('id, customer_id, outlet_id, barber_id, service_id, service_name, start_time, status, source, created_at');
  const customerSchedulesQuery = (aliasCustomerIds.length > 0 && typeof customerSchedulesSelect.in === 'function')
    ? customerSchedulesSelect.in('customer_id', aliasCustomerIds)
    : Promise.resolve({ data: [] });

  const [outletsRes, allOutletsRes, relatedSchedulesRes, customerSchedulesRes] = await Promise.all([
    safeSupabaseQuery(outletsQuery),
    safeSupabaseQuery(allOutletsQuery),
    safeSupabaseQuery(relatedSchedulesQuery),
    safeSupabaseQuery(customerSchedulesQuery),
  ]);
  const fetchedOutletsMap = new Map();
  for (const outlet of [...(outletsRes.data || []), ...(allOutletsRes.data || [])]) {
    if (outlet?.id && !fetchedOutletsMap.has(outlet.id)) fetchedOutletsMap.set(outlet.id, outlet);
  }
  let fetchedOutlets = [...fetchedOutletsMap.values()];
  const fetchedSchedulesMap = new Map();
  for (const schedule of [...(relatedSchedulesRes.data || []), ...(customerSchedulesRes.data || [])]) {
    if (schedule?.id && !fetchedSchedulesMap.has(schedule.id)) fetchedSchedulesMap.set(schedule.id, schedule);
  }
  const fetchedSchedules = [...fetchedSchedulesMap.values()];
  const missingOutletIds = Array.from(new Set(fetchedSchedules
    .map(schedule => schedule.outlet_id)
    .filter(id => id && !fetchedOutlets.some(outlet => outlet.id === id))));
  if (missingOutletIds.length > 0) {
    const missingOutletsSelect = supabase.from('outlets').select('id, name, slug');
    const missingOutletsQuery = typeof missingOutletsSelect.in === 'function'
      ? missingOutletsSelect.in('id', missingOutletIds)
      : Promise.resolve({ data: [] });
    const missingOutletsRes = await safeSupabaseQuery(missingOutletsQuery);
    fetchedOutlets = [...fetchedOutlets, ...(missingOutletsRes.data || [])];
  }
  const scheduleBarberIds = fetchedSchedules.map(s => s.barber_id).filter(Boolean);

  const storedFavoriteCandidates = [
    ...(Array.isArray(profRes.data) ? profRes.data : []),
    ...(Array.isArray(custRes.data) ? custRes.data : []),
  ].map(row => row?.fav_barber).filter(Boolean);
  const allBarberIdsToFetch = Array.from(new Set([
    ...directBookingBarberIds,
    ...scheduleBarberIds,
    ...storedFavoriteCandidates,
  ]));
  const barbSel = supabase.from('barbers').select('id, name, is_active');
  const barbersQuery = (allBarberIdsToFetch.length > 0 && typeof barbSel.in === 'function')
    ? barbSel.in('id', allBarberIdsToFetch)
    : Promise.resolve({ data: [] });

  // The service catalog is intentionally read as a small canonical allowlist.
  // Unmapped historical snapshots use the explicit financial-only exclusion fallback.
  const servicesSelect = supabase.from('services').select('id, name, moka_variant_name, is_active');
  const servicesQuery = servicesSelect;
  const [barbersRes, servicesRes] = await Promise.all([
    safeSupabaseQuery(barbersQuery),
    safeSupabaseQuery(servicesQuery),
  ]);
  const fetchedBarbers = barbersRes.data || [];
  const fetchedServices = servicesRes.data || [];
  const barberMap = new Map(fetchedBarbers.map(b => [b.id, b.name]));

  if (profRes.error || custRes.error || txRes.error || bookingsRes.error) {
    return {
      version: 'customer360.v0.1',
      identity: {
        customer_found: false,
        customer_id: customerId,
        resolution: 'db_error',
        error: profRes.error?.message || custRes.error?.message || txRes.error?.message || bookingsRes.error?.message || 'database_query_error',
      },
      customer: null,
      membership: null,
      loyalty: null,
      activity: null,
      spending: null,
      preferences: null,
      data_quality: {
        customer_resolution: 'db_error',
        transaction_data: 'unavailable',
        visit_metric: 'unavailable',
      },
    };
  }

  // --- Loyalty Section & Points Anchor ---
  const profileRows = Array.isArray(profRes.data) ? profRes.data : [];
  const customerRows = Array.isArray(custRes.data) ? custRes.data : [];
  const fetchedProfile = profileRows[0] || identity.member_profile_row || null;
  const custRow = customerRows[0] || identity.customer_row || {};

  let totalPoints = 0;
  let lastActivity = fetchedProfile?.updated_at || custRow.updated_at || null;
  let loyaltyStatus = 'available';

  if (fetchedProfile && typeof fetchedProfile.total_points === 'number' && fetchedProfile.total_points >= 0) {
    totalPoints = fetchedProfile.total_points;
    const custPointsList = customerRows.map(c => c.points).filter(p => typeof p === 'number' && p >= 0);
    if (custPointsList.length > 0 && !custPointsList.every(p => p === fetchedProfile.total_points)) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    }
  } else if (customerRows.length > 0) {
    const custPointsList = customerRows.map(c => c.points).filter(p => typeof p === 'number' && p >= 0);
    const distinctPts = new Set(custPointsList);
    if (distinctPts.size > 1) {
      loyaltyStatus = 'ambiguous_balance_conflict';
      totalPoints = null;
    } else if (custPointsList.length > 0) {
      totalPoints = custPointsList[0];
    }
  }

  const loyaltyObj = loyaltyStatus === 'ambiguous_balance_conflict'
    ? { points_balance: null, last_activity: null, status: 'ambiguous_balance_conflict' }
    : { points_balance: totalPoints, last_activity: lastActivity };

  // --- Deduplicate Transactions & Bookings by Primary Key ---
  const rawTx = Array.isArray(txRes.data) ? txRes.data : [];
  const rawBookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

  const transactionsMap = new Map();
  for (const t of rawTx) {
    if (t && t.id && !transactionsMap.has(t.id)) transactionsMap.set(t.id, t);
  }
  const transactions = Array.from(transactionsMap.values());

  const bookingsMap = new Map();
  for (const b of rawBookings) {
    if (b && b.id && !bookingsMap.has(b.id)) bookingsMap.set(b.id, b);
  }
  const bookings = Array.from(bookingsMap.values());

  // --- Profile Section ---
  const customerName = fetchedProfile?.full_name || custRow.name || null;
  const customerObj = {
    customer_id: customerId,
    name: customerName,
    wa_number: canonicalPhone || null,
    phone_e164: identity.phone_e164 || (canonicalPhone ? `+${canonicalPhone}` : null),
    birthday: formatDateStr(fetchedProfile?.birthday || custRow.birthday || custRow.birth_date),
    registration_status: fetchedProfile?.id ? 'registered_member' : 'guest_customer',
    is_registered_member: Boolean(fetchedProfile?.id),
    registration_status_source: fetchedProfile?.id ? 'member_profiles_presence' : 'member_profiles_absence',
    member_since: fetchedProfile?.id && fetchedProfile?.created_at ? formatDateStr(fetchedProfile.created_at) : null,
    member_since_source: fetchedProfile?.id && fetchedProfile?.created_at ? 'member_profiles.created_at' : null,
    created_at: custRow.created_at || fetchedProfile?.created_at || null,
  };

  // --- Membership Section ---
  const rawTier = fetchedProfile?.tier || fetchedProfile?.current_tier || custRow.membership_tier;
  const hasRawTier = Boolean(rawTier && String(rawTier).trim());
  const tier = resolveMembershipTier(rawTier);
  const tierOrigin = hasRawTier ? 'configured' : 'default_baseline';

  const rawStatus = fetchedProfile?.membership_status || custRow.membership_status;
  const hasRawStatus = Boolean(rawStatus && String(rawStatus).trim());

  let planStatus = null;
  let statusSource = 'absent';
  if (hasRawStatus) {
    const isActive = isActiveMembership({
      status: rawStatus,
      startsAt: fetchedProfile?.membership_activated_at || custRow.membership_activated_at,
      expiresAt: fetchedProfile?.membership_expires_at,
    });
    planStatus = isActive ? 'ACTIVE' : 'INACTIVE';
    statusSource = 'membership_policy';
  }

  const activatedAt = fetchedProfile?.membership_activated_at || custRow.membership_activated_at || null;
  const activatedAtSource = fetchedProfile?.membership_activated_at
    ? 'member_profiles.membership_activated_at'
    : (custRow.membership_activated_at ? 'customers.membership_activated_at' : null);

  const membershipObj = {
    status: planStatus,
    status_scope: 'paid_membership_plan',
    plan_status: planStatus,
    status_source: statusSource,
    tier: tier,
    plan_tier: tier,
    tier_origin: tierOrigin,
    activated_at: activatedAt,
    activated_at_source: activatedAtSource,
    expires_at: fetchedProfile?.membership_expires_at || null,
  };

  // --- Transactions / Financial Section ---
  const completedTxCount = transactions.length;
  const totalSpendIdr = transactions.reduce((sum, tx) => sum + (Number(tx.total_amount) || 0), 0);
  const avgTxValue = completedTxCount > 0 ? Math.round(totalSpendIdr / completedTxCount) : null;

  const spendingObj = {
    transaction_count: completedTxCount,
    total_spend_idr: totalSpendIdr,
    average_transaction_value_idr: avgTxValue,
  };

      // --- Activity / Visit Section ---
  const doneBookings = bookings.filter(b => b.status === 'done');
  const cancelledBookings = bookings.filter(b => b.status === 'cancelled');
  const pendingBookings = bookings.filter(b => ['pending', 'confirmed'].includes(b.status));
  const latestBookingResolution = resolveLatestBooking(bookings);
  const latestBooking = latestBookingResolution?.record || null;
  let latestBookingBarber = latestBooking?.barber_name || null;
  if (!latestBookingBarber && latestBooking?.barber_id && barberMap.has(latestBooking.barber_id)) {
    latestBookingBarber = barberMap.get(latestBooking.barber_id);
  }
  // One canonical event set powers completed-visit chronology and behavioral preferences.
  // Precedence is schedule -> booking -> transaction; explicit schedule_id linkage deduplicates
  // first, with a bounded 15-minute exact-attribute fallback only for unlinked records.
  const completedVisitModel = buildCompletedServiceVisits({
    bookings,
    schedules: fetchedSchedules,
    transactions,
    barbers: fetchedBarbers,
    outlets: fetchedOutlets,
    services: fetchedServices,
  });
  const completedServiceVisits = completedVisitModel.visits;
  const visitDates = Array.from(new Set(completedServiceVisits.map(event => event.date))).sort();
  const firstVisit = visitDates[0] || null;
  const lastVisitEvent = resolveLastVisit(completedServiceVisits);
  const lastVisit = lastVisitEvent?.date || null;
  const lastVisitBranch = lastVisitEvent?.branch || null;
  const lastVisitBarber = lastVisitEvent?.barber || null;
  const lastVisitService = lastVisitEvent?.service || null;
  const lastVisitSource = lastVisitEvent?.source || null;
  const lastVisitConfidence = lastVisitEvent?.confidence || null;
  const lastVisitEventObj = lastVisitEvent ? {
    date: lastVisit,
    branch: lastVisitBranch,
    barber: lastVisitBarber,
    service: lastVisitService,
    source: lastVisitSource,
    confidence: lastVisitConfidence,
  } : null;

  let daysSinceLastVisit = null;
  if (lastVisit) {
    const diffMs = Date.now() - new Date(lastVisit).getTime();
    daysSinceLastVisit = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  const activityObj = {
    first_visit: firstVisit,
    last_visit: lastVisit,
    last_visit_branch: lastVisitBranch,
    last_visit_barber: lastVisitBarber,
    last_visit_service: lastVisitService,
    last_visit_source: lastVisitSource,
    last_visit_confidence: lastVisitConfidence,
    last_visit_event: lastVisitEventObj,
    latest_booking_date: latestBookingResolution?.date || null,
    latest_booking_time: latestBookingResolution?.time || null,
    latest_booking_branch: latestBooking?.location || latestBooking?.branch_slug || latestBooking?.branch || null,
    latest_booking_barber: latestBookingBarber,
    latest_booking_service: latestBooking?.service || null,
    latest_booking_status: latestBooking?.status || null,
    days_since_last_visit: daysSinceLastVisit,
    completed_booking_count: doneBookings.length,
    cancelled_booking_count: cancelledBookings.length,
    pending_booking_count: pendingBookings.length,
    completed_transaction_count: completedTxCount,
    visit_metric_status: 'caveated',
    repeat_customer: completedServiceVisits.length > 1,
  };

  // Behavioral evidence always beats stored profile fields. Stored favorites are
  // deliberately unverified fallbacks only when no valid completed visit exists.
  const storedFavoriteRaw = fetchedProfile?.fav_barber || custRow.fav_barber || null;
  const storedFavoriteBarber = barberMap.get(storedFavoriteRaw) || storedFavoriteRaw;
  const preferencesObj = {
    favorite_branch: summarizePreference(completedServiceVisits, 'branch'),
    favorite_barber: summarizePreference(completedServiceVisits, 'barber', storedFavoriteBarber),
    favorite_service: summarizePreference(completedServiceVisits, 'service'),
  };

  return {
    version: 'customer360.v0.1',
    identity: {
      customer_found: true,
      customer_id: customerId,
      resolution: identity.resolution,
    },
    customer: customerObj,
    membership: membershipObj,
    loyalty: loyaltyObj,
    activity: activityObj,
    spending: spendingObj,
    preferences: preferencesObj,
    data_quality: {
      customer_resolution: 'resolved',
      transaction_data: 'available',
      visit_metric: completedServiceVisits.length > 0 ? 'verified_completed_service_visits' : 'no_valid_completed_service_visits',
      ...completedVisitModel.metadata,
      favorite_barber_basis: preferencesObj.favorite_barber?.basis || null,
      favorite_barber_confidence: preferencesObj.favorite_barber?.confidence || null,
    },
  };
}

module.exports = {
  getCustomer360,
  getCustomerPointsByTrustedPhone,
  formatDateStr,
  calculateMode,
};
