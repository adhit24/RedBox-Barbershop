// server/routes/adminCrm.js
'use strict';
const express = require('express');
const { membershipStateForSync, isActiveMembership } = require('../membership-policy');
const {
  TIER_PRICES,
  expirePendingMembershipRegistrations,
  getTierPrice,
  isTierUpgrade,
  normalizePhone,
  toPublicRegistration,
  validatePaymentInput,
} = require('../services/membershipRegistration');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

// ── Moka CSV import: outlet name → slug ─────────────────────────────────────
const OUTLET_SLUG_MAP = {
  'redbox barbershop bypass':    'bypass',
  'redbox barbershop samadikun': 'samadikun',
  'redbox barbershop csb':       'csb',
  'redbox barbershop sumber':    'sumber',
  'redbox barbershop tegal':     'tegal',
  'parker gentlemens barbershop': 'parker',
};

function parseCSVRow(line) {
  const fields = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim()); field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseMokaDate(raw) {
  // "06-06-2026" (DD-MM-YYYY) → "2026-06-06"
  const [d, m, y] = raw.split('-');
  return `${y}-${m}-${d}`;
}

function extractBarberItems(itemsRaw) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of itemsRaw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  const items = [];
  for (const part of parts) {
    const parenIdx = part.indexOf('(');
    if (parenIdx < 0) continue; // no parens = product/drink, skip
    const name    = part.slice(0, parenIdx).trim();
    const service = part.slice(parenIdx + 1, part.lastIndexOf(')')).trim();
    if (name && service) items.push({ name, service });
  }
  return items;
}

function editDist(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i + j));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function matchBarberName(csvName, barbers, preferBranch) {
  const lower = csvName.toLowerCase().trim();
  // 1. Exact first-word match — same branch first
  for (const b of barbers) {
    if (preferBranch && b.branch !== preferBranch) continue;
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  // 2. Exact first-word match — any branch
  for (const b of barbers) {
    const fw = b.name.split(' ')[0].toLowerCase();
    if (lower === fw || lower === b.name.toLowerCase()) return b;
  }
  // 3. Best edit distance ≤ 2 within the same branch only. Never assign a
  // Parker/unknown-branch item to a similarly named barber elsewhere.
  const fuzzyCandidates = preferBranch
    ? barbers.filter(b => b.branch === preferBranch)
    : barbers;
  let best = null, bestDist = 3;
  for (const b of fuzzyCandidates) {
    const fw = b.name.split(' ')[0].toLowerCase();
    const d  = editDist(lower, fw);
    if (d < bestDist || (d === bestDist && preferBranch && b.branch === preferBranch)) {
      bestDist = d; best = b;
    }
  }
  return best;
}

function getAuthenticatedStaffId(req) {
  const candidate = req.adminAuth?.staffId || req.admin?.id || req.user?.id;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

const MEMBERSHIP_ADMIN_BRANCHES = new Set(['bypass', 'sumber', 'samadikun', 'csb', 'tegal']);

function getVerifiedMembershipAdmin(req) {
  const auth = req.adminAuth;
  if (!auth?.sessionVerified || !['owner', 'branch_admin'].includes(auth.role)) return null;
  if (auth.role === 'owner') return { role: 'owner', branch: null, staffId: auth.staffId };
  const branch = typeof auth.branch === 'string' ? auth.branch.trim().toLowerCase() : '';
  if (!MEMBERSHIP_ADMIN_BRANCHES.has(branch)) return null;
  return { role: 'branch_admin', branch, staffId: auth.staffId };
}

function resolveMembershipActivationBranch(access, requestedBranch) {
  const branch = typeof requestedBranch === 'string' ? requestedBranch.trim().toLowerCase() : '';
  if (!branch) return { status: 400, error: 'branch required' };
  if (access.role === 'branch_admin') {
    return branch === access.branch
      ? { branch: access.branch }
      : { status: 403, error: 'branch access denied' };
  }
  return MEMBERSHIP_ADMIN_BRANCHES.has(branch)
    ? { branch }
    : { status: 400, error: 'invalid branch' };
}

const MEMBERSHIP_ACTIVATION_CONFLICT_MESSAGES = [
  'active membership already exists',
  'membership registration already activated',
  'membership registration is not pending',
  'membership registration has expired',
  'upgrade destination tier must be higher than current tier',
  'legacy active membership cannot be upgraded before migration',
];

function membershipActivationErrorStatus(error) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return MEMBERSHIP_ACTIVATION_CONFLICT_MESSAGES.some((known) => message.includes(known))
    ? 409
    : 500;
}

function membershipChangeErrorStatus(error) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('branch access denied')) return 403;
  if (
    message.includes('invalid tier')
    || message.includes('invalid branch')
    || message.includes('invalid membership change type')
  ) return 400;
  const conflicts = [
    'source membership registration not found',
    'paid membership history required',
    'source membership registration is not the latest paid period',
    'upgrade destination tier must be higher than current tier',
    'legacy active membership',
    'membership is still active',
    'membership change type does not match current state',
  ];
  return conflicts.some((known) => message.includes(known)) ? 409 : 500;
}

