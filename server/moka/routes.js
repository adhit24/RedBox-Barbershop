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

      _refreshFreshTodayData(supabase, outletId, date).catch(() => {});

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
          status:       'reserved',
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
        if (outletId) _refreshFreshTodayData(supabase, outletId, date).catch(() => {});
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

  // ── POST /api/moka/sync ───────────────────────────────────
  // Manual trigger for Moka → Web pull sync.
  // Body (optional): { "outletId": "uuid-or-slug", "wait": true }
  // If omitted, syncs ALL authorized outlets.
  // Auth: Bearer <CRON_SECRET> header required (or adminAuth for dashboard use)
  //
  // Default: respond 202 immediately, sync runs in background.
  // Pass "wait": true in body to wait for sync completion (manual use only).
  router.post('/moka/sync', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== cronSecret) {
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
