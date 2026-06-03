// server/routes/adminCrm.js
'use strict';
const express = require('express');

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

function createAdminCrmRoutes(supabase, adminAuth) {
  const router = express.Router();

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
      const { data: counts } = await supabase
        .from('barber_daily_counts').select('barber_id, count')
        .in('barber_id', barberIds)
        .gte('date', monthStart).lte('date', today);

      const map = {};
      for (const r of (counts || [])) map[r.barber_id] = (map[r.barber_id] || 0) + r.count;

      const ranked = barbers
        .map(b => ({ ...b, score: map[b.id] || 0, display: `${map[b.id] || 0} customer` }))
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

  return router;
}

module.exports = { createAdminCrmRoutes };
