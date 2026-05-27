'use strict';
// ============================================================
// MOKA POS  —  Express Router
//
// Mount in index.js:
//   const createMokaRouter = require('./moka/routes');
//   app.use('/api', createMokaRouter(supabase));
//
// Endpoints:
//   GET  /api/availability          — slot engine
//   POST /api/reservations          — create booking (web→Moka)
//   GET  /api/schedules             — list schedules
//   PATCH /api/schedules/:id        — update status
//   GET  /api/moka/auth             — begin OAuth flow
//   GET  /api/moka/callback         — OAuth code exchange
//   POST /api/moka/webhook          — Moka real-time events
//   POST /api/moka/sync             — manual pull trigger
//   GET  /api/moka/sync-logs        — recent sync audit
//   GET  /api/moka/items            — Moka product list + mapping status
//   POST /api/moka/map-items        — save service↔Moka item mappings
//   GET  /api/moka/status           — OAuth + last-sync health check
// ============================================================

const express          = require('express');
const { randomUUID }   = require('crypto');

const { buildAuthorizationUrl, exchangeCode, getTokenInfo, isMokaOAuthConfigured } = require('./oauth');
const { pushScheduleToMoka, pushCheckoutToMoka, pullMokaToWeb, handleWebhookEvent, maybeRefreshOutletData, getLastSyncAt } = require('./sync');
const { getAvailableSlots, isSlotAvailable }                           = require('./slotEngine');