function createMembershipRegistrationRoutes(supabase, { rateLimiters = [] } = {}) {
  const router = express.Router();

  router.post('/membership/registrations', ...rateLimiters, async (req, res) => {
    const body = req.body || {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    if (!fullName) return res.status(400).json({ error: 'fullName required' });

    let phone;
    try {
      phone = normalizePhone(body.phone);
      getTierPrice(body.tier);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      const { data, error } = await supabase.rpc('create_membership_registration', {
        p_full_name: fullName,
        p_phone: phone,
        p_email: email,
        p_tier: body.tier,
      });
      if (error) throw error;

      const registration = Array.isArray(data) ? data[0] : data;
      if (!registration) throw new Error('membership registration returned no result');
      if (registration.outcome === 'ACTIVE_MEMBERSHIP') {
        return res.status(409).json({
          error: 'active membership already exists',
          tier: registration.active_tier || null,
          expiresAt: registration.active_expires_at || null,
        });
      }

      return res
        .status(registration.was_created ? 201 : 200)
        .json(toPublicRegistration(registration));
    } catch (err) {
      return res.status(500).json({ error: err.message || 'membership registration failed' });
    }
  });

  return router;
}

function createAdminCrmRoutes(supabase, adminAuth) {
  const router = express.Router();

  // ─── IMPORT MOKA CSV ─────────────────────────────────────────
  router.post('/import-moka-csv', adminAuth, async (req, res) => {
    const { csvText } = req.body;
    if (!csvText) return res.status(400).json({ error: 'csvText required' });

    const { data: allBarbers } = await supabase
      .from('barbers').select('id, name, branch').eq('is_active', true);
    const barbers = allBarbers || [];

    const lines = csvText.split('\n').filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV too short' });

    const headers = parseCSVRow(lines[0]).map(h =>
      h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'));
    const ci = (hint) => headers.findIndex(h => h.includes(hint));

    const iOutlet    = ci('outlet');
    const iDate      = ci('date');
    const iTime      = ci('time');
    const iGross     = ci('gross');
    const iNet       = ci('net_sale');
    const iCollected = ci('total_collected');
    const iReceipt   = ci('receipt');
    const iCollBy    = ci('collected_by');
    const iItems     = ci('items');
    const iVariant   = ci('variant');
    const iPayment   = ci('payment');
    const iEvent     = ci('event_type');

    // Aggregate by receipt so both Moka report formats are safe:
    // Report Transaction = one row/receipt; Item Details = many rows/receipt.
    const txByReceipt = new Map();
    const serviceByReceipt = new Map();
    const barberIdsByReceipt = new Map();
    const unmatchedItems = new Set();
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      if (row.length < 5) continue;

      const outletSlug = OUTLET_SLUG_MAP[(row[iOutlet] || '').trim().toLowerCase()];
      if (!outletSlug) { skipped++; continue; }

      if ((row[iEvent] || '').trim().toLowerCase() !== 'payment') { skipped++; continue; }

      const receiptNumber = (row[iReceipt] || '').trim();
      if (!receiptNumber) continue;

      const rawDate = (row[iDate] || '').trim();
      const txDate  = rawDate.length === 10 && rawDate[2] === '-' ? parseMokaDate(rawDate) : rawDate;

      const netSales   = parseFloat(row[iNet]       || '0') || 0;
      const grossSales = parseFloat(row[iGross]     || '0') || 0;
      const totalColl  = parseFloat(row[iCollected] || '0') || 0;
      const itemName = (row[iItems] || '').trim();
      const variant = iVariant >= 0 ? (row[iVariant] || '').trim() : '';
      // Item Details stores barber and service in separate columns.
      // Report Transaction already stores `Name (Service)` in Items.
      const itemsRaw = variant && itemName && !itemName.includes('(')
        ? `${itemName}(${variant})`
        : itemName;

      const existingTx = txByReceipt.get(receiptNumber);
      if (existingTx) {
        existingTx.net_sales += netSales;
        existingTx.gross_sales += grossSales;
        existingTx.total_collected += totalColl;
        if (itemsRaw) existingTx.items_raw = existingTx.items_raw
          ? `${existingTx.items_raw}, ${itemsRaw}` : itemsRaw;
      } else {
        txByReceipt.set(receiptNumber, {
          receipt_number: receiptNumber, outlet_slug: outletSlug,
          tx_date: txDate, tx_time: (row[iTime] || '').trim(),
          net_sales: netSales, gross_sales: grossSales, total_collected: totalColl,
          payment_method: (row[iPayment] || '').trim(),
          collected_by: (row[iCollBy] || '').trim(), items_raw: itemsRaw,
        });
      }

      for (const item of extractBarberItems(itemsRaw)) {
        const matched = matchBarberName(item.name, barbers, outletSlug);
        if (!matched) {
          unmatchedItems.add(item.name);
          continue;
        }
        const serviceKey = `${receiptNumber}:${matched.id}`;
        if (!serviceByReceipt.has(serviceKey)) {
          serviceByReceipt.set(serviceKey, {
            receipt_number: receiptNumber,
            barber_name_raw: item.name,
            barber_id: matched.id,
            service_name: [],
            outlet_slug: outletSlug,
            tx_date: txDate,
          });
        }
        serviceByReceipt.get(serviceKey).service_name.push(item.service);
        if (!barberIdsByReceipt.has(receiptNumber)) barberIdsByReceipt.set(receiptNumber, new Set());
        barberIdsByReceipt.get(receiptNumber).add(matched.id);
      }
    }

    const txToUpsert = [...txByReceipt.values()];
    const svcRows = [...serviceByReceipt.values()].map(row => ({
      ...row,
      service_name: row.service_name.join(', '),
      revenue_share: Math.round(
        (txByReceipt.get(row.receipt_number)?.net_sales || 0) /
        (barberIdsByReceipt.get(row.receipt_number)?.size || 1)
      ),
    }));

    if (txToUpsert.length) {
      const { error } = await supabase.from('moka_transactions')
        .upsert(txToUpsert, { onConflict: 'receipt_number' });
      if (error) return res.status(500).json({ error: 'TX upsert: ' + error.message });
    }

    const receiptNums = [...txByReceipt.keys()];
    if (receiptNums.length) {
      // Remove stale mappings too, including receipts that now contain no barber.
      const { error: deleteError } = await supabase.from('moka_barber_services')
        .delete().in('receipt_number', receiptNums);
      if (deleteError) return res.status(500).json({ error: 'SVC cleanup: ' + deleteError.message });
    }

    if (svcRows.length) {
      const { error } = await supabase.from('moka_barber_services').insert(svcRows);
      if (error) return res.status(500).json({ error: 'SVC insert: ' + error.message });
    }

    return res.json({
      ok: true,
      transactions: txToUpsert.length,
      barber_services: svcRows.length,
      skipped,
      unmatched_items: [...unmatchedItems].sort(),
    });
  });

  // ─── COMMAND CENTER ──────────────────────────────────────────
  router.get('/command-center', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const today = localDateStr();

    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name, branch')
      .eq('is_active', true)
      .eq('branch', branch);

    const barberIds = (barbers || []).map(b => b.id);

    const { data: attendance } = await supabase
      .from('barber_attendance')
      .select('barber_id, status')
      .in('barber_id', barberIds)
      .eq('date', today);

    const attendMap = {};
    for (const a of (attendance || [])) attendMap[a.barber_id] = a.status;

    const hadir = (barbers || []).filter(b =>
      ['hadir','terlambat'].includes(attendMap[b.id])
    );
    const tidakHadir = (barbers || []).filter(b =>
      ['izin','sakit','cuti'].includes(attendMap[b.id])
    );
    const belumCheckIn = (barbers || []).filter(b => !attendMap[b.id]);

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, status, time, barber_id, name, wa, service, notes')
      .eq('date', today)
      .eq('location', branch);

    const allBookings = bookings || [];
    const pending = allBookings.filter(b => b.status === 'pending');
    const homeServiceActive = allBookings.filter(b =>
      ['departed','arrived','in_progress'].includes(b.status) &&
      (b.notes || '').toUpperCase().includes('HOME SERVICE')
    );

    const { data: countRows } = await supabase
      .from('barber_daily_counts')
      .select('barber_id, count')
      .in('barber_id', barberIds)
      .eq('date', today);
    const countMap = {};
    for (const r of (countRows || [])) countMap[r.barber_id] = r.count;

    const alerts = [];
    const nowHour = new Date().getHours();

    if (nowHour >= 10) {
      for (const b of belumCheckIn) {
        const hasBookingToday = allBookings.some(bk => bk.barber_id === b.id);
        if (hasBookingToday) {
          alerts.push({
            type: 'warning',
            message: `${b.name} belum check-in — ada booking hari ini`,
          });
        }
      }
    }

    for (const bk of pending) {
      alerts.push({
        type: 'warning',
        message: `Booking ${bk.name} jam ${bk.time} belum di-confirm`,
      });
    }

    const homePending = allBookings.filter(b =>
      b.status === 'confirmed' &&
      (b.notes || '').toUpperCase().includes('HOME SERVICE')
    );
    for (const bk of homePending) {
      const [h, m] = bk.time.split(':').map(Number);
      const schedMs = new Date().setHours(h, m, 0, 0);
      const diffMin = (schedMs - Date.now()) / 60000;
      if (diffMin <= 30 && diffMin > 0) {
        alerts.push({
          type: 'warning',
          message: `Home service jam ${bk.time} (${bk.name}) — barber belum berangkat`,
        });
      }
    }

    // ── Moka open bills (GoShow walk-in) ──
    const { data: outlet } = await supabase
      .from('outlets')
      .select('id')
      .eq('slug', branch)
      .maybeSingle();

    let mokaOpenBills = [];
    if (outlet) {
      const dayStart = today + 'T00:00:00+07:00';
      const dayEnd   = today + 'T23:59:59+07:00';
      const { data: openBillRows } = await supabase
        .from('schedules')
        .select('id, barber_id, service_name, start_time, end_time, external_id, notes')
        .eq('outlet_id', outlet.id)
        .eq('source', 'moka')
        .eq('status', 'reserved')
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .order('start_time', { ascending: true });

      const barberNameMap = {};
      for (const b of (barbers || [])) barberNameMap[b.id] = b.name;

      mokaOpenBills = (openBillRows || []).map(r => {
        const startWib = new Date(r.start_time);
        const timeStr = startWib.toLocaleTimeString('id-ID', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
        });
        return {
          id:           r.id,
          barber_name:  barberNameMap[r.barber_id] || (r.notes?.includes('No barber') ? '⚠ Unassigned' : r.barber_id),
          service_name: r.service_name,
          time:         timeStr,
          external_id:  r.external_id,
          unassigned:   !r.barber_id || r.notes?.includes('No barber'),
        };
      });
    }

    return res.json({
      today,
      barbers: (barbers || []).map(b => ({
        ...b,
        attendance_status: attendMap[b.id] || null,
        today_count: countMap[b.id] || 0,
      })),
      stats: {
        hadir: hadir.length,
        tidak_hadir: tidakHadir.length,
        belum_check_in: belumCheckIn.length,
        booking_today: allBookings.length,
        pending: pending.length,
        home_service_active: homeServiceActive.length,
        moka_open_bills: mokaOpenBills.length,
      },
      home_service: homeServiceActive,
      booking_feed: allBookings
        .filter(b => ['pending','confirmed'].includes(b.status))
        .sort((a, b) => a.time.localeCompare(b.time))
        .slice(0, 10),
      moka_open_bills: mokaOpenBills,
      alerts,
    });
  });

  // ─── ATTENDANCE ───────────────────────────────────────────────
  router.get('/attendance', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const date = req.query.date || localDateStr();

    const { data: barbers } = await supabase
      .from('barbers')
      .select('id, name')
      .eq('is_active', true)
      .eq('branch', branch);

    const barberIds = (barbers || []).map(b => b.id);

    const { data: attendance } = await supabase
      .from('barber_attendance')
      .select('barber_id, status, note, updated_at')
      .in('barber_id', barberIds)
      .eq('date', date);

    const attMap = {};
    for (const a of (attendance || [])) attMap[a.barber_id] = a;

    const { data: counts } = await supabase
      .from('barber_daily_counts')
      .select('barber_id, count')
      .in('barber_id', barberIds)
      .eq('date', date);
    const countMap = {};
    for (const c of (counts || [])) countMap[c.barber_id] = c.count;

    return res.json({
      date,
      barbers: (barbers || []).map(b => ({
        ...b,
        attendance: attMap[b.id] || null,
        today_count: countMap[b.id] || 0,
      })),
    });
  });

  router.post('/attendance', adminAuth, async (req, res) => {
    const { barber_id, date, status, note } = req.body;
    if (!barber_id || !date || !status) {
      return res.status(400).json({ error: 'barber_id, date, status required' });
    }

    const { error } = await supabase
      .from('barber_attendance')
      .upsert(
        { barber_id, date, status, note: note || null, updated_at: new Date().toISOString() },
        { onConflict: 'barber_id,date' }
      );

    if (error) return res.status(500).json({ error: error.message });

    if (['izin','sakit','cuti'].includes(status)) {
      await supabase.from('barber_date_overrides').upsert(
        { barber_id, date, is_off: true },
        { onConflict: 'barber_id,date' }
      );
    } else if (status === 'hadir') {
      await supabase.from('barber_date_overrides')
        .delete().eq('barber_id', barber_id).eq('date', date);
    }

    return res.json({ ok: true });
  });

  router.get('/attendance/history', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const month = req.query.month || localDateStr().slice(0, 7);
    const monthStart = month + '-01';
    const monthEnd = month + '-31';

    const { data: barbers } = await supabase
      .from('barbers').select('id, name').eq('is_active', true).eq('branch', branch);
    const barberIds = (barbers || []).map(b => b.id);

    const { data: rows } = await supabase
      .from('barber_attendance')
      .select('barber_id, date, status')
      .in('barber_id', barberIds)
      .gte('date', monthStart).lte('date', monthEnd);

    return res.json({ barbers, records: rows || [], month });
  });

  // ─── CUSTOMERS ────────────────────────────────────────────────
  router.get('/customers/loyal', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const monthStart = getMonthStart();

    const { data } = await supabase
      .from('bookings')
      .select('customer_id, name, wa, barber_id')
      .eq('location', branch)
      .eq('status', 'done')
      .gte('date', monthStart);

    const map = {};
    for (const b of (data || [])) {
      const key = b.wa || b.name;
      if (!map[key]) map[key] = { name: b.name, wa: b.wa, count: 0, barber_id: b.barber_id };
      map[key].count++;
    }

    const loyal = Object.values(map)
      .filter(c => c.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    return res.json({ customers: loyal });
  });

  router.get('/customers/new', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const monthStart = getMonthStart();

    const { data } = await supabase
      .from('bookings')
      .select('name, wa, barber_id, service, date, created_at')
      .eq('location', branch)
      .eq('status', 'done')
      .gte('date', monthStart)
      .order('created_at', { ascending: false });

    const seen = new Set();
    const newCustomers = [];
    for (const b of (data || [])) {
      const key = b.wa || b.name;
      if (!seen.has(key)) {
        seen.add(key);
        newCustomers.push(b);
      }
    }

    return res.json({ customers: newCustomers.slice(0, 50) });
  });

  router.get('/customers/dormant', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const { data: recent } = await supabase
      .from('bookings')
      .select('wa, name')
      .eq('location', branch)
      .eq('status', 'done')
      .gte('date', cutoff);
    const recentWa = new Set((recent || []).map(b => b.wa));

    const { data: old } = await supabase
      .from('bookings')
      .select('name, wa, date, barber_id')
      .eq('location', branch)
      .eq('status', 'done')
      .lt('date', cutoff)
      .order('date', { ascending: false });

    const map = {};
    for (const b of (old || [])) {
      if (!recentWa.has(b.wa) && !map[b.wa]) {
        map[b.wa] = b;
      }
    }

    return res.json({ customers: Object.values(map).slice(0, 50) });
  });

  // ─── LEADERBOARD ──────────────────────────────────────────────
  router.get('/leaderboard', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const category = req.query.category || 'customer';
    const monthStart = getMonthStart();
    const today = localDateStr();

    const { data: barbers } = await supabase
      .from('barbers').select('id, name, branch')
      .eq('is_active', true)
      .eq('branch', branch);
    if (!barbers?.length) return res.json({ items: [] });

    const barberIds = barbers.map(b => b.id);

    if (category === 'customer') {
      // Primary: actual Moka POS customers (1 receipt = 1 customer)
      const { data: mokaSvc } = await supabase
        .from('moka_barber_services').select('barber_id')
        .in('barber_id', barberIds)
        .gte('tx_date', monthStart).lte('tx_date', today);

      const mokaMap = {};
      for (const r of (mokaSvc || [])) mokaMap[r.barber_id] = (mokaMap[r.barber_id] || 0) + 1;

      // Fallback: web bookings (barber_daily_counts) for barbers with no Moka CSV data
      const { data: counts } = await supabase
        .from('barber_daily_counts').select('barber_id, count')
        .in('barber_id', barberIds)
        .gte('date', monthStart).lte('date', today);

      const dailyMap = {};
      for (const r of (counts || [])) dailyMap[r.barber_id] = (dailyMap[r.barber_id] || 0) + r.count;

      const ranked = barbers
        .map(b => {
          const score = (mokaMap[b.id] || 0) > 0 ? mokaMap[b.id] : (dailyMap[b.id] || 0);
          return { ...b, score, display: `${score} customer` };
        })
        .sort((a, b) => b.score - a.score)
        .map((b, i) => ({ rank: i + 1, ...b }));

      return res.json({ items: ranked, category });
    }

    if (category === 'streak') {
      const { data: streaks } = await supabase
        .from('barber_streaks').select('barber_id, current_streak')
        .in('barber_id', barberIds);

      const map = {};
      for (const r of (streaks || [])) map[r.barber_id] = r.current_streak;

      const ranked = barbers
        .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0} hari` }))
        .sort((a, b) => b.score - a.score)
        .map((b, i) => ({ rank: i + 1, ...b }));

      return res.json({ items: ranked, category });
    }

    if (category === 'home_service') {
      const { data: rows } = await supabase
        .from('bookings').select('barber_id')
        .in('barber_id', barberIds)
        .eq('status', 'done')
        .gte('date', monthStart)
        .ilike('notes', '%HOME SERVICE%');

      const map = {};
      for (const r of (rows || [])) map[r.barber_id] = (map[r.barber_id] || 0) + 1;

      const ranked = barbers
        .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0}x home service` }))
        .sort((a, b) => b.score - a.score)
        .map((b, i) => ({ rank: i + 1, ...b }));

      return res.json({ items: ranked, category });
    }

    return res.status(400).json({ error: 'Unknown category' });
  });

  // ─── BOOKING ACTIONS ──────────────────────────────────────────
  router.post('/booking/reassign', adminAuth, async (req, res) => {
    const { booking_id, new_barber_id } = req.body;
    if (!booking_id || !new_barber_id) {
      return res.status(400).json({ error: 'booking_id and new_barber_id required' });
    }

    const { error } = await supabase
      .from('bookings')
      .update({ barber_id: new_barber_id })
      .eq('id', booking_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  router.post('/booking/walkin', adminAuth, async (req, res) => {
    const { name, wa, barber_id, service, branch } = req.body;
    if (!barber_id || !service || !branch) {
      return res.status(400).json({ error: 'barber_id, service, branch required' });
    }

    const today = localDateStr();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        name: name || 'Walk-in',
        wa: wa || '-',
        barber_id,
        service,
        service_id: 'walk_in',
        date: today,
        time: timeStr,
        location: branch,
        status: 'done',
        notes: 'WALK-IN',
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, booking: data });
  });

  // ─── SCHEDULE / SLOT BLOCK ────────────────────────────────────
  router.post('/schedule/block', adminAuth, async (req, res) => {
    const { barber_id, date } = req.body;
    if (!barber_id || !date) return res.status(400).json({ error: 'barber_id, date required' });

    const { error } = await supabase
      .from('barber_date_overrides')
      .upsert({ barber_id, date, is_off: true }, { onConflict: 'barber_id,date' });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  router.post('/schedule/unblock', adminAuth, async (req, res) => {
    const { barber_id, date } = req.body;
    if (!barber_id || !date) return res.status(400).json({ error: 'barber_id, date required' });

    await supabase.from('barber_date_overrides')
      .delete().eq('barber_id', barber_id).eq('date', date);

    return res.json({ ok: true });
  });

  router.get('/schedule', adminAuth, async (req, res) => {
    const branch = req.query.branch;
    const weekStart = req.query.week || localDateStr();

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart + 'T00:00:00');
      d.setDate(d.getDate() + i);
      days.push(localDateStr(d));
    }

    const { data: barbers } = await supabase
      .from('barbers').select('id, name, work_days')
      .eq('is_active', true).eq('branch', branch);

    const barberIds = (barbers || []).map(b => b.id);

    const { data: overrides } = await supabase
      .from('barber_date_overrides')
      .select('barber_id, date, is_off')
      .in('barber_id', barberIds)
      .in('date', days);

    const overrideMap = {};
    for (const o of (overrides || [])) {
      if (!overrideMap[o.barber_id]) overrideMap[o.barber_id] = {};
      overrideMap[o.barber_id][o.date] = o.is_off;
    }

    return res.json({ barbers, days, overrides: overrideMap });
  });

  // ─── BROADCAST ────────────────────────────────────────────────
  router.post('/broadcast', adminAuth, async (req, res) => {
    const { branch, message, target } = req.body;
    if (!branch || !message) return res.status(400).json({ error: 'branch, message required' });

    const { data: branchBarbers } = await supabase
      .from('barbers').select('id').eq('is_active', true).eq('branch', branch);
    const barberIds = (branchBarbers || []).map(b => b.id);

    const { data: barberUsers } = await supabase
      .from('users').select('id, barber_id')
      .in('barber_id', barberIds).eq('role', 'barber');

    const { sendPushToUser } = require('../services/webPush');
    let sent = 0;
    for (const u of (barberUsers || [])) {
      try {
        await sendPushToUser(supabase, u.id, {
          title: '📣 Pengumuman Cabang',
          body: message,
          url: '/barber/home',
        });
        sent++;
      } catch (e) { /* ignore */ }
    }

    await supabase.from('admin_broadcasts').insert({
      branch, message,
      target: target || 'all',
      channel: 'push',
      sent_at: new Date().toISOString(),
    });

    return res.json({ ok: true, sent });
  });

  router.get('/broadcast/log', adminAuth, async (req, res) => {
    const branch = req.query.branch;

    const { data } = await supabase
      .from('admin_broadcasts')
      .select('id, message, target, channel, sent_at')
      .eq('branch', branch)
      .order('sent_at', { ascending: false })
      .limit(20);

    return res.json({ logs: data || [] });
  });

  // ─── OWNER OVERVIEW ──────────────────────────────────────────
  router.get('/owner-overview', adminAuth, async (req, res) => {
    const today = localDateStr();
    const dayStart = today + 'T00:00:00+07:00';
    const dayEnd   = today + 'T23:59:59+07:00';

    const { data: outlets } = await supabase
      .from('outlets')
      .select('id, name, slug');

    const branches = await Promise.all((outlets || []).map(async (outlet) => {
      const { data: barbers } = await supabase
        .from('barbers').select('id').eq('is_active', true).eq('branch', outlet.slug);
      const barberIds = (barbers || []).map(b => b.id);

      const [attRows, mokaSch, webTx, goshow, pendingBk] = await Promise.all([
        supabase.from('barber_attendance').select('barber_id, status')
          .in('barber_id', barberIds).eq('date', today),
        supabase.from('moka_transactions').select('net_sales')
          .eq('outlet_slug', outlet.slug).eq('tx_date', today),
        supabase.from('transactions').select('total_amount')
          .eq('outlet_id', outlet.id).eq('source', 'web')
          .gte('created_at', dayStart).lte('created_at', dayEnd),
        supabase.from('schedules').select('id')
          .eq('outlet_id', outlet.id).eq('source', 'moka').eq('status', 'reserved')
          .gte('start_time', dayStart).lte('start_time', dayEnd),
        supabase.from('bookings').select('id')
          .eq('location', outlet.slug).eq('status', 'pending').eq('date', today),
      ]);

      const hadirSet = new Set(
        (attRows.data || []).filter(a => ['hadir','terlambat'].includes(a.status)).map(a => a.barber_id)
      );
      const revenue_moka = (mokaSch.data || []).reduce((s, r) => s + (r.net_sales || 0), 0);
      const revenue_web  = (webTx.data  || []).reduce((s, r) => s + (r.total_amount || 0), 0);

      return {
        slug: outlet.slug,
        name: outlet.name,
        revenue_moka,
        tx_moka:    (mokaSch.data || []).length,
        revenue_web,
        tx_web:     (webTx.data  || []).length,
        hadir:      hadirSet.size,
        total_barbers: barberIds.length,
        goshow:     (goshow.data || []).length,
        pending_bookings: (pendingBk.data || []).length,
      };
    }));

    const totals = branches.reduce((acc, b) => ({
      revenue_moka: acc.revenue_moka + b.revenue_moka,
      revenue_web:  acc.revenue_web  + b.revenue_web,
      tx_total:     acc.tx_total     + b.tx_moka + b.tx_web,
      hadir:        acc.hadir        + b.hadir,
      goshow:       acc.goshow       + b.goshow,
      pending:      acc.pending      + b.pending_bookings,
    }), { revenue_moka: 0, revenue_web: 0, tx_total: 0, hadir: 0, goshow: 0, pending: 0 });

    return res.json({ today, branches, totals });
  });

  // ─── OWNER REVENUE ────────────────────────────────────────────
  router.get('/owner-revenue', adminAuth, async (req, res) => {
    const { branch = 'all', period = '7d' } = req.query;

    const now = new Date();
    let startDate;
    if (period === 'today') {
      startDate = new Date(now); startDate.setHours(0,0,0,0);
    } else if (period === '7d') {
      startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0,0,0,0);
    } else if (period === '30d') {
      startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0,0,0,0);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0,0,0,0);
    }
    const startIso = startDate.toISOString();

    // Resolve outlet filter
    let outletIds = null;
    if (branch !== 'all') {
      const { data: outlet } = await supabase.from('outlets').select('id').eq('slug', branch).maybeSingle();
      outletIds = outlet ? [outlet.id] : [];
    }

    // Date range: DATE string for moka_transactions, ISO for web transactions
    const startDateStr = startDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

    // Fetch Moka CSV data, web transactions, and metadata in parallel
    let mokaQ = supabase.from('moka_transactions')
      .select('outlet_slug, tx_date, net_sales')
      .gte('tx_date', startDateStr)
      .limit(10000);
    let svcQ = supabase.from('moka_barber_services')
      .select('barber_id, outlet_slug, tx_date, revenue_share, service_name')
      .gte('tx_date', startDateStr)
      .limit(10000);
    let webQ = supabase.from('transactions').select('outlet_id, total_amount, created_at')
      .eq('source', 'web').gte('created_at', startIso);
    if (branch !== 'all') { mokaQ = mokaQ.eq('outlet_slug', branch); svcQ = svcQ.eq('outlet_slug', branch); }
    if (outletIds) webQ = webQ.in('outlet_id', outletIds);

    const [mokaRes, svcRes, webRes, outletRes, barberRes] = await Promise.all([
      mokaQ, svcQ, webQ,
      supabase.from('outlets').select('id, name, slug'),
      supabase.from('barbers').select('id, name, branch').eq('is_active', true),
    ]);

    const mokaRows = mokaRes.data || [];
    const svcRows  = svcRes.data  || [];
    const webRows  = webRes.data  || [];
    const outlets  = outletRes.data || [];
    const barbers  = barberRes.data || [];

    // Summary
    const revenue_moka = mokaRows.reduce((s, r) => s + (r.net_sales || 0), 0);
    const revenue_web  = webRows.reduce((s, r)  => s + (r.total_amount || 0), 0);
    const tx_total = mokaRows.length + webRows.length;
    const avg_tx = tx_total ? Math.round((revenue_moka + revenue_web) / tx_total) : 0;

    // Daily trend
    const dailyMap = {};
    for (const r of mokaRows) {
      const d = r.tx_date;
      if (!dailyMap[d]) dailyMap[d] = { date: d, moka: 0, web: 0 };
      dailyMap[d].moka += r.net_sales || 0;
    }
    for (const r of webRows) {
      const d = new Date(r.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
      if (!dailyMap[d]) dailyMap[d] = { date: d, moka: 0, web: 0 };
      dailyMap[d].web += r.total_amount || 0;
    }
    const daily_trend = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Branch compare (moka uses slug; web uses outlet_id → need id→slug map)
    const slugEntry  = {};
    const idToSlug   = {};
    for (const o of outlets) {
      slugEntry[o.slug] = { slug: o.slug, name: o.name, revenue_moka: 0, revenue_web: 0, tx_total: 0 };
      idToSlug[o.id]    = o.slug;
    }
    for (const r of mokaRows) {
      if (slugEntry[r.outlet_slug]) { slugEntry[r.outlet_slug].revenue_moka += r.net_sales || 0; slugEntry[r.outlet_slug].tx_total++; }
    }
    for (const r of webRows) {
      const sl = idToSlug[r.outlet_id];
      if (sl && slugEntry[sl]) { slugEntry[sl].revenue_web += r.total_amount || 0; slugEntry[sl].tx_total++; }
    }
    const branch_compare = Object.values(slugEntry).sort((a, b) => (b.revenue_moka + b.revenue_web) - (a.revenue_moka + a.revenue_web));

    // Top barbers (from moka_barber_services revenue_share)
    const barberMap = {};
    for (const r of svcRows) {
      if (!r.barber_id) continue;
      if (!barberMap[r.barber_id]) barberMap[r.barber_id] = { barber_id: r.barber_id, name: '', branch: '', tx_count: 0, revenue: 0 };
      barberMap[r.barber_id].tx_count++;
      barberMap[r.barber_id].revenue += r.revenue_share || 0;
    }
    for (const b of barbers) {
      if (barberMap[b.id]) { barberMap[b.id].name = b.name; barberMap[b.id].branch = b.branch; }
    }
    const top_barbers = Object.values(barberMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Top services (service_name per barber row, split on ", ")
    const topSvcMap = {};
    for (const r of svcRows) {
      const svcs = (r.service_name || 'Unknown').split(', ');
      const revEach = svcs.length > 0 ? Math.round((r.revenue_share || 0) / svcs.length) : 0;
      for (const svc of svcs) {
        if (!topSvcMap[svc]) topSvcMap[svc] = { service_name: svc, count: 0, revenue: 0 };
        topSvcMap[svc].count++;
        topSvcMap[svc].revenue += revEach;
      }
    }
    const top_services = Object.values(topSvcMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return res.json({ summary: { revenue_moka, revenue_web, tx_total, avg_tx }, daily_trend, branch_compare, top_barbers, top_services });
  });

  // ─── MEMBERSHIP ──────────────────────────────────────────────
  router.get('/membership', adminAuth, async (req, res) => {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('user_key,full_name,email,membership_status,membership_activated_at,membership_started_at,membership_expires_at,current_tier,total_points,total_visits,created_at,phone')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Enrich with last_visit dari customers table (match by phone_e164)
    const phones = (data || []).map(m => m.phone).filter(Boolean);
    let lastVisitMap = {};
    if (phones.length) {
      const { data: custs } = await supabase
        .from('customers')
        .select('phone_e164,last_visit')
        .in('phone_e164', phones);
      for (const c of (custs || [])) {
        if (c.phone_e164) lastVisitMap[c.phone_e164] = c.last_visit;
      }
    }
    const enriched = (data || []).map((m) => ({
      ...m,
      membership_status: isActiveMembership({
        status: m.membership_status,
        startsAt: m.membership_started_at,
        expiresAt: m.membership_expires_at,
      }) ? 'ACTIVE' : 'INACTIVE',
      last_visit: lastVisitMap[m.phone] || null,
    }));
    res.json(enriched);
  });

  // ── POST /membership/sync-moka ─────────────────────────────────────────────
  // Tarik data transaksi Moka untuk 1 member (by wa), upsert member_profiles + update customers.
  router.post('/membership/sync-moka', adminAuth, async (req, res) => {
    const { wa } = req.body;
    if (!wa) return res.status(400).json({ error: 'wa required' });

    // Normalize phone
    const digits   = String(wa).replace(/\D/g, '');
    const waNorm   = digits.startsWith('62') ? digits : '62' + (digits.startsWith('0') ? digits.slice(1) : digits);
    const phoneE164 = '+' + waNorm;
    const normPhone = (raw) => {
      if (!raw) return '';
      let d = String(raw).replace(/\D/g, '');
      if (d.startsWith('62')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1);
      return d.slice(-11);
    };
    const targetNorm = normPhone(wa);

    // Fetch active outlets
    const { data: outlets, error: outletErr } = await supabase
      .from('outlets').select('id,slug,name,moka_outlet_id')
      .not('moka_outlet_id', 'is', null).eq('is_active', true);
    if (outletErr) return res.status(500).json({ error: outletErr.message });
    if (!outlets?.length) return res.status(400).json({ error: 'No active outlets with Moka' });

    const PAGE_DELAY_MS = 150;
    const MAX_BUDGET_MS = 55_000;
    const POINTS_PER_VISIT = 50;
    const TIER_THRESHOLDS = [
      { name: 'platinum', min: 3000 },
      { name: 'gold',     min: 1000 },
      { name: 'silver',   min:  500 },
      { name: 'bronze',   min:    0 },
    ];
    const getTier = (pts) => { for (const t of TIER_THRESHOLDS) if (pts >= t.min) return t.name; return 'bronze'; };

    let totalVisits = 0, totalSpent = 0, lastVisit = null, firstVisit = null;
    const startTime = Date.now();

    try {
      for (const outlet of outlets) {
        if (Date.now() - startTime > MAX_BUDGET_MS) break;
        const MokaClient = require('../moka/client');
        const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
        let sinceEpoch = null;
        while (true) {
          if (Date.now() - startTime > MAX_BUDGET_MS) break;
          let json;
          try { json = await client.getTransactionPage({ sinceEpoch, limit: 100 }); }
          catch (err) { if (err.status === 404 || err.status === 403) break; throw err; }
          const payments = json?.data?.payments ?? [];
          for (const p of payments) {
            if (p.is_deleted || p.is_refunded) continue;
            const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
            if (norm !== targetNorm) continue;
            totalVisits++;
            totalSpent += Number(p.total_collected || p.total_transaction || 0);
            const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
            if (txDate && (!lastVisit  || txDate > lastVisit))  lastVisit  = txDate;
            if (txDate && (!firstVisit || txDate < firstVisit)) firstVisit = txDate;
          }
          if (json?.data?.completed || !payments.length) break;
          const m2 = (json?.data?.next_url || '').match(/[?&]since=([0-9.]+)/);
          if (!m2) break;
          sinceEpoch = parseFloat(m2[1]);
          await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
        }
      }

      const newPoints = totalVisits * POINTS_PER_VISIT;
      const newTier   = getTier(newPoints);
      const now       = new Date().toISOString();

      // Update customers — first_visit hanya diisi jika belum ada (preserve yang sudah tersimpan)
      const custPatch = { visits: totalVisits, points: newPoints, total_spent: totalSpent, last_visit: lastVisit, updated_at: now };
      if (firstVisit) custPatch.first_visit = firstVisit;
      await supabase.from('customers').update(custPatch).eq('wa', waNorm);

      // Fetch existing member_profiles to decide insert vs update
      const { data: existing } = await supabase.from('member_profiles')
        .select('id,user_key,full_name,phone,membership_status,membership_activated_at,membership_started_at,membership_expires_at')
        .eq('phone', phoneE164).maybeSingle();

      if (existing) {
        const membership = membershipStateForSync({
          existingStatus: existing.membership_status,
          existingActivatedAt: existing.membership_activated_at,
          existingStartedAt: existing.membership_started_at,
          existingExpiresAt: existing.membership_expires_at,
        });
        await supabase.from('member_profiles').update({
          total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
          ...membership,
          updated_at: now,
        }).eq('id', existing.id);
      } else {
        // Create member_profiles entry (no prior entry for this phone)
        const { data: cust } = await supabase.from('customers')
          .select('name,phone_e164,email,birth_date,gender,address,referral_code,membership_status,membership_activated_at,membership_started_at,membership_expires_at')
          .eq('wa', waNorm).maybeSingle();
        const phoneNormShort = targetNorm;
        const userKey  = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}`;
        const email    = (cust?.email && !/^moka_/.test(cust.email)) ? cust.email : `moka_${phoneNormShort}@redbox.internal`;
        const membership = membershipStateForSync({
          customerStatus: cust?.membership_status,
          customerActivatedAt: cust?.membership_activated_at,
          customerStartedAt: cust?.membership_started_at,
          customerExpiresAt: cust?.membership_expires_at,
        });
        await supabase.from('member_profiles').upsert({
          user_key: userKey, email, full_name: cust?.name || '', phone: phoneE164,
          ...membership,
          total_points: newPoints, total_visits: totalVisits, current_tier: newTier,
        }, { onConflict: 'user_key' });
      }

      return res.json({
        success: true, wa: waNorm, phone_e164: phoneE164,
        visits: totalVisits, points: newPoints, tier: newTier,
        last_visit: lastVisit, first_visit: firstVisit, total_spent: totalSpent,
      });
    } catch (err) {
      console.error('[SyncMokaSingle] Fatal:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/membership/registrations', adminAuth, async (req, res) => {
    const access = getVerifiedMembershipAdmin(req);
    if (!access) return res.status(403).json({ error: 'verified membership admin session required' });

    const requestedStatus = String(req.query.status || 'all').toUpperCase();
    const allowedStatuses = new Set(['ALL', 'PENDING', 'ACTIVE', 'EXPIRED']);
    if (!allowedStatuses.has(requestedStatus)) {
      return res.status(400).json({ error: 'invalid membership registration status' });
    }

    try {
      const now = new Date();
      await expirePendingMembershipRegistrations(supabase, now);
      const { data: registrations, error: registrationsError } = await supabase
        .from('membership_registrations')
        .select('id,registration_code,user_key,full_name,phone,email,tier,price_snapshot,registration_type,source_registration_id,requested_by,requested_branch,status,expires_at,created_at,updated_at')
        .order('created_at', { ascending: false });
      if (registrationsError) throw registrationsError;

      let profiles = [];
      let activations = [];
      if ((registrations || []).length) {
        const registrationIds = registrations.map((registration) => registration.id);
        const [profileResult, activationResult] = await Promise.all([
          supabase
            .from('member_profiles')
            .select('user_key,phone,membership_status,current_tier,membership_started_at,membership_expires_at'),
          supabase
            .from('member_activations')
            .select('id,registration_id,amount,tier,payment_method,payment_reference,branch,confirmed_by,status,starts_at,expires_at,activated_at')
            .in('registration_id', registrationIds)
            .order('activated_at', { ascending: false }),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (activationResult.error) throw activationResult.error;
        profiles = profileResult.data || [];
        activations = activationResult.data || [];
      }
      const profilesByUserKey = new Map(profiles.map((profile) => [profile.user_key, profile]));
      const profilesByPhone = new Map();
      for (const profile of profiles) {
        try {
          profilesByPhone.set(normalizePhone(profile.phone), profile);
        } catch (_) {
          // Historical profile phones may be malformed; they must not block the CRM list.
        }
      }
      const activationsByRegistrationId = new Map();
      for (const activation of activations) {
        if (activation.registration_id && !activationsByRegistrationId.has(activation.registration_id)) {
          activationsByRegistrationId.set(activation.registration_id, activation);
        }
      }
      const registrationsById = new Map((registrations || []).map((registration) => [registration.id, registration]));
      const latestActivationByUserKey = new Map();
      for (const activation of activations) {
        const registration = registrationsById.get(activation.registration_id);
        if (registration?.user_key && !latestActivationByUserKey.has(registration.user_key)) {
          latestActivationByUserKey.set(registration.user_key, activation);
        }
      }
      const mapped = (registrations || []).map((registration) => {
        let normalizedPhone = null;
        try {
          normalizedPhone = normalizePhone(registration.phone);
        } catch (_) {
          // The registration row is historical data. Keep it visible as-is.
        }
        const profile = profilesByUserKey.get(registration.user_key)
          || (normalizedPhone ? profilesByPhone.get(normalizedPhone) : null)
          || null;
        const activation = activationsByRegistrationId.get(registration.id) || null;
        const latestActivation = latestActivationByUserKey.get(registration.user_key) || null;
        const pendingExpiresAt = registration.expires_at || null;
        const pendingIsLive = pendingExpiresAt && new Date(pendingExpiresAt) > now;
        const startsAt = activation?.starts_at || profile?.membership_started_at || null;
        const membershipExpiresAt = activation?.expires_at || profile?.membership_expires_at || null;
        const profileIsActive = profile && isActiveMembership({
          status: profile.membership_status,
          startsAt: profile.membership_started_at,
          expiresAt: profile.membership_expires_at,
          now,
        });
        const paidPeriodIsActive = Boolean(
          membershipExpiresAt
          && new Date(membershipExpiresAt) > now
          && (!startsAt || new Date(startsAt) <= now)
          && (!activation || activation.status === 'completed')
        );
        // Paid activation is the source of truth for this CRM workflow. A legacy
        // profile can still carry an old/incomplete membership_status from Moka;
        // that must not make a completed paid activation appear EXPIRED.
        const membershipIsActive = paidPeriodIsActive;
        let status = registration.status;
        if (registration.status === 'PENDING') status = pendingIsLive ? 'PENDING' : 'EXPIRED';
        else if (registration.status === 'ACTIVATED') status = membershipIsActive ? 'ACTIVE' : 'EXPIRED';
        const isLatestPaidPeriod = Boolean(activation && latestActivation?.id === activation.id);
        const currentTier = profile?.current_tier || registration.tier;
        const actionBranch = typeof activation?.branch === 'string' ? activation.branch.trim().toLowerCase() : '';
        const hasActionBranch = MEMBERSHIP_ADMIN_BRANCHES.has(actionBranch);
        let canUpgrade = false;
        try {
          canUpgrade = status === 'ACTIVE'
            && isLatestPaidPeriod
            && hasActionBranch
            && Object.keys(TIER_PRICES).some((tier) => isTierUpgrade(currentTier, tier));
        } catch (_) {
          canUpgrade = false;
        }
        const canRenew = Boolean(
          status === 'EXPIRED' && activation && isLatestPaidPeriod && hasActionBranch && !profileIsActive
        );

        return {
          id: registration.id,
          registrationCode: registration.registration_code,
          userKey: registration.user_key,
          fullName: registration.full_name,
          phone: registration.phone,
          email: registration.email,
          tier: registration.tier,
          amount: registration.price_snapshot,
          registrationType: registration.registration_type || 'NEW',
          sourceRegistrationId: registration.source_registration_id || null,
          requestedBy: registration.requested_by || null,
          requestedBranch: registration.requested_branch || null,
          status,
          registrationStatus: registration.status,
          pendingExpiresAt,
          activationId: activation?.id || null,
          paymentMethod: activation?.payment_method || null,
          paymentReference: activation?.payment_reference || null,
          branch: activation?.branch || registration.requested_branch || null,
          confirmedBy: activation?.confirmed_by || null,
          paymentStatus: activation?.status || null,
          startsAt,
          membershipExpiresAt,
          activatedAt: activation?.activated_at || null,
          createdAt: registration.created_at || null,
          updatedAt: registration.updated_at || null,
          canRenew,
          canUpgrade,
          currentTier,
        };
      });
      const scoped = access.role === 'owner'
        ? mapped
        : mapped.filter((registration) => (
          registration.branch === access.branch
          || (
            registration.registrationStatus === 'PENDING'
            && !registration.activationId
            && (!registration.requestedBranch || registration.requestedBranch === access.branch)
          )
        ));
      const filtered = requestedStatus === 'ALL'
        ? scoped
        : scoped.filter((registration) => registration.status === requestedStatus);
      return res.json({ registrations: filtered });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'membership registrations unavailable' });
    }
  });

  router.post('/membership/registrations/:registrationId/change', adminAuth, async (req, res) => {
    const access = getVerifiedMembershipAdmin(req);
    if (!access) return res.status(403).json({ error: 'verified membership admin session required' });

    const registrationId = String(req.params.registrationId || '').trim();
    const destinationTier = typeof req.body?.tier === 'string' ? req.body.tier.trim().toLowerCase() : '';
    const registrationType = typeof req.body?.registrationType === 'string'
      ? req.body.registrationType.trim().toUpperCase()
      : '';
    if (!registrationId) return res.status(400).json({ error: 'registrationId required' });
    if (!['RENEWAL', 'UPGRADE'].includes(registrationType)) {
      return res.status(400).json({ error: 'valid registrationType required' });
    }
    try {
      getTierPrice(destinationTier);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!access.staffId) return res.status(403).json({ error: 'authenticated staff identity required' });

    try {
      const { data: sourceActivation, error: sourceActivationError } = await supabase
        .from('member_activations')
        .select('registration_id,branch,status,activated_at')
        .eq('registration_id', registrationId)
        .eq('status', 'completed')
        .order('activated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sourceActivationError) throw sourceActivationError;
      if (!sourceActivation) {
        return res.status(409).json({ error: 'paid membership history required' });
      }

      const sourceBranch = typeof sourceActivation.branch === 'string'
        ? sourceActivation.branch.trim().toLowerCase()
        : '';
      if (!MEMBERSHIP_ADMIN_BRANCHES.has(sourceBranch)) {
        return res.status(409).json({ error: 'source membership branch is invalid' });
      }
      if (access.role === 'branch_admin' && sourceBranch !== access.branch) {
        return res.status(403).json({ error: 'branch access denied' });
      }

      const { data, error } = await supabase.rpc('create_membership_change_registration', {
        p_source_registration_id: registrationId,
        p_tier: destinationTier,
        p_registration_type: registrationType,
        p_requested_by: access.staffId,
        p_requested_branch: sourceBranch,
      });
      if (error) {
        return res.status(membershipChangeErrorStatus(error)).json({
          error: error.message || 'membership renewal or upgrade failed',
        });
      }
      const registration = Array.isArray(data) ? data[0] : data;
      if (!registration) throw new Error('membership change registration returned no result');
      if (
        registration.registration_type !== registrationType
        || registration.source_registration_id !== registrationId
      ) {
        throw new Error('membership change operation identity mismatch');
      }
      const publicRegistration = toPublicRegistration(registration);
      return res.status(registration.was_created ? 201 : 200).json({
        ...publicRegistration,
        registrationType: registration.registration_type,
        sourceRegistrationId: registration.source_registration_id || registrationId,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'membership renewal or upgrade failed' });
    }
  });

  router.post('/membership/registrations/:registrationId/activate', adminAuth, async (req, res) => {
    const access = getVerifiedMembershipAdmin(req);
    if (!access) return res.status(403).json({ error: 'verified membership admin session required' });

    const body = req.body || {};
    const registrationId = req.params.registrationId;
    const branchDecision = resolveMembershipActivationBranch(access, body.branch);
    const paymentMethod = body.payMethod || body.paymentMethod || body.payment_method;
    const paymentReference = body.paymentReference || body.payment_reference;
    const staffId = access.staffId;
    let payment;
    try {
      payment = validatePaymentInput({ paymentMethod, paymentReference });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!registrationId) return res.status(400).json({ error: 'registrationId required' });
    if (branchDecision.error) return res.status(branchDecision.status).json({ error: branchDecision.error });
    if (!staffId) return res.status(403).json({ error: 'authenticated staff identity required' });

    try {
      const { data, error } = await supabase.rpc('activate_membership_registration', {
        p_registration_id: registrationId,
        p_payment_method: payment.paymentMethod,
        p_payment_reference: payment.paymentReference,
        p_branch: branchDecision.branch,
        p_confirmed_by: staffId,
      });
      if (error) {
        return res.status(membershipActivationErrorStatus(error)).json({
          error: error.message || 'membership activation failed',
        });
      }
      const activation = Array.isArray(data) ? data[0] : data;
      if (!activation) throw new Error('membership activation returned no result');
      return res.json({
        success: true,
        registrationId: activation.registration_id || registrationId,
        activationId: activation.activation_id,
        tier: activation.tier,
        amount: activation.amount,
        startsAt: activation.starts_at,
        expiresAt: activation.expires_at,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'membership activation failed' });
    }
  });

  router.post('/membership/activate', adminAuth, async (req, res) => {
    const body = req.body || {};
    const registrationId = body.registrationId || body.registration_id;
    const branch = body.branch;
    const paymentMethod = body.payMethod || body.paymentMethod || body.payment_method;
    const paymentReference = body.paymentReference || body.payment_reference;
    const staffId = getAuthenticatedStaffId(req);
    if (typeof registrationId !== 'string' || !registrationId.trim()) {
      return res.status(400).json({ error: 'registrationId required' });
    }
    if (typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({ error: 'branch required' });
    }
    if (!staffId) {
      return res.status(403).json({ error: 'authenticated staff identity required' });
    }

    let payment;
    try {
      payment = validatePaymentInput({ paymentMethod, paymentReference });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const { data: activation, error: activationErr } = await supabase.rpc(
        'activate_membership_registration',
        {
          p_registration_id: registrationId.trim(),
          p_payment_method: payment.paymentMethod,
          p_payment_reference: payment.paymentReference,
          p_branch: branch.trim(),
          p_confirmed_by: staffId,
        }
      );
      if (activationErr) {
        return res.status(membershipActivationErrorStatus(activationErr)).json({
          error: activationErr.message || 'membership activation failed',
        });
      }
      const result = Array.isArray(activation) ? activation[0] : activation;
      if (!result) throw new Error('membership activation returned no result');
      return res.json({ success: true, registrationId: registrationId.trim(), ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'membership activation failed' });
    }
  });

  // ─── OWNER PAYMENT ANALYTICS ──────────────────────────────────────────
  const PAYMENT_COLORS = { cash: '#3b82f6', qris: '#8b5cf6', transfer: '#14b8a6', other: '#f59e0b' };
  const PAYMENT_NAMES  = { cash: 'Cash', qris: 'QRIS', transfer: 'Transfer', other: 'Lainnya' };

  function normalizePayment(raw) {
    const s = (raw || '').toLowerCase();
    if (s === 'cash' || s === 'tunai') return 'cash';
    if (s === 'qris' || s.includes('qris')) return 'qris';
    if (s.includes('transfer') || s.includes('mandiri') || s.includes('bni') ||
        s.includes('bca') || s.includes('ovo') || s.includes('dana') ||
        s.includes('gopay') || s.includes('shopeepay')) return 'transfer';
    return 'other';
  }

  router.get('/owner-payment-analytics', adminAuth, async (req, res) => {
    try {
      const { branch = 'all', period = '30d' } = req.query;

      const now = new Date();
      let startDate;
      if (period === 'today') {
        startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
      } else if (period === '7d') {
        startDate = new Date(now); startDate.setDate(now.getDate() - 6); startDate.setHours(0, 0, 0, 0);
      } else if (period === '30d') {
        startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0, 0, 0, 0);
      } else if (period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else {
        startDate = new Date(now); startDate.setDate(now.getDate() - 29); startDate.setHours(0, 0, 0, 0);
      }
      const startDateStr = startDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

      let q = supabase.from('moka_transactions')
        .select('outlet_slug, tx_date, net_sales, payment_method')
        .gte('tx_date', startDateStr)
        .limit(10000);
      if (branch !== 'all') q = q.eq('outlet_slug', branch);

      const { data: rows, error } = await q;
      if (error) return res.status(500).json({ error: error.message });

      const allRows = rows || [];

      // Methods totals
      const methodTotals = { cash: 0, qris: 0, transfer: 0, other: 0 };
      const methodCounts = { cash: 0, qris: 0, transfer: 0, other: 0 };
      for (const r of allRows) {
        const key = normalizePayment(r.payment_method);
        methodTotals[key] += r.net_sales || 0;
        methodCounts[key]++;
      }
      const grandTotal = Object.values(methodTotals).reduce((s, v) => s + v, 0);
      const methods = Object.keys(methodTotals).map(key => ({
        name:     PAYMENT_NAMES[key],
        key,
        total:    Math.round(methodTotals[key]),
        tx_count: methodCounts[key],
        pct:      grandTotal > 0 ? Math.round((methodTotals[key] / grandTotal) * 100) : 0,
        color:    PAYMENT_COLORS[key],
      }));

      // Daily trend
      const dailyMap = {};
      for (const r of allRows) {
        const d = r.tx_date;
        if (!dailyMap[d]) dailyMap[d] = { date: d, cash: 0, qris: 0, transfer: 0, other: 0 };
        const key = normalizePayment(r.payment_method);
        dailyMap[d][key] += r.net_sales || 0;
      }
      const daily_trend = Object.values(dailyMap)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => ({ ...d, cash: Math.round(d.cash), qris: Math.round(d.qris), transfer: Math.round(d.transfer), other: Math.round(d.other) }));

      // By branch
      const branchMap = {};
      for (const r of allRows) {
        const sl = r.outlet_slug;
        if (!branchMap[sl]) branchMap[sl] = { slug: sl, name: sl, cash: 0, qris: 0, transfer: 0, other: 0, total: 0 };
        const key = normalizePayment(r.payment_method);
        branchMap[sl][key] += r.net_sales || 0;
        branchMap[sl].total += r.net_sales || 0;
      }

      // Enrich with outlet names
      const { data: outlets } = await supabase.from('outlets').select('slug, name');
      for (const o of (outlets || [])) {
        if (branchMap[o.slug]) branchMap[o.slug].name = o.name;
      }

      const by_branch = Object.values(branchMap)
        .sort((a, b) => b.total - a.total)
        .map(b => ({ ...b, cash: Math.round(b.cash), qris: Math.round(b.qris), transfer: Math.round(b.transfer), other: Math.round(b.other), total: Math.round(b.total) }));

      return res.json({ methods, daily_trend, by_branch });
    } catch (err) {
      console.error('[PaymentAnalytics]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/crm/impersonate-barber ────────────────────────────────────
  // Admin-only: create a barber session for any barber by name (fuzzy match).
  // Returns token as JSON so the Next.js proxy can set the httpOnly cookie.
  // Usage: GET /api/admin/crm/impersonate-barber?name=onoy
  router.get('/impersonate-barber', adminAuth, async (req, res) => {
    const { randomUUID } = require('crypto');
    const name = (req.query.name || '').toLowerCase().trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data: barbers } = await supabase
      .from('barbers').select('id, name, branch').eq('is_active', true);
    const match = (barbers || []).find(b =>
      b.name.toLowerCase().includes(name) || name.includes(b.name.toLowerCase().split(' ')[0])
    );
    if (!match) return res.status(404).json({ error: `Barber '${name}' not found`, available: (barbers||[]).map(b=>b.name) });

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('barber_sessions').insert({ token, barber_id: match.id, expires_at: expiresAt });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, token, barber: { id: match.id, name: match.name, branch: match.branch } });
  });

  // ── POST /api/admin/crm/broadcast-barbers ──────────────────────────────────
  // Kirim broadcast WA ke seluruh kapster aktif, dari nomor aibot cabangnya.
  // Body (JSON) atau query params:
  //   branch  - filter ke cabang tertentu (opsional)
  //   dry_run - jika "true", hanya preview tanpa kirim
  router.post('/broadcast-barbers', adminAuth, async (req, res) => {
    const { sendWA } = require('../services/fonnte');
    const filterBranch = (req.body?.branch || req.query.branch || '').toLowerCase().trim();
    const dryRun = req.body?.dry_run === true || req.query.dry_run === 'true';

    const MESSAGE_TEMPLATE = `Selamat siang, Kak *{NAMA}* 👋

Kami ingin menginformasikan bahwa *Dashboard Kapster Redbox Barbershop* kini sudah dapat diakses langsung melalui handphone.

📱 Link akses:
admin.redboxbarbershop.com

Cara login:
1. Buka link di atas.
2. Pilih menu *Kapster*.
3. Masukkan nomor WhatsApp yang terdaftar.
4. Sistem akan mengirimkan kode OTP ke nomor tersebut.
5. Masukkan kode OTP untuk masuk ke akun Anda.

Melalui dashboard ini, Kakak dapat mengakses informasi dan fitur yang berkaitan dengan aktivitas kerja secara lebih mudah langsung dari perangkat mobile.

Apabila mengalami kendala saat login atau tidak menerima kode OTP, silakan hubungi admin cabang masing-masing.

Terima kasih 🙏
*Management Redbox Barbershop*`;

    let query = supabase.from('barbers').select('id, name, branch, phone').eq('is_active', true);
    if (filterBranch) query = query.eq('branch', filterBranch);
    const { data: barbers, error } = await query.order('branch').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const sent = [];
    const skipped = [];
    const failed = [];

    for (const barber of (barbers || [])) {
      if (!barber.phone) {
        skipped.push({ id: barber.id, name: barber.name, branch: barber.branch, reason: 'no_phone' });
        continue;
      }
      const firstName = barber.name.trim().split(/\s+/)[0];
      const message = MESSAGE_TEMPLATE.replace('{NAMA}', firstName);

      if (dryRun) {
        sent.push({ id: barber.id, name: barber.name, branch: barber.branch, phone: barber.phone, message });
        continue;
      }

      try {
        const result = await sendWA(barber.phone, message, { branch: barber.branch });
        if (result && result.status !== false) {
          sent.push({ id: barber.id, name: barber.name, branch: barber.branch, phone: barber.phone });
        } else {
          failed.push({ id: barber.id, name: barber.name, branch: barber.branch, phone: barber.phone, error: result?.error || result?.detail || 'unknown' });
        }
      } catch (err) {
        failed.push({ id: barber.id, name: barber.name, branch: barber.branch, phone: barber.phone, error: err.message });
      }

      // 800ms delay antar pesan agar tidak kena rate-limit Fonnte
      await new Promise(r => setTimeout(r, 800));
    }

    return res.json({
      ok: true,
      dry_run: dryRun,
      summary: { sent: sent.length, skipped: skipped.length, failed: failed.length },
      sent,
      skipped,
      failed,
    });
  });

  return router;
}

module.exports = { createAdminCrmRoutes, createMembershipRegistrationRoutes };
