'use strict';

const { normalizeMemberPhone } = require('../member-identity');
const { calculateMode } = require('./customer360Service');

const DORMANT_THRESHOLD_DAYS = 60;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TREND_MONTHS = 6;

function identityKey(row) {
  if (row.phone) {
    const canonical = normalizeMemberPhone(row.phone);
    if (canonical) return `phone:${canonical}`;
  }
  return `name:${(row.name || 'unknown').trim().toLowerCase()}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function computeCustomerSegments(visitRows = [], options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const branchFilter = options.branch && options.branch !== 'all' ? options.branch : null;
  const limit = Math.min(Math.max(1, options.limit || DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(0, options.offset || 0);
  const search = (options.search || '').trim().toLowerCase();

  const scopedRows = branchFilter ? visitRows.filter(r => r.branch === branchFilter) : visitRows;

  const groups = new Map();
  for (const row of scopedRows) {
    const key = identityKey(row);
    if (!groups.has(key)) {
      groups.set(key, { key, name: row.name || 'Tidak diketahui', visits: [] });
    }
    groups.get(key).visits.push(row);
  }

  const allGaps = [];
  const monthBuckets = new Map();
  const branchModeCounts = new Map();
  const branchTotalCustomers = new Map();
  const branchRepeatCustomers = new Map();
  const barberVolumeCounts = new Map();
  const serviceVolumeCounts = new Map();
  let minDate = null;
  let maxDate = null;

  const customers = [];
  for (const group of groups.values()) {
    const sorted = [...group.visits].sort((a, b) => a.date.localeCompare(b.date));
    const firstVisit = sorted[0].date;
    const lastVisit = sorted[sorted.length - 1].date;
    const totalVisits = sorted.length;

    if (!minDate || firstVisit < minDate) minDate = firstVisit;
    if (!maxDate || lastVisit > maxDate) maxDate = lastVisit;

    for (let i = 1; i < sorted.length; i++) {
      allGaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    // Only months this customer could plausibly touch: from their first visit
    // month through their last visit month. Bounds the loop by this
    // customer's own visit span, not the full cross-customer month range.
    const firstMonth = monthOf(firstVisit);
    const visitedMonths = new Set(sorted.map(v => monthOf(v.date)));
    for (const month of visitedMonths) {
      if (!monthBuckets.has(month)) monthBuckets.set(month, new Set());
      const set = monthBuckets.get(month);
      if (month === firstMonth) {
        set.add(`new:${group.key}`);
      } else if (month > firstMonth) {
        set.add(`repeat:${group.key}`);
      }
    }

    const favoriteBranch = calculateMode(
      sorted.map(v => v.branch).filter(Boolean),
      sorted.map(v => v.branch).filter(Boolean).reverse()
    );
    const favoriteBarber = calculateMode(
      sorted.map(v => v.barberName).filter(Boolean),
      sorted.map(v => v.barberName).filter(Boolean).reverse()
    );

    if (favoriteBranch) {
      branchModeCounts.set(favoriteBranch, (branchModeCounts.get(favoriteBranch) || 0) + 1);
      branchTotalCustomers.set(favoriteBranch, (branchTotalCustomers.get(favoriteBranch) || 0) + 1);
      if (totalVisits >= 2) {
        branchRepeatCustomers.set(favoriteBranch, (branchRepeatCustomers.get(favoriteBranch) || 0) + 1);
      }
    }
    for (const v of sorted) {
      if (v.barberName) barberVolumeCounts.set(v.barberName, (barberVolumeCounts.get(v.barberName) || 0) + 1);
      if (v.service) serviceVolumeCounts.set(v.service, (serviceVolumeCounts.get(v.service) || 0) + 1);
    }

    const daysSinceLastVisit = daysBetween(lastVisit, today);
    const engagementStatus = daysSinceLastVisit >= DORMANT_THRESHOLD_DAYS ? 'dormant' : 'active';
    const visitCountTier = totalVisits >= 10 ? 'loyal' : totalVisits >= 3 ? 'repeat' : 'new';

    customers.push({
      customer_key: group.key,
      name: group.name,
      first_visit: firstVisit,
      last_visit: lastVisit,
      total_visits: totalVisits,
      favorite_branch: favoriteBranch,
      favorite_barber: favoriteBarber,
      visit_count_tier: visitCountTier,
      engagement_status: engagementStatus,
    });
  }

  const filteredCustomers = search
    ? customers.filter(c => c.name.toLowerCase().includes(search))
    : customers;
  const sortedCustomers = [...filteredCustomers].sort((a, b) => b.total_visits - a.total_visits);
  const page = sortedCustomers.slice(offset, offset + limit);

  const segmentCounts = { loyal: 0, repeat: 0, new: 0, dormant: 0 };
  for (const c of customers) {
    if (c.engagement_status === 'dormant') segmentCounts.dormant++;
    else segmentCounts[c.visit_count_tier]++;
  }

  const kpis = {
    active_customers: customers.filter(c => c.engagement_status === 'active').length,
    new_customers: customers.filter(c => c.visit_count_tier === 'new').length,
    repeat_customers: customers.filter(c => c.total_visits >= 2).length,
    loyal_customers: customers.filter(c => c.visit_count_tier === 'loyal').length,
    dormant_customers: segmentCounts.dormant,
    avg_visit_interval_days: allGaps.length > 0
      ? Math.round((allGaps.reduce((s, g) => s + g, 0) / allGaps.length) * 10) / 10
      : null,
  };

  const monthsToShow = [];
  const anchor = new Date(`${today}T00:00:00.000Z`);
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1));
    monthsToShow.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const new_vs_repeat_trend = monthsToShow.map(month => {
    const set = monthBuckets.get(month) || new Set();
    let newCount = 0, repeatCount = 0;
    for (const entry of set) {
      if (entry.startsWith('new:')) newCount++;
      else if (entry.startsWith('repeat:')) repeatCount++;
    }
    return { month, new: newCount, repeat: repeatCount };
  });

  const by_branch = [...branchModeCounts.entries()]
    .map(([branch, count]) => ({
      branch,
      count,
      total_customers: branchTotalCustomers.get(branch) || 0,
      repeat_customers: branchRepeatCustomers.get(branch) || 0,
    }))
    .sort((a, b) => b.count - a.count);

  const favorite_barbers = [...barberVolumeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const favorite_services = [...serviceVolumeCounts.entries()]
    .map(([service_name, count]) => ({ service_name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    data_coverage: {
      from: minDate,
      to: maxDate,
      classification_basis: "completed bookings (status='done') plus completed Moka transactions (status='completed') linked to a known customer via customer_id; excludes anonymous/unattributed transactions with no linked customer",
    },
    kpis,
    segments: [
      { key: 'loyal', label: 'Loyal (10+ visit)', count: segmentCounts.loyal },
      { key: 'repeat', label: 'Repeat (3-9 visit)', count: segmentCounts.repeat },
      { key: 'new', label: 'Baru (1-2 visit)', count: segmentCounts.new },
      { key: 'dormant', label: 'Dormant (60d+)', count: segmentCounts.dormant },
    ],
    new_vs_repeat_trend,
    by_branch,
    favorite_barbers,
    favorite_services,
    customers: {
      items: page,
      total: sortedCustomers.length,
      limit,
      offset,
    },
  };
}

async function fetchVisitRows(supabase) {
  const [bookingsRes, transactionsRes, barbersRes, outletsRes] = await Promise.all([
    supabase.from('bookings').select('wa, name, customer_id, barber_id, service, location, date').eq('status', 'done'),
    supabase.from('transactions').select('id, customer_id, outlet_id, schedule_id, created_at').eq('status', 'completed').not('customer_id', 'is', null),
    supabase.from('barbers').select('id, name'),
    supabase.from('outlets').select('id, slug, name'),
  ]);

  const bookings = bookingsRes.data || [];
  const transactions = transactionsRes.data || [];
  const barbers = barbersRes.data || [];
  const outlets = outletsRes.data || [];
  const barberNameById = new Map(barbers.map(b => [b.id, b.name]));
  const outletSlugById = new Map(outlets.map(o => [o.id, o.slug]));

  const customerIds = [...new Set(transactions.map(t => t.customer_id).filter(Boolean))];
  const scheduleIds = [...new Set(transactions.map(t => t.schedule_id).filter(Boolean))];
  const transactionIds = transactions.map(t => t.id);

  const [customersRes, schedulesRes, itemsRes] = await Promise.all([
    customerIds.length ? supabase.from('customers').select('id, wa, phone_e164, name').in('id', customerIds) : Promise.resolve({ data: [] }),
    scheduleIds.length ? supabase.from('schedules').select('id, barber_id').in('id', scheduleIds) : Promise.resolve({ data: [] }),
    transactionIds.length ? supabase.from('transaction_items').select('transaction_id, service_name').in('transaction_id', transactionIds) : Promise.resolve({ data: [] }),
  ]);

  const customerById = new Map((customersRes.data || []).map(c => [c.id, c]));
  const barberIdByScheduleId = new Map((schedulesRes.data || []).map(s => [s.id, s.barber_id]));
  const serviceByTransactionId = new Map((itemsRes.data || []).map(i => [i.transaction_id, i.service_name]));

  const visitRows = [];
  for (const b of bookings) {
    visitRows.push({
      phone: b.wa || null,
      name: b.name || null,
      date: b.date,
      branch: b.location || null,
      barberId: b.barber_id || null,
      barberName: b.barber_id ? barberNameById.get(b.barber_id) || null : null,
      service: b.service || null,
      source: 'booking',
    });
  }
  for (const t of transactions) {
    const customer = customerById.get(t.customer_id);
    const barberId = t.schedule_id ? barberIdByScheduleId.get(t.schedule_id) : null;
    visitRows.push({
      phone: customer?.wa || customer?.phone_e164 || null,
      name: customer?.name || null,
      date: String(t.created_at || '').slice(0, 10),
      branch: t.outlet_id ? outletSlugById.get(t.outlet_id) || null : null,
      barberId: barberId || null,
      barberName: barberId ? barberNameById.get(barberId) || null : null,
      service: serviceByTransactionId.get(t.id) || null,
      source: 'transaction',
    });
  }
  return visitRows;
}

module.exports = { computeCustomerSegments, fetchVisitRows };