/**
 * Factory — returns a configured Express Router.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
function createMokaRouter(supabase) {
  const router = express.Router();

  // ── GET /api/availability ────────────────────────────────
  // Query params:
  //   outletId        (required) — our DB UUID  OR  outlet slug
  //   date            (required) — YYYY-MM-DD
  //   serviceId       (optional) — UUID; used to look up duration
  //   durationMinutes (optional) — override duration
  //   barberId        (optional) — filter to one barber
  //
  // Example response:
  // [
  //   { "start": "2025-05-01T09:00:00.000Z", "end": "2025-05-01T09:30:00.000Z",
  //     "barberId": "bypass1", "barberName": "Alex Chillboy UA" },
  //   ...
  // ]
  router.get('/availability', async (req, res) => {
    try {
      const { outletId: rawOutletId, date, serviceId, durationMinutes, barberId } = req.query;

      if (!rawOutletId) return res.status(400).json({ error: 'outletId is required' });
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

      // Resolve outletId — accept UUID or slug
      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      // IMPORTANT: await sync so it completes in serverless (Vercel) before response.
      // Without await, the function terminates and Moka open bills never reach schedules table.
      await _refreshFreshTodayData(supabase, outletId, date).catch(() => {});

      // Resolve duration
      let duration = durationMinutes ? parseInt(durationMinutes, 10) : null;
      if (!duration && serviceId) {
        const { data: svc } = await supabase
          .from('services').select('duration_minutes').eq('id', serviceId).single();
        duration = svc?.duration_minutes;
      }
      duration = duration || 30; // fallback to 30 min

      const slots = await getAvailableSlots(supabase, {
        outletId,
        date,
        durationMinutes: duration,
        barberId:        barberId || null,
      });

      res.json({
        date,
        outletId,
        durationMinutes: duration,
        slots,
        lastSyncAt: getLastSyncAt(outletId),
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  router.get('/slot-blockers', async (req, res) => {
    try {
      const { outletId: rawOutletId, date, barberId, durationMinutes, slots, onlyBlocked, summary } = req.query;

      if (!rawOutletId) return res.status(400).json({ error: 'outletId is required' });
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      if (!barberId) return res.status(400).json({ error: 'barberId is required' });

      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      let outletSlug = null;
      try {
        const { data: o } = await supabase.from('outlets').select('slug').eq('id', outletId).single();
        outletSlug = o?.slug || null;
      } catch {}

      const duration = Math.max(1, parseInt(durationMinutes, 10) || 60);

      const slotTimes = (() => {
        if (slots) {
          return String(slots)
            .split(',')
            .map(s => s.trim())
            .filter(s => /^\d{2}:\d{2}$/.test(s));
        }
        const end = outletSlug === 'csb' ? 21 : 20;
        const arr = [];
        for (let h = 10; h <= end; h++) arr.push(String(h).padStart(2, '0') + ':00');
        return arr;
      })();

      const dayStart = `${date}T00:00:00+07:00`;
      const dayEnd   = `${date}T23:59:59+07:00`;

      await _refreshFreshTodayData(supabase, outletId, date).catch(() => {});

      const [{ data: schedules }, { data: outletWide }, { data: legacyBookings }] = await Promise.all([
        supabase
          .from('schedules')
          .select('id, barber_id, start_time, end_time, status, source, external_id, service_name, notes, outlet_id')
          .eq('outlet_id', outletId)
          .eq('barber_id', barberId)
          .not('status', 'in', '("cancelled")')
          .lt('start_time', dayEnd)
          .gt('end_time', dayStart),
        supabase
          .from('schedules')
          .select('id, barber_id, start_time, end_time, status, source, external_id, service_name, notes, outlet_id')
          .eq('outlet_id', outletId)
          .is('barber_id', null)
          .not('status', 'in', '("cancelled")')
          .lt('start_time', dayEnd)
          .gt('end_time', dayStart),
        supabase
          .from('bookings')
          .select('id, barber_id, date, time, duration, status, service')
          .eq('date', date)
          .eq('barber_id', barberId)
          .not('status', 'in', '("cancelled","rejected")'),
      ]);

      const bookingRanges = (legacyBookings || [])
        .map(b => {
          const t = String(b.time || '').slice(0, 5);
          if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
          const start = _timeStrToMs(date, t);
          const dur   = _parseDurationStr(b.duration);
          return { ...b, start, end: start + dur * 60_000, durationMinutes: dur };
        })
        .filter(Boolean);

      const results = slotTimes.map(t => {
        const start = _timeStrToMs(date, t);
        const end   = start + duration * 60_000;
        const hits = {
          schedules: (schedules || []).filter(s => start < new Date(s.end_time).getTime() && end > new Date(s.start_time).getTime()),
          outletWide: (outletWide || []).filter(s => start < new Date(s.end_time).getTime() && end > new Date(s.start_time).getTime()),
          bookings: bookingRanges.filter(b => start < b.end && end > b.start).map(b => ({
            id: b.id,
            date: b.date,
            time: String(b.time || '').slice(0, 5),
            duration: b.duration,
            durationMinutes: b.durationMinutes,
            status: b.status,
            service: b.service,
          })),
        };
        const blocked = hits.schedules.length > 0 || hits.outletWide.length > 0 || hits.bookings.length > 0;
        return { time: t, start: new Date(start).toISOString(), end: new Date(end).toISOString(), blocked, hits };
      });

      const onlyBlockedBool = String(onlyBlocked || '').toLowerCase() === 'true' || String(onlyBlocked || '') === '1';
      const summaryBool = String(summary || '').toLowerCase() === 'true' || String(summary || '') === '1';

      const filteredResults = onlyBlockedBool ? results.filter(r => r.blocked) : results;
      const finalResults = summaryBool
        ? filteredResults.map(r => ({
            time: r.time,
            blocked: r.blocked,
            blockedBy: {
              schedules: r.hits.schedules.map(s => ({
                id: s.id,
                status: s.status,
                source: s.source,
                external_id: s.external_id,
                service_name: s.service_name,
                start_time: s.start_time,
                end_time: s.end_time,
                notes: s.notes,
              })),
              outletWide: r.hits.outletWide.map(s => ({
                id: s.id,
                status: s.status,
                source: s.source,
                external_id: s.external_id,
                service_name: s.service_name,
                start_time: s.start_time,
                end_time: s.end_time,
                notes: s.notes,
              })),
              bookings: r.hits.bookings,
            },
          }))
        : filteredResults;

      res.json({
        outletId,
        outletSlug,
        barberId,
        date,
        durationMinutes: duration,
        slotTimes,
        results: finalResults,
        lastSyncAt: getLastSyncAt(outletId),
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  router.get('/slot-blockers/yudha-csb', async (req, res) => {
    try {
      const { date, durationMinutes, slots } = req.query;
      const d = date || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

      const { data: outlet } = await supabase.from('outlets').select('id').eq('slug', 'csb').single();
      if (!outlet?.id) return res.status(404).json({ error: 'Outlet not found: csb' });

      const { data: barbers } = await supabase
        .from('barbers')
        .select('id,name')
        .eq('outlet_id', outlet.id)
        .eq('is_active', true)
        .ilike('name', '%yudha%')
        .limit(3);

      const barberId = barbers?.[0]?.id || null;
      if (!barberId) return res.status(404).json({ error: 'Barber not found: yudha (csb)' });

      const qs = new URLSearchParams({
        outletId: outlet.id,
        date: d,
        barberId,
        onlyBlocked: '1',
        summary: '1',
      });
      if (durationMinutes) qs.set('durationMinutes', String(durationMinutes));
      if (slots) qs.set('slots', String(slots));

      res.redirect(302, `/api/slot-blockers?${qs.toString()}`);
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/reservations ────────────────────────────────
  // Creates a schedule, then asynchronously pushes to Moka.
  //
  // Request body:
  // {
  //   "outletId":  "uuid-or-slug",
  //   "barberId":  "bypass1",           // or null for "any"
  //   "serviceId": "uuid",
  //   "startTime": "2025-05-01T09:00:00+07:00",
  //   "customer": {
  //     "name":  "Budi Santoso",
  //     "phone": "081234567890",
  //     "email": "budi@example.com"
  //   },
  //   "notes": "optional"
  // }
  //
  // Response 201:
  // { "scheduleId": "uuid", "status": "reserved", "mokaSync": "pending" }
  router.post('/reservations', async (req, res) => {
    try {
      const { outletId: rawOutletId, barberId, serviceId, startTime, customer, notes } = req.body;

      // ── Validate required fields ────────────────────────────
      const missing = [];
      if (!rawOutletId) missing.push('outletId');
      if (!startTime)   missing.push('startTime');
      if (!customer?.name)  missing.push('customer.name');
      if (!customer?.phone) missing.push('customer.phone');
      if (missing.length)
        return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

      // ── Resolve outlet ──────────────────────────────────────
      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      // ── Resolve service ─────────────────────────────────────
      let service = null;
      if (serviceId) {
        const { data: svc } = await supabase
          .from('services').select('*').eq('id', serviceId).single();
        service = svc;
      }
      const duration = service?.duration_minutes || 30;
      const price    = service?.price            || 0;

      // ── Calculate end time ──────────────────────────────────
      const startMs = new Date(startTime).getTime();
      if (isNaN(startMs)) return res.status(400).json({ error: 'Invalid startTime format' });
      const endTime = new Date(startMs + duration * 60_000).toISOString();

      // ── Resolve barber (auto-assign if null or 'any') ────────
      let resolvedBarberId = barberId && barberId !== 'any' ? barberId : null;
      if (!resolvedBarberId) {
        const { data: autoBarber } = await supabase.rpc('find_available_barber', {
          p_outlet_id: outletId,
          p_start:     startTime,
          p_end:       endTime,
        });
        resolvedBarberId = autoBarber || null;
        if (!resolvedBarberId)
          return res.status(409).json({ error: 'No barbers available for the requested time slot' });
      }

      // ── Check slot availability ─────────────────────────────
      const free = await isSlotAvailable(supabase, {
        barberId:  resolvedBarberId,
        startTime,
        endTime,
      });
      if (!free)
        return res.status(409).json({ error: 'Slot already booked — choose a different time or barber' });

      // ── Check outlet-wide GoShow blocks (open bills with unresolved barber) ──
      // The check_barber_overlap RPC only matches by specific barber_id, so
      // schedules inserted with barber_id=null from unmatched Moka open bills
      // would slip through. We catch them here explicitly.
      const { data: outletBlocks } = await supabase
        .from('schedules')
        .select('id')
        .eq('outlet_id', outletId)
        .is('barber_id', null)
        .not('status', 'in', '("cancelled","completed")')
        .lt('start_time', endTime)
        .gt('end_time', startTime)
        .limit(1);

      if (outletBlocks?.length > 0)
        return res.status(409).json({ error: 'Slot blocked by walk-in (GoShow) — choose a different time' });

      // ── Upsert customer ─────────────────────────────────────
      const phone = _normalizePhone(customer.phone);
      let customerId = null;

      const { data: existingCust } = await supabase
        .from('customers').select('id').eq('phone_e164', phone).maybeSingle();

      if (existingCust) {
        customerId = existingCust.id;
      } else {
        const { data: newCust } = await supabase
          .from('customers')
          .insert({
            name: customer.name,
            wa: phone,
            phone_e164: phone,
            email: customer.email || null,
            source: 'web',
          })
          .select('id').single();
        customerId = newCust?.id;
      }

      // ── Insert schedule ─────────────────────────────────────
      const { data: schedule, error: schErr } = await supabase
        .from('schedules')
        .insert({
          outlet_id:    outletId,
          barber_id:    resolvedBarberId,
          customer_id:  customerId,
          service_id:   serviceId || null,
          service_name: service?.name || null,
          price,
          start_time:   startTime,
          end_time:     endTime,
          status:       'confirmed',
          source:       'web',
          notes:        notes || null,
        })
        .select()
        .single();

      if (schErr) {
        // Overlap constraint violation
        if (schErr.code === '23P01' || schErr.message?.includes('no_barber_overlap'))
          return res.status(409).json({ error: 'Double-booking detected — slot taken' });
        throw new Error(schErr.message);
      }

      // ── Push ke Moka secara real-time ────────────────────────
      let mokaSync = 'skipped';
      let mokaSyncDetail = null;
      if (isMokaOAuthConfigured()) {
        try {
          const result = await pushScheduleToMoka(supabase, schedule.id);
          mokaSync = 'success';
          mokaSyncDetail = result;
        } catch (err) {
          mokaSync = 'failed';
          mokaSyncDetail = err.message;
          console.error(`[Reservation] Moka push failed for ${schedule.id}:`, err.message);
        }
      }

      res.status(201).json({
        scheduleId:   schedule.id,
        status:       schedule.status,
        startTime:    schedule.start_time,
        endTime:      schedule.end_time,
        barberId:     schedule.barber_id,
        mokaSync,
        mokaSyncDetail,
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/schedules ────────────────────────────────────
  // Query params: outletId, date (YYYY-MM-DD), status, barberId
  //
  // Example response:
  // {
  //   "schedules": [
  //     { "id": "uuid", "barber_name": "Alex", "customer_name": "Budi",
  //       "service_name": "Haircut", "start_time": "...", "status": "confirmed", "source": "web" }
  //   ]
  // }
  router.get('/schedules', async (req, res) => {
    try {
      const { outletId: rawOutletId, date, status, barberId, source, limit = 100 } = req.query;
      let outletId = null;

      let query = supabase
        .from('schedules_full')
        .select('id,barber_id,barber_name,barber_role,customer_id,customer_name,customer_phone,service_name,price,start_time,end_time,status,source,external_id,notes,outlet_id,outlet_name')
        .order('start_time', { ascending: false })
        .limit(parseInt(limit, 10) || 100);

      if (rawOutletId) {
        outletId = await _resolveOutletId(supabase, rawOutletId);
        if (outletId) query = query.eq('outlet_id', outletId);
        if (outletId) await _refreshFreshTodayData(supabase, outletId, date).catch(() => {});
      }
      if (date) {
        const dayStart = `${date}T00:00:00+07:00`;
        const dayEnd   = `${date}T23:59:59+07:00`;
        query = query.gte('start_time', dayStart).lte('start_time', dayEnd);
      }
      if (status)   query = query.eq('status', status);
      if (barberId) query = query.eq('barber_id', barberId);
      if (source)   query = query.eq('source', source);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      res.json({ schedules: data || [], lastSyncAt: outletId ? getLastSyncAt(outletId) : null });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── PATCH /api/schedules/:id ──────────────────────────────
  // Update status (confirm, cancel, complete, start).
  // Body: { "status": "confirmed" }
  router.patch('/schedules/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const allowed = ['reserved','confirmed','in_progress','completed','cancelled'];

      if (!status || !allowed.includes(status))
        return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

      const { data, error } = await supabase
        .from('schedules')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      if (!data)  return res.status(404).json({ error: 'Schedule not found' });

      // If cancelling, also propagate to Moka
      if (status === 'cancelled' && data.external_id && isMokaOAuthConfigured()) {
        _cancelMokaOrder(supabase, data).catch(err => {
          console.warn('[Patch] Moka cancel failed:', err.message);
        });
      }

      // If completing a web-origin reservation, push a POS checkout so it appears
      // in Moka's Produk Terjual report. Fire-and-forget — response is not blocked.
      if (status === 'completed' && data.source === 'web' && isMokaOAuthConfigured()) {
        pushCheckoutToMoka(supabase, id).catch(err => {
          console.warn('[Patch] Moka checkout push failed:', err.message);
        });
      }

      res.json({ schedule: data });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/auth ────────────────────────────────────
  // Initiates Moka OAuth authorization code flow.
  // Admin visits this URL; gets redirected to Moka consent screen.
  // Query: outletId (UUID or slug)
  router.get('/moka/auth', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured())
        return res.status(503).json({ error: 'Moka OAuth not configured. Set MOKA_CLIENT_ID, MOKA_CLIENT_SECRET, MOKA_REDIRECT_URI in .env' });

      const { outletId: rawOutletId } = req.query;
      if (!rawOutletId) return res.status(400).json({ error: 'outletId is required' });

      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      // CSRF state: encode outletId so callback can pick it up
      const state = Buffer.from(JSON.stringify({ outletId, nonce: randomUUID() })).toString('base64url');
      const authUrl = buildAuthorizationUrl(state);

      // In a real app, store state in session/cookie for CSRF verification
      res.redirect(authUrl);
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/callback ────────────────────────────────
  // OAuth redirect target. Exchanges code for tokens.
  // Query: code, state (base64url-encoded { outletId, nonce })
  // Also handles Moka "Launch" button which sends code without state.
  router.get('/moka/callback', async (req, res) => {
    try {
      const { code, state, error: oauthErr, error_description } = req.query;

      if (oauthErr)
        return res.status(400).json({ error: `Moka OAuth error: ${oauthErr} — ${error_description}` });
      if (!code)
        return res.status(400).json({ error: 'Missing code' });

      // If state is missing (Moka Launch button), apply token to ALL outlets
      if (!state) {
        const { data: outlets } = await supabase.from('outlets').select('id').eq('is_active', true);
        const results = [];
        for (const outlet of outlets || []) {
          try {
            await exchangeCode(supabase, code, outlet.id);
            results.push({ outletId: outlet.id, status: 'success' });
            // Code can only be used once — subsequent outlets reuse the stored token
            break;
          } catch (e) {
            results.push({ outletId: outlet.id, status: 'failed', error: e.message });
            break;
          }
        }
        // Copy first outlet token to all others
        const { data: firstToken } = await supabase.from('moka_tokens').select('*').single();
        if (firstToken) {
          for (const outlet of outlets || []) {
            if (outlet.id === firstToken.outlet_id) continue;
            await supabase.from('moka_tokens').upsert(
              { ...firstToken, outlet_id: outlet.id, updated_at: new Date().toISOString() },
              { onConflict: 'outlet_id' }
            );
          }
        }
        return res.json({
          message: 'Moka OAuth successful — tokens applied to all outlets',
          outlets: (outlets || []).length,
          note: 'Tokens stored. Sync will begin on next cron tick or via POST /api/moka/sync',
        });
      }

      // Decode state (normal OAuth flow)
      let outletId;
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
        outletId = decoded.outletId;
      } catch {
        return res.status(400).json({ error: 'Invalid state parameter' });
      }

      await exchangeCode(supabase, code, outletId);

      res.json({
        message: `Moka OAuth successful for outlet ${outletId}`,
        outletId,
        note: 'Tokens stored. Sync will begin on next cron tick or via POST /api/moka/sync',
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/moka/callback/:event ──────────────────────
  // Moka Advanced Ordering per-order callbacks.
  //
  // These URLs are registered per-order when we call createOrder().
  // Moka POSTs here when the cashier acts on an order:
  //
  //   POST /api/moka/callback/accept   → cashier accepted order
  //   POST /api/moka/callback/complete → cashier completed/paid order
  //   POST /api/moka/callback/cancel   → cashier rejected/cancelled order
  //
  // Moka payload:
  //   { "outlet_id": 123, "application_order_id": "<our-schedule-uuid>", "status": "accepted" }
  //
  // APP_BASE_URL in .env must be reachable by Moka servers.
  for (const cbEvent of ['accept', 'complete', 'cancel']) {
    router.post(`/moka/callback/${cbEvent}`, async (req, res) => {
      try {
        const body = req.body;

        if (!body?.application_order_id) {
          console.warn(`[Callback/${cbEvent}] Missing application_order_id:`, body);
          return res.status(400).json({ error: 'Missing application_order_id' });
        }

        // Acknowledge immediately — Moka expects < 5s response
        res.status(200).json({ received: true });

        // Process asynchronously
        handleWebhookEvent(supabase, body).catch(err => {
          console.error(`[Callback/${cbEvent}] Processing error:`, err.message);
        });

      } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Callback processing failed' });
        console.error(`[Callback/${cbEvent}] Fatal error:`, err);
      }
    });
  }

  // ── GET /api/moka/cron ───────────────────────────────────
  // Vercel Cron Job endpoint — called by Vercel platform every minute.
  // No auth needed (Vercel adds x-vercel-cron header automatically).
  // Responds 200 immediately; sync runs in background so cron doesn't timeout.
  router.get('/moka/cron', async (req, res) => {
    // Only allow calls from Vercel cron or CRON_SECRET bearer
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!isVercelCron && cronSecret && token !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.status(200).json({ message: 'Cron sync triggered', ts: new Date().toISOString() });

    // Run sync for all outlets in background
    setImmediate(async () => {
      try {
        const { data: tokens } = await supabase.from('moka_tokens').select('outlet_id');
        for (const t of tokens || []) {
          await pullMokaToWeb(supabase, t.outlet_id).catch(err =>
            console.error(`[Cron] Outlet ${t.outlet_id}:`, err.message)
          );
        }
      } catch (err) {
        console.error('[Cron] Sync error:', err.message);
      }
    });
  });

  // ── GET /api/moka/cron-sync ────────────────────────────────
  // Vercel Cron endpoint (GET) - no auth needed, called by Vercel Cron
  // Query: outletId (optional, default: all authorized outlets)
  router.get('/moka/cron-sync', async (req, res) => {
    try {
      const { outletId: rawOutletId } = req.query;
      
      const _runSync = async () => {
        const results = [];
        if (rawOutletId) {
          const outletId = await _resolveOutletId(supabase, rawOutletId);
          if (!outletId) return [{ error: `Outlet not found: ${rawOutletId}` }];
          const result = await pullMokaToWeb(supabase, outletId);
          results.push({ outletId, ...result });
        } else {
          const { data: tokens } = await supabase
            .from('moka_tokens').select('outlet_id');
          for (const t of tokens || []) {
            const result = await pullMokaToWeb(supabase, t.outlet_id).catch(err => ({
              error: err.message, processed: 0, skipped: 0, errors: 1,
            }));
            results.push({ outletId: t.outlet_id, ...result });
          }
        }
        return results;
      };
      
      const results = await _runSync();
      return res.json({ ok: true, syncedAt: new Date().toISOString(), results });
    } catch (err) {
      console.error('[CronSync] Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/moka/sync ───────────────────────────────────
  // Manual trigger for Moka → Web pull sync.
  // Body (optional): { "outletId": "uuid-or-slug", "wait": true }
  // If omitted, syncs ALL authorized outlets.
  // Auth: Bearer <CRON_SECRET|ADMIN_PASSWORD> or x-admin-token <CRON_SECRET|ADMIN_PASSWORD>
  //
  // Default: respond 202 immediately, sync runs in background.
  // Pass "wait": true in body to wait for sync completion (manual use only).
  router.post('/moka/sync', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const validTokens = [cronSecret, adminPassword].filter(Boolean);
    if (validTokens.length > 0) {
      const auth = req.headers['authorization'] || '';
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const xToken = req.headers['x-admin-token'] || '';
      if (!validTokens.includes(bearer) && !validTokens.includes(xToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    try {
      const { outletId: rawOutletId, wait = false } = req.body || {};

      const _runSync = async () => {
        const results = [];
        if (rawOutletId) {
          const outletId = await _resolveOutletId(supabase, rawOutletId);
          if (!outletId) return [{ error: `Outlet not found: ${rawOutletId}` }];
          const result = await pullMokaToWeb(supabase, outletId);
          results.push({ outletId, ...result });
        } else {
          const { data: tokens } = await supabase
            .from('moka_tokens').select('outlet_id');
          for (const t of tokens || []) {
            const result = await pullMokaToWeb(supabase, t.outlet_id).catch(err => ({
              error: err.message, processed: 0, skipped: 0, errors: 1,
            }));
            results.push({ outletId: t.outlet_id, ...result });
          }
        }
        return results;
      };

      if (wait) {
        // Blocking mode — for manual calls that need the result
        const results = await _runSync();
        return res.json({ message: 'Sync complete', results });
      }

      // Non-blocking: respond immediately so cron callers (cron-job.org) don't timeout.
      // Vercel Fluid Compute keeps the function alive until the promise settles.
      res.status(202).json({ message: 'Sync started', status: 'processing' });
      _runSync().catch(err => console.error('[Sync] Background sync error:', err.message));

    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/sync-logs ───────────────────────────────
  // Returns recent sync audit log entries.
  // Query: direction, status, limit (default 50)
  router.get('/moka/sync-logs', async (req, res) => {
    try {
      const { direction, status, limit = 50 } = req.query;

      let query = supabase
        .from('sync_logs')
        .select('id,direction,entity_type,entity_id,status,error_message,retry_count,created_at')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit, 10) || 50);

      if (direction) query = query.eq('direction', direction);
      if (status)    query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      res.json({ logs: data || [] });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/token-info ──────────────────────────────
  // Returns current token scopes and expiry info
  router.get('/moka/token-info', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured()) {
        return res.status(503).json({ error: 'Moka OAuth not configured' });
      }
      const { outletId = 'default-outlet' } = req.query;
      const info = await getTokenInfo(supabase, outletId);
      res.json(info);
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/discover-business-id ────────────────────
  // Probe Moka API to find the correct business_id for customer sync.
  router.get('/moka/discover-business-id', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured())
        return res.status(503).json({ error: 'Moka OAuth not configured' });

      const { data: outlets } = await supabase
        .from('outlets').select('id, slug, moka_outlet_id').eq('is_active', true).not('moka_outlet_id', 'is', null).limit(1);
      const outlet = outlets?.[0];
      if (!outlet) return res.status(404).json({ error: 'No outlet with moka_outlet_id found' });

      const MokaClient = require('./client');
      const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
      const probeResults = await client.discoverBusinessId();

      const { getTokenInfo: getTI } = require('./oauth');
      const tokenInfo = await getTI(supabase, outlet.id).catch(e => ({ error: e.message }));

      res.json({
        outlet_slug: outlet.slug,
        moka_outlet_id_in_db: outlet.moka_outlet_id,
        moka_outlet_id_env: process.env.MOKA_OUTLET_ID || null,
        moka_business_id_env: process.env.MOKA_BUSINESS_ID || null,
        token_info: tokenInfo,
        probe_results: probeResults,
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/moka/test-customer ───────────────────────────
  // Test Moka customer creation
  router.post('/moka/test-customer', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured()) {
        return res.status(503).json({ error: 'Moka OAuth not configured' });
      }
      
      const { createInMemorySupabase } = require('./memoryStore');
      const MokaClient = require('./client');
      
      const memorySupabase = createInMemorySupabase();
      const outletId = process.env.MOKA_OUTLET_ID || '2000001165';
      const client = new MokaClient(memorySupabase, 'default-outlet', outletId);
      
      const result = await client.createCustomer(req.body);
      res.json({ success: true, result });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/moka/test-order ──────────────────────────────
  // Test Moka order creation
  router.post('/moka/test-order', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured()) {
        return res.status(503).json({ error: 'Moka OAuth not configured' });
      }

      const { createInMemorySupabase } = require('./memoryStore');
      const MokaClient = require('./client');

      const memorySupabase = createInMemorySupabase();
      const outletId = process.env.MOKA_OUTLET_ID || '2000001165';
      const client = new MokaClient(memorySupabase, 'default-outlet', outletId);

      const result = await client.createOrder(req.body);
      res.json({ success: true, result });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/test-open-bills ──────────────────────────
  // Diagnostic endpoint to test Moka API open bills endpoint variations
  // Query: outletId (required), date (optional, default today)
  router.get('/moka/test-open-bills', async (req, res) => {
    try {
      const { outletId: rawOutletId, date } = req.query;
      if (!rawOutletId) return res.status(400).json({ error: 'outletId is required' });

      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      const { data: outlet } = await supabase.from('outlets').select('id, slug, moka_outlet_id').eq('id', outletId).single();
      if (!outlet?.moka_outlet_id) return res.status(404).json({ error: 'Missing moka_outlet_id' });

      const { getAccessToken } = require('./oauth');
      const token = await getAccessToken(supabase, outletId);
      const mokaOutletId = outlet.moka_outlet_id;
      const testDate = date || new Date().toISOString().slice(0, 10);
      const [y, m, d] = testDate.split('-');
      const fmtDateDDMMYYYY = `${d}/${m}/${y}`;  // DD/MM/YYYY format
      const fmtDateISO = testDate;  // YYYY-MM-DD format
      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

      // Test endpoint variations - comprehensive API path discovery
      const variations = [
        // Token validity check
        { name: 'token_check_outlets', path: `/v1/outlets?per_page=1` },
        { name: 'token_check_me', path: `/v1/me` },
        // Original sync_bills variations
        { name: 'sync_bills_with_slash', path: `/v1/outlets/${mokaOutletId}/sync_bills/?statuses=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5&deep=true` },
        { name: 'sync_bills_no_slash', path: `/v1/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5&deep=true` },
        { name: 'v2_sync_bills', path: `/v2/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        { name: 'v3_sync_bills', path: `/v3/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        // Bills variations with DD/MM/YYYY
        { name: 'v1_bills', path: `/v1/outlets/${mokaOutletId}/bills?status=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        { name: 'v2_bills', path: `/v2/outlets/${mokaOutletId}/bills?status=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        { name: 'v3_bills', path: `/v3/outlets/${mokaOutletId}/bills?status=pending&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        // Bills with ISO date format (YYYY-MM-DD)
        { name: 'v1_bills_iso', path: `/v1/outlets/${mokaOutletId}/bills?status=PENDING&start=${fmtDateISO}&end=${fmtDateISO}&per_page=5` },
        { name: 'v1_bills_created_after', path: `/v1/outlets/${mokaOutletId}/bills?status=PENDING&created_after=${fmtDateISO}&per_page=5` },
        // Original format tests
        { name: 'v1_outlet_bills', path: `/v1/bills?outlet_id=${mokaOutletId}&status=PENDING&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        // Orders variations
        { name: 'v1_orders', path: `/v1/outlets/${mokaOutletId}/orders?status=pending&start_date=${fmtDateDDMMYYYY}&end_date=${fmtDateDDMMYYYY}&per_page=5` },
        { name: 'v1_orders_iso', path: `/v1/outlets/${mokaOutletId}/orders?status=pending&start_date=${fmtDateISO}&end_date=${fmtDateISO}&per_page=5` },
        { name: 'v1_advanced_orders', path: `/v1/outlets/${mokaOutletId}/advanced_orderings/orders?per_page=5` },
        // Alternative formats
        { name: 'v1_open_bills', path: `/v1/outlets/${mokaOutletId}/open_bills?per_page=5` },
        { name: 'v1_pending_bills', path: `/v1/outlets/${mokaOutletId}/pending_bills?per_page=5` },
        { name: 'v1_transactions', path: `/v1/outlets/${mokaOutletId}/transactions?status=pending&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        { name: 'v1_sales', path: `/v1/outlets/${mokaOutletId}/sales?status=pending&start=${fmtDateDDMMYYYY}&end=${fmtDateDDMMYYYY}&per_page=5` },
        // Reports endpoint
        { name: 'v1_reports_transactions', path: `/v1/outlets/${mokaOutletId}/reports/transactions?start_date=${testDate}&end_date=${testDate}&per_page=5` },
        { name: 'v3_reports_latest', path: `/v3/outlets/${mokaOutletId}/reports/get_latest_transactions?per_page=5` },
      ];

      const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';
      const results = [];

      // Base URL connectivity check (no auth)
      try {
        const baseCheck = await fetch(`${MOKA_API_BASE}/v1`, { method: 'GET' });
        results.push({ name: 'base_url_check', status: baseCheck.status, latency_ms: 0, hasData: false, preview: `Base URL reachable: ${baseCheck.status}` });
      } catch (e) {
        results.push({ name: 'base_url_check', status: 'ERROR', latency_ms: 0, error: e.message, preview: 'Base URL unreachable' });
      }

      for (const v of variations) {
        const start = Date.now();
        try {
          const resp = await fetch(`${MOKA_API_BASE}${v.path}`, { headers });
          const text = await resp.text();
          let data = null; try { data = JSON.parse(text); } catch { data = { raw: text }; }
          const preview = data?.data ? `Array[${data.data.length}]` : (data?.raw ? data.raw.slice(0, 200) : JSON.stringify(data).slice(0, 100));
          results.push({ name: v.name, status: resp.status, latency_ms: Date.now() - start, hasData: !!data?.data, preview });
        } catch (e) {
          results.push({ name: v.name, status: 'ERROR', latency_ms: Date.now() - start, error: e.message });
        }
      }
      res.json({ outlet: { slug: outlet.slug, moka_outlet_id: mokaOutletId }, testDate, mokaApiBase: MOKA_API_BASE, results });
    } catch (err) { _serverError(res, err); }
  });

  // ── GET /api/moka/debug-bills ──────────────────────────────
  // Debug endpoint to see actual bill data from Moka
  router.get('/moka/debug-bills', async (req, res) => {
    try {
      const { outletId: rawOutletId, date } = req.query;
      if (!rawOutletId) return res.status(400).json({ error: 'outletId is required' });

      const outletId = await _resolveOutletId(supabase, rawOutletId);
      if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });

      const { data: outlet } = await supabase.from('outlets').select('id, slug, moka_outlet_id').eq('id', outletId).single();
      if (!outlet?.moka_outlet_id) return res.status(404).json({ error: 'Missing moka_outlet_id' });

      const { getAccessToken } = require('./oauth');
      const token = await getAccessToken(supabase, outletId);
      const mokaOutletId = outlet.moka_outlet_id;
      
      // Test date range: 7 days back to tomorrow (same as sync.js)
      const testDate = date || new Date().toISOString().slice(0, 10);
      const [y, m, d] = testDate.split('-');
      const fmtDate = `${d}/${m}/${y}`;
      
      const WIB_MS = 7 * 60 * 60 * 1000;
      const nowWIB = Date.now() + WIB_MS;
      const startWIB = new Date(nowWIB - 7 * 86_400_000).toISOString().slice(0, 10);
      const tomorrowWIB = new Date(nowWIB + 86_400_000).toISOString().slice(0, 10);
      const [sy, sm, sd] = startWIB.split('-');
      const [ty, tm, td] = tomorrowWIB.split('-');
      const startFmt = `${sd}/${sm}/${sy}`;
      const endFmt = `${td}/${tm}/${ty}`;
      
      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
      const MOKA_API_BASE = process.env.MOKA_API_BASE || 'https://api.mokapos.com';
      
      // Query with full date range
      const path = `/v1/outlets/${mokaOutletId}/sync_bills?statuses=PENDING&start=${startFmt}&end=${endFmt}&per_page=200&deep=true`;
      const url = `${MOKA_API_BASE}${path}`;
      
      const resp = await fetch(url, { headers });
      const text = await resp.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      
      res.json({
        outlet: { slug: outlet.slug, moka_outlet_id: mokaOutletId },
        query: { startFmt, endFmt, url },
        responseStatus: resp.status,
        billCount: data?.data ? (Array.isArray(data.data) ? data.data.length : 1) : 0,
        bills: data?.data || data?.raw || data,
      });
    } catch (err) { _serverError(res, err); }
  });

  // ── GET/POST /api/moka/sync-customers ─────────────────────
  // Pull customers from Moka transactions → Supabase customers table
  router.get('/moka/sync-customers', async (req, res) => {
    const syncCustomersHandler = require('../../api/moka/sync-customers');
    return syncCustomersHandler(req, res);
  });
  router.post('/moka/sync-customers', async (req, res) => {
    const syncCustomersHandler = require('../../api/moka/sync-customers');
    return syncCustomersHandler(req, res);
  });

  // ── POST /api/moka/sync-member-points ────────────────────
  // Tarik histori transaksi Moka → hitung visits/poin → update member_profiles ACTIVE.
  // Auth: x-admin-token atau Bearer <ADMIN_PASSWORD|CRON_SECRET>
  // Query: dry_run=1 untuk preview tanpa DB update
  router.post('/moka/sync-member-points', async (req, res) => {
    const adminPw    = process.env.ADMIN_PASSWORD;
    const cronSecret = process.env.CRON_SECRET;
    const token      = (req.headers['x-admin-token'] || '').trim();
    const bearer     = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (adminPw || cronSecret) {
      const ok = (adminPw   && (token === adminPw   || bearer === adminPw)) ||
                 (cronSecret && (token === cronSecret || bearer === cronSecret));
      if (!ok) return res.status(401).json({ error: 'Unauthorized' });
    }

    const PAGE_DELAY_MS    = 150;
    const MAX_BUDGET_MS    = 100_000;
    const POINTS_PER_VISIT = 50;
    const TIER_THRESHOLDS  = [
      { name: 'platinum', min: 3000 },
      { name: 'gold',     min: 1000 },
      { name: 'silver',   min: 500  },
      { name: 'bronze',   min: 0    },
    ];
    const getTier = (pts) => { for (const t of TIER_THRESHOLDS) if (pts >= t.min) return t.name; return 'bronze'; };
    const normPhone = (raw) => {
      if (!raw) return '';
      let d = String(raw).replace(/\D/g, '');
      if (d.startsWith('62')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1);
      return d.slice(-11);
    };

    const dryRun    = req.query.dry_run === '1' || req.body?.dry_run === true;
    const startTime = Date.now();

    try {
      const { data: outlets, error: outletErr } = await supabase
        .from('outlets').select('id, slug, name, moka_outlet_id')
        .not('moka_outlet_id', 'is', null).eq('is_active', true);
      if (outletErr) throw new Error('DB outlets: ' + outletErr.message);
      if (!outlets?.length) return res.status(200).json({ updated: 0, note: 'No active outlets with moka_outlet_id' });

      const { data: members, error: memErr } = await supabase
        .from('member_profiles').select('id, user_key, phone, full_name, total_points, total_visits, current_tier')
        .eq('membership_status', 'ACTIVE');
      if (memErr) throw new Error('DB member_profiles: ' + memErr.message);
      if (!members?.length) return res.status(200).json({ updated: 0, note: 'No active members' });

      const memberLookup = new Map();
      for (const m of members) { const n = normPhone(m.phone); if (n && n.length >= 8) memberLookup.set(n, m); }

      const globalVisitMap = new Map();
      for (const outlet of outlets) {
        if (Date.now() - startTime > MAX_BUDGET_MS) break;
        const MokaClient = require('./client');
        const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
        const visitMap = new Map();
        let sinceEpoch = null, pageCount = 0;
        while (true) {
          if (Date.now() - startTime > MAX_BUDGET_MS) break;
          let json;
          try { json = await client.getTransactionPage({ sinceEpoch, limit: 100 }); }
          catch (err) { if (err.status === 404 || err.status === 403) break; throw err; }
          const payments = json?.data?.payments ?? [];
          for (const p of payments) {
            if (p.is_deleted || p.is_refunded) continue;
            const norm = normPhone(p.customer_phone || p.customer_phone_number || p.phone_number || p.phone || '');
            if (!norm || norm.length < 8) continue;
            const txDate = (p.created_at || p.updated_at || '').slice(0, 10);
            const amount = Number(p.total_collected || p.total_transaction || 0);
            if (!visitMap.has(norm)) visitMap.set(norm, { visits: 0, total_spent: 0, last_visit: null, name: (p.customer_name || '').trim() });
            const entry = visitMap.get(norm);
            entry.visits++; entry.total_spent += amount;
            if (txDate && (!entry.last_visit || txDate > entry.last_visit)) entry.last_visit = txDate;
          }
          pageCount++;
          if (json?.data?.completed || !payments.length) break;
          const m = (json?.data?.next_url || '').match(/[?&]since=([0-9.]+)/);
          if (!m) break;
          sinceEpoch = parseFloat(m[1]);
          await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
        }
        console.log(`[SyncMemberPoints] Outlet ${outlet.moka_outlet_id}: ${pageCount} hal → ${visitMap.size} phone unik`);
        for (const [norm, data] of visitMap) {
          if (!globalVisitMap.has(norm)) globalVisitMap.set(norm, { visits: 0, total_spent: 0, last_visit: null });
          const g = globalVisitMap.get(norm);
          g.visits += data.visits; g.total_spent += data.total_spent;
          if (data.last_visit && (!g.last_visit || data.last_visit > g.last_visit)) g.last_visit = data.last_visit;
        }
      }

      const updates = [], unmatched = [];
      for (const [norm, member] of memberLookup) {
        const mokaData = globalVisitMap.get(norm);
        if (!mokaData) { unmatched.push({ name: member.full_name, phone: member.phone }); continue; }
        updates.push({ id: member.id, full_name: member.full_name, phone: member.phone,
          old_points: member.total_points, old_tier: member.current_tier,
          new_points: mokaData.visits * POINTS_PER_VISIT, new_visits: mokaData.visits,
          new_tier: getTier(mokaData.visits * POINTS_PER_VISIT), last_visit: mokaData.last_visit });
      }

      if (dryRun) return res.status(200).json({ dry_run: true, members_active: members.length,
        outlets_scanned: outlets.map(o => o.slug), matched: updates.length,
        unmatched: unmatched.length, preview: updates.slice(0, 20), unmatched_list: unmatched });

      let successCount = 0, errorCount = 0;
      const now = new Date().toISOString();
      for (const u of updates) {
        const { error } = await supabase.from('member_profiles')
          .update({ total_points: u.new_points, total_visits: u.new_visits, current_tier: u.new_tier, updated_at: now })
          .eq('id', u.id);
        if (error) { console.error(`[SyncMemberPoints] Update ${u.full_name}: ${error.message}`); errorCount++; }
        else successCount++;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      return res.status(200).json({ success: true, updated: successCount, errors: errorCount,
        unmatched: unmatched.length, unmatched_list: unmatched,
        outlets_scanned: outlets.map(o => o.slug), elapsed_s: parseFloat(elapsed),
        summary: updates.map(u => ({ name: u.full_name, phone: u.phone, visits: u.new_visits,
          points: u.new_points, tier: u.new_tier, tier_changed: u.old_tier !== u.new_tier })) });
    } catch (err) {
      console.error('[SyncMemberPoints] Fatal:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/barbers/today-status ────────────────────────
  // Returns isWorking flag for each barber for a given date.
  // Query: date (YYYY-MM-DD, default today WIB), outletId (optional)
  // Response: { date, dayOfWeek, barbers: [{ id, isWorking }] }
  router.get('/barbers/today-status', async (req, res) => {
    try {
      let { date, outletId: rawOutletId } = req.query;

      if (!date) {
        const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        date = wibNow.toISOString().slice(0, 10);
      }

      const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun…6=Sat
      const SHORT_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const ID_DAYS    = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

      let barbersQuery = supabase
        .from('barbers')
        .select('id, work_days')
        .eq('is_active', true);

      if (rawOutletId) {
        const outletId = await _resolveOutletId(supabase, rawOutletId);
        if (outletId) barbersQuery = barbersQuery.eq('outlet_id', outletId);
      }

      const { data: barbers, error: barbersErr } = await barbersQuery;
      if (barbersErr) throw new Error(barbersErr.message);

      const barberIds = (barbers || []).map(b => b.id);
      const { data: hours } = barberIds.length
        ? await supabase
            .from('barber_working_hours')
            .select('barber_id, is_off')
            .in('barber_id', barberIds)
            .eq('day_of_week', dayOfWeek)
        : { data: [] };

      const hoursByBarber = {};
      for (const h of hours || []) hoursByBarber[h.barber_id] = h;

      const result = (barbers || []).map(b => {
        const wh = hoursByBarber[b.id];
        let isWorking;
        if (wh !== undefined) {
          isWorking = !wh.is_off;
        } else {
          const workDays = b.work_days || [];
          isWorking = !workDays.length
            || workDays.includes(SHORT_DAYS[dayOfWeek])
            || workDays.includes(ID_DAYS[dayOfWeek]);
        }
        return { id: b.id, isWorking };
      });

      res.json({ date, dayOfWeek, barbers: result });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/outlets ─────────────────────────────────────
  // List all active outlets (useful for front-end dropdowns)
  router.get('/outlets', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('outlets')
        .select('id, name, slug, address, timezone')
        .eq('is_active', true)
        .order('name');

      if (error) throw new Error(error.message);
      res.json({ outlets: data || [] });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/services ─────────────────────────────────────
  router.get('/services', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('id, name, slug, duration_minutes, price')
        .eq('is_active', true)
        .order('price');

      if (error) throw new Error(error.message);
      res.json({ services: data || [] });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/items ───────────────────────────────────
  // Pull the full item list from Moka for this outlet.
  // Used by admin to see Moka products and map them to services.
  // Query: outletId (optional, defaults to first authorized outlet)
  router.get('/moka/items', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured())
        return res.status(503).json({ error: 'Moka OAuth not configured' });

      const { outletId: rawOutletId } = req.query;

      // Resolve outlet — fall back to first one with a token
      let outletId = rawOutletId ? await _resolveOutletId(supabase, rawOutletId) : null;
      let mokaOutletId = null;

      if (!outletId) {
        const { data: tok } = await supabase
          .from('moka_tokens').select('outlet_id').limit(1).single();
        outletId = tok?.outlet_id;
      }

      if (!outletId) return res.status(404).json({ error: 'No authorized outlet found. Run OAuth first.' });

      const { data: outlet } = await supabase
        .from('outlets').select('id, moka_outlet_id').eq('id', outletId).single();
      mokaOutletId = outlet?.moka_outlet_id;
      if (!mokaOutletId) return res.status(400).json({ error: 'Outlet has no moka_outlet_id set' });

      const MokaClient = require('./client');
      const client = new MokaClient(supabase, outletId, mokaOutletId);
      const data = await client.getItems();
      // Moka v1/items response shape varies — try all known paths (same as schemaSync.js)
      const rawItems = data?.data?.items || data?.data?.item
        || (Array.isArray(data?.data) ? data.data : null)
        || data?.items || [];
      const items = Array.isArray(rawItems) ? rawItems : [];

      // Also load our services to show mapping status
      const { data: services } = await supabase
        .from('services').select('id, name, moka_item_id, moka_category_id');

      const mappedIds = new Set((services || []).map(s => String(s.moka_item_id)).filter(Boolean));

      res.json({
        outletId,
        mokaOutletId,
        items: items.map(item => ({
          id:           item.id,
          name:         item.name || item.item_name,
          price:        item.price || item.selling_price,
          category_id:  item.category_id,
          category_name:item.category?.name || item.category_name,
          mapped:       mappedIds.has(String(item.id)),
        })),
        services: services || [],
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/moka/map-items ──────────────────────────────
  // Save Moka item → service mappings + price + duration.
  // Body: { mappings: [{ serviceId, mokaItemId?, mokaCategoryId?, mokaCategoryName?, price?, durationMinutes? }] }
  router.post('/moka/map-items', async (req, res) => {
    try {
      const { mappings } = req.body || {};
      if (!Array.isArray(mappings) || !mappings.length)
        return res.status(400).json({ error: 'mappings array is required' });

      const results = [];
      for (const m of mappings) {
        const { serviceId, mokaItemId, mokaCategoryId, mokaCategoryName, price, durationMinutes } = m;
        if (!serviceId) {
          results.push({ serviceId, status: 'skipped_missing_fields' });
          continue;
        }

        const updateData = {};
        if (mokaItemId) {
          updateData.moka_item_id      = String(mokaItemId);
          updateData.moka_category_id  = mokaCategoryId  ? String(mokaCategoryId)  : null;
          updateData.moka_category_name= mokaCategoryName || null;
        }
        if (price != null && !isNaN(price) && price >= 0)
          updateData.price = price;
        if (durationMinutes != null && !isNaN(durationMinutes) && durationMinutes > 0)
          updateData.duration_minutes = durationMinutes;

        if (!Object.keys(updateData).length) {
          results.push({ serviceId, mokaItemId, status: 'skipped_no_changes' });
          continue;
        }

        const { error } = await supabase
          .from('services')
          .update(updateData)
          .eq('id', serviceId);

        results.push({ serviceId, mokaItemId, status: error ? 'error' : 'ok', error: error?.message });
      }

      res.json({ results });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/status ──────────────────────────────────
  // Quick health check: OAuth status per outlet, cron state, last sync.
  router.get('/moka/status', async (_req, res) => {
    try {
      const { data: outlets } = await supabase
        .from('outlets').select('id, name, slug, moka_outlet_id').eq('is_active', true);

      const { data: tokens } = await supabase
        .from('moka_tokens').select('outlet_id, expires_at, updated_at, scope');

      const { data: lastLogs } = await supabase
        .from('sync_logs')
        .select('direction, status, created_at, error_message')
        .order('created_at', { ascending: false })
        .limit(10);

      const tokenMap = {};
      for (const t of tokens || []) tokenMap[t.outlet_id] = t;

      const outletStatus = (outlets || []).map(o => ({
        id:            o.id,
        name:          o.name,
        slug:          o.slug,
        mokaOutletId:  o.moka_outlet_id,
        hasToken:      Boolean(tokenMap[o.id]),
        tokenExpiry:   tokenMap[o.id]?.expires_at || null,
        tokenExpired:  tokenMap[o.id]
          ? new Date(tokenMap[o.id].expires_at) < new Date()
          : null,
      }));

      res.json({
        oauthConfigured: isMokaOAuthConfigured(),
        outlets: outletStatus,
        recentLogs: lastLogs || [],
      });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── GET /api/moka/open-bills ──────────────────────────────
  // Tampilkan Open Bills (PENDING) dari Moka hari ini untuk semua outlet.
  // Digunakan admin untuk memverifikasi apakah slot walk-in sudah terblokir.
  // Query: outletId (optional), date (YYYY-MM-DD, default hari ini)
  router.get('/moka/open-bills', async (req, res) => {
    try {
      if (!isMokaOAuthConfigured())
        return res.status(503).json({ error: 'Moka OAuth not configured' });

      const { outletId: rawOutletId, date } = req.query;
      const todayStr = date || new Date().toISOString().slice(0, 10);

      // Resolve outlets to check
      let outlets = [];
      if (rawOutletId) {
        const outletId = await _resolveOutletId(supabase, rawOutletId);
        if (!outletId) return res.status(404).json({ error: `Outlet not found: ${rawOutletId}` });
        const { data: o } = await supabase.from('outlets').select('id, name, moka_outlet_id').eq('id', outletId).single();
        if (o) outlets = [o];
      } else {
        const { data } = await supabase
          .from('outlets').select('id, name, moka_outlet_id').eq('is_active', true).not('moka_outlet_id', 'is', null);
        outlets = data || [];
      }

      const results = [];
      for (const outlet of outlets) {
        try {
          const MokaClient = require('./client');
          const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
          const billsRes  = await client.getOpenBills(todayStr);
          // Normalize: Moka may return data as array (multi) or single object
          const rawData = billsRes?.data;
          const openBills = Array.isArray(rawData) ? rawData
                          : (rawData && typeof rawData === 'object' && rawData.id) ? [rawData]
                          : [];

          // Also load matching schedules from our DB
          const billIds = openBills.map(b => String(b.id));
          const { data: schedules } = billIds.length
            ? await supabase.from('schedules').select('id, external_id, barber_id, service_name, start_time, end_time, status').in('external_id', billIds)
            : { data: [] };
          const scheduleMap = {};
          for (const s of schedules || []) scheduleMap[s.external_id] = s;

          results.push({
            outletId:     outlet.id,
            outletName:   outlet.name,
            date:         todayStr,
            openBills:    openBills.map(b => {
              const bd  = b.billDetail || b.bill_detail || null;
              const sch = scheduleMap[String(b.id)] || null;
              return {
                id:           b.id,
                name:         b.name,
                status:       b.status,
                createdAt:    b.createdAt || b.created_at,
                totalPrice:   b.totalPrice || b.total || bd?.bill_total_amount || bd?.bill_sub_total_amount,
                itemCount:    (bd?.items || b.items || []).length,
                blockedInWeb: !!sch && sch.status !== 'cancelled',
                schedule: sch ? {
                  id:         sch.id,
                  status:     sch.status,
                  barber_id:  sch.barber_id,
                  start_time: sch.start_time,
                  end_time:   sch.end_time,
                } : null,
              };
            }),
          });
        } catch (outletErr) {
          results.push({ outletId: outlet.id, outletName: outlet.name, error: outletErr.message });
        }
      }

      res.json({ date: todayStr, results });
    } catch (err) {
      _serverError(res, err);
    }
  });

  // ── POST /api/moka/sync-schema ────────────────────────────
  // Sinkronisasi data Moka (items/barbers + variants/services) ke Supabase.
  // Dipanggil: manual, atau cron harian jam 03:00 WIB.
  router.post('/moka/sync-schema', async (_req, res) => {
    try {
      const { syncMokaSchema } = require('./schemaSync');

      // Always use a real Supabase client for schema sync (needs DB writes).
      // The router may have been initialized with the in-memory mock, so we
      // build a fresh client from env vars when available.
      let db = supabase;
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_KEY
                 || process.env.SUPABASE_SERVICE_ROLE_KEY
                 || process.env.SUPABASE_ANON_KEY;
      if (sbUrl && sbKey && (!db || typeof db._isMemoryMock !== 'undefined')) {
        const { createClient } = require('@supabase/supabase-js');
        db = createClient(sbUrl, sbKey);
      }
      if (!db || !sbUrl) {
        return res.status(503).json({ error: 'Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars' });
      }

      const report = await syncMokaSchema(db);
      res.json({ message: 'Schema sync complete', ...report });
    } catch (err) {
      _serverError(res, err);
    }
  });

  return router;
}

// ── PRIVATE HELPERS ───────────────────────────────────────

async function _refreshFreshTodayData(supabase, outletId, date) {
  if (!outletId) return null;
  // Refresh untuk hari ini DAN 7 hari ke depan agar advance bills (kasir buat hari ini
  // untuk besok/lusa) langsung terblokir saat customer melihat availability.
  // Hari ini: window 15 detik (GoShow langsung harus segera terblokir).
  // Besok & seterusnya: window 60 detik (advance bills kurang time-critical).
  const daysAhead = _daysAheadInJakarta(date);
  if (daysAhead === null || daysAhead < 0 || daysAhead > 7) return null;
  const maxAgeMs = daysAhead === 0 ? 15_000 : 60_000;

  // Expire outlet-wide blocks (barber_id IS NULL) for this outlet.
  // Expire jika SALAH SATU: end_time sudah lewat (+ 1h) ATAU created_at sudah > 2h
  // sehingga open bill lintas hari tidak terus memblokir semua kapster.
  // Await cleanup so it completes in serverless before function exits.
  const staleHours    = Math.max(1, parseInt(process.env.MOKA_OPENBILL_OUTLET_WIDE_STALE_HOURS || '1', 10) || 1);
  const unmatchedHours = Math.max(1, parseInt(process.env.MOKA_OPENBILL_UNMATCHED_HOURS || '2', 10) || 2);
  const cutoffEnd      = new Date(Date.now() - staleHours    * 60 * 60 * 1000).toISOString();
  const cutoffCreated  = new Date(Date.now() - unmatchedHours * 60 * 60 * 1000).toISOString();
  try {
    const { data: expired } = await supabase
      .from('schedules')
      .update({ status: 'cancelled', notes: '[auto] stale outlet-wide open bill — kasir lupa close di MokaPOS' })
      .eq('outlet_id', outletId)
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .is('barber_id', null)
      .or(`end_time.lt.${cutoffEnd},created_at.lt.${cutoffCreated}`)
      .select('id');
    if (expired?.length) console.log(`[Expire] ${expired.length} stale outlet-wide block(s) for outlet ${outletId}`);
  } catch (_) { /* non-critical cleanup */ }

  return maybeRefreshOutletData(supabase, outletId, { maxAgeMs });
}

/**
 * Returns how many days ahead `dateStr` is from today (Jakarta/WIB time).
 * Returns null if dateStr is invalid. Returns negative number if dateStr is in the past.
 */
function _daysAheadInJakarta(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const WIB_MS = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(Date.now() + WIB_MS);
  const todayMs = Date.UTC(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate());
  const targetMs = new Date(`${dateStr}T00:00:00+07:00`).getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/** Accept UUID or slug, return UUID. Returns null if not found. */
async function _resolveOutletId(supabase, raw) {
  if (!raw) return null;
  const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (_UUID_RE.test(raw)) return raw;   // already a UUID

  const { data } = await supabase
    .from('outlets').select('id').eq('slug', raw).single();
  return data?.id || null;
}

function _normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return `+${digits}`;
  if (digits.startsWith('0'))  return `+62${digits.slice(1)}`;
  return `+62${digits}`;
}

function _timeStrToMs(dateStr, timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`).getTime();
}

function _parseDurationStr(dur) {
  if (!dur) return 30;
  const s = String(dur).toLowerCase().trim();
  if (s.includes('jam')) return Math.round((parseFloat(s) || 1) * 60);
  const m = parseInt(s, 10);
  return (Number.isFinite(m) && m > 0) ? m : 30;
}

async function _cancelMokaOrder(supabase, schedule) {
  const MokaClient = require('./client');
  const { data: outlet } = await supabase
    .from('outlets').select('id, moka_outlet_id').eq('id', schedule.outlet_id).single();
  if (!outlet?.moka_outlet_id) return;
  const client = new MokaClient(supabase, outlet.id, outlet.moka_outlet_id);
  // BUG FIX: use cancelOrder() directly — PATCH not in Moka API spec
  await client.cancelOrder(schedule.external_id, 'CUSTOMER#Cancelled by admin');
}

function _serverError(res, err) {
  console.error('[MokaRoute] Error:', err.message || err);
  if (res.headersSent) return;
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = createMokaRouter;
