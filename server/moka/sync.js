'use strict';
// ============================================================
// MOKA POS  —  Bidirectional Sync Service
//
// FLOW A (web → Moka):  pushScheduleToMoka(supabase, scheduleId)
// FLOW B (Moka → web):  pullMokaToWeb(supabase, outletId)
// Cron:                 startCronJobs(supabase)  — every 5 min
// ============================================================

const MokaClient = require('./client');
const { _matchScore } = require('./schemaSync');

// Simple in-process lock so concurrent cron ticks don't overlap
const _syncLock = new Set();
const _syncPromises = new Map();

// Last-pulled timestamp per outlet to fetch only new/updated orders
const _lastSyncAt = new Map(); // outletId → ISO string

// Moka items (barbers + variants) cached per outlet to avoid repeated API calls
const _mokaItemsCache = new Map(); // outletId → { ts: number, items: [] }
const MOKA_ITEMS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MOKA_PULL_INTERVAL_MINUTES = Math.max(1, parseInt(process.env.MOKA_PULL_INTERVAL_MINUTES || '1', 10) || 1);
const MOKA_RETRY_INTERVAL_MINUTES = Math.max(1, parseInt(process.env.MOKA_RETRY_INTERVAL_MINUTES || '2', 10) || 2);
const MOKA_ON_DEMAND_SYNC_MAX_AGE_MS = Math.max(10_000, parseInt(process.env.MOKA_ON_DEMAND_SYNC_MAX_AGE_MS || '45000', 10) || 45_000);

// Buffer (menit) ditambahkan ke end_time setiap Open Bill walk-in,
// agar kapster punya waktu transisi/cleanup sebelum customer berikut.
// Tujuan utama: mencegah double-booking goshow vs reservasi web.
// NOTE: slot booking di website tersedia per jam, jadi kita TIDAK menambahkan buffer menit.
const MOKA_OPENBILL_BUFFER_MIN = 0;

// Auto-expire stale "reserved" Open Bill schedules: jika kasir lupa close
// bill di MokaPOS, slot kapster bisa terblokir selamanya. Setelah
// (start_time + estimasi_durasi + safety_window) lewat, schedule otomatis
// di-mark cancelled supaya web booking bisa pakai slot itu lagi.
const MOKA_OPENBILL_STALE_HOURS = Math.max(1, parseInt(process.env.MOKA_OPENBILL_STALE_HOURS || '4', 10) || 4);

// ── FLOW A: WEB → MOKA ────────────────────────────────────

/**
 * Push a freshly created schedule to Moka as an order.
 * Called fire-and-forget after POST /api/reservations succeeds.
 *
 * Steps:
 *  1. Load schedule (with joins)
 *  2. Upsert customer in Moka
 *  3. Create order in Moka
 *  4. Write back external_id + set status='confirmed'
 *  5. Insert transaction record
 *  6. Write sync_log
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} scheduleId - UUID of the schedule row
 */
async function pushScheduleToMoka(supabase, scheduleId) {
  const logId = await _startLog(supabase, 'web_to_moka', 'schedule', scheduleId);

  try {
    // 1. Load schedule
    const { data: sch, error: schErr } = await supabase
      .from('schedules_full')
      .select('*')
      .eq('id', scheduleId)
      .single();

    if (schErr || !sch) throw new Error(`Schedule not found: ${scheduleId}`);
    // Skip only if external_id is a real Moka order ID (not a bridge legacy ref like 'booking:uuid')
    if (sch.external_id && !String(sch.external_id).startsWith('booking:')) {
      await _finishLog(supabase, logId, 'skipped', 'Already synced');
      return;
    }

    // 2. Resolve Moka client for this outlet
    const client = await _getClient(supabase, sch.outlet_id, sch.outlet_moka_id);

    // Enrich schedule with barber's moka_employee_id and service's moka_variant_name
    // if the schedules_full view doesn't expose them directly
    if (!sch.barber_moka_employee_id && sch.barber_id) {
      const { data: barber } = await supabase
        .from('barbers').select('moka_employee_id').eq('id', sch.barber_id).maybeSingle();
      sch.barber_moka_employee_id = barber?.moka_employee_id || null;
    }
    if (!sch.moka_variant_name && sch.service_id) {
      const { data: svc } = await supabase
        .from('services').select('moka_variant_name').eq('id', sch.service_id).maybeSingle();
      sch.moka_variant_name = svc?.moka_variant_name || null;
    }

    // 3. Customer upsert removed — POST /v2/customers not in Moka API spec.
    //    Customer is identified in Moka via customer_name + customer_phone_number in the order.

    // 4. Create Moka order
    const orderPayload = await _buildMokaOrderPayload(sch, client);
    const mokaOrder    = await client.createOrder(orderPayload);
    const mokaOrderId  = mokaOrder?.data?.id || mokaOrder?.id;

    if (!mokaOrderId) throw new Error('Moka order created but no ID returned');

    // 5. Update schedule with Moka order ID
    await supabase.from('schedules').update({
      external_id: mokaOrderId,
      status:      'confirmed',
    }).eq('id', scheduleId);

    // 6. Insert transaction
    await _insertTransaction(supabase, {
      customerId:  sch.customer_id,
      outletId:    sch.outlet_id,
      scheduleId:  scheduleId,
      externalId:  mokaOrderId,
      totalAmount: sch.price || 0,
      source:      'web',
      mokaPayload: mokaOrder,
      items: [{ name: sch.service_name || 'Service', price: sch.price || 0, qty: 1 }],
    });

    await _finishLog(supabase, logId, 'success', null, { mokaOrderId });
    return { mokaOrderId };

  } catch (err) {
    await _finishLog(supabase, logId, 'failed', err.message);
    throw err;
  }
}

// ── CHECKOUT PUSH: WEB → MOKA PRODUK TERJUAL ─────────────
//
// Called when admin marks a web reservation as 'completed'.
// Creates a real POS transaction in Moka so it appears in Produk Terjual recap.
// Skipped if the cashier already processed the payment through POS (source='moka' tx exists).

/**
 * Push a completed web reservation to Moka as a POS checkout transaction.
 * This makes the booking appear in Moka's "Produk Terjual" report.
 *
 * Idempotent: skips if a checkout_api or moka-native transaction already exists
 * for this schedule (avoids double-counting).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} scheduleId - UUID of the completed schedule
 */
async function pushCheckoutToMoka(supabase, scheduleId) {
  const logId = await _startLog(supabase, 'web_to_moka', 'checkout', scheduleId);

  try {
    // 1. Load schedule
    const { data: sch, error: schErr } = await supabase
      .from('schedules_full')
      .select('*')
      .eq('id', scheduleId)
      .single();
    if (schErr || !sch) throw new Error(`Schedule not found: ${scheduleId}`);

    // 2. Idempotency: skip if already pushed or if cashier processed through POS
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id, source')
      .eq('schedule_id', scheduleId)
      .in('source', ['checkout_api', 'moka'])
      .maybeSingle();
    if (existingTxn) {
      await _finishLog(supabase, logId, 'skipped', `Already has ${existingTxn.source} transaction`);
      return { skipped: true, reason: existingTxn.source };
    }

    // 3. Resolve Moka client
    const client = await _getClient(supabase, sch.outlet_id, sch.outlet_moka_id || sch.outlet_moka_outlet_id);

    // 4. Enrich barber/service Moka fields if not exposed by view
    if (!sch.barber_moka_employee_id && sch.barber_id) {
      const { data: barber } = await supabase
        .from('barbers').select('moka_employee_id').eq('id', sch.barber_id).maybeSingle();
      sch.barber_moka_employee_id = barber?.moka_employee_id || null;
    }
    if (sch.service_id && (!sch.moka_variant_name || !sch.moka_category_id)) {
      const { data: svc } = await supabase
        .from('services').select('moka_variant_name, moka_category_id, moka_category_name')
        .eq('id', sch.service_id).maybeSingle();
      sch.moka_variant_name  = sch.moka_variant_name  || svc?.moka_variant_name  || null;
      sch.moka_category_id   = sch.moka_category_id   || svc?.moka_category_id   || null;
      sch.moka_category_name = sch.moka_category_name || svc?.moka_category_name || null;
    }

    // 5. Resolve item_id / variant_id / category from Moka items cache
    let mokaItemId   = sch.barber_moka_employee_id ? Number(sch.barber_moka_employee_id) : null;
    let variantId    = null;
    let categoryId   = sch.moka_category_id   ? Number(sch.moka_category_id)   : null;
    let categoryName = sch.moka_category_name || null;
    const variantName = sch.moka_variant_name || sch.service_name || null;

    if (sch.barber_name) {
      try {
        const items = await _getMokaItems(client, sch.outlet_id);
        let bestItem = null, bestScore = 0;
        for (const item of items) {
          const s = _matchScore(sch.barber_name, item.name);
          if (s > bestScore) { bestScore = s; bestItem = item; }
        }
        if (bestItem && bestScore >= 0.6) {
          mokaItemId   = mokaItemId   || Number(bestItem.id);
          categoryId   = categoryId   || (bestItem.category_id ? Number(bestItem.category_id) : null);
          categoryName = categoryName || bestItem.category?.name || null;

          if (variantName && !variantId) {
            let bestV = null, bestVScore = 0;
            for (const v of (bestItem.item_variants || [])) {
              const vs = _matchScore(variantName, v.name);
              if (vs > bestVScore) { bestVScore = vs; bestV = v; }
            }
            if (bestV && bestVScore >= 0.5) variantId = Number(bestV.id);
            if (!variantId && bestItem.item_variants?.length) variantId = Number(bestItem.item_variants[0].id);
          }
        }
      } catch (e) {
        console.warn('[Checkout] Could not resolve Moka item for barber:', e.message);
      }
    }

    const price = sch.price || 0;

    const checkoutItem = {
      item_id:   mokaItemId || 0,
      item_name: sch.barber_name || 'Barber',
      quantity:  1,
      gross_sales: price,
      net_sales:   price,
    };
    if (variantId)    checkoutItem.item_variant_id   = variantId;
    if (variantName)  checkoutItem.item_variant_name = variantName;
    if (categoryId)   checkoutItem.category_id       = categoryId;
    if (categoryName) checkoutItem.category_name     = categoryName;

    const payload = {
      note:              `Online Booking #${scheduleId.slice(0, 8)} — ${sch.customer_name || 'Guest'}`,
      client_created_at: sch.start_time,
      total_gross_sales: price,
      total_net_sales:   price,
      total_collected:   price,
      amount_pay:        price,
      customer_name:     sch.customer_name  || 'Guest',
      customer_phone:    sch.customer_phone || undefined,
      items: [checkoutItem],
    };

    // 6. Call Moka Checkout API
    const result = await client.createCheckout(payload);
    const checkoutId = result?.data?.id || result?.id || `web-${scheduleId.slice(0, 8)}`;

    // 7. Record transaction so cron / Pull 1 doesn't create a duplicate
    await _insertTransaction(supabase, {
      customerId:  sch.customer_id,
      outletId:    sch.outlet_id,
      scheduleId,
      externalId:  String(checkoutId),
      totalAmount: price,
      source:      'checkout_api',
      mokaPayload: result,
      items: [{ name: variantName || sch.service_name || 'Service', price, qty: 1 }],
    });

    await _finishLog(supabase, logId, 'success', null, { checkoutId });
    console.log(`[Checkout] Schedule ${scheduleId} → Moka checkout ${checkoutId} (Produk Terjual updated)`);
    return { checkoutId };

  } catch (err) {
    await _finishLog(supabase, logId, 'failed', err.message);
    console.error(`[Checkout] pushCheckoutToMoka(${scheduleId}) failed:`, err.message);
    throw err;
  }
}

// ── FLOW B: MOKA → WEB ────────────────────────────────────

/**
 * Pull new/updated orders from Moka and create schedules + transactions.
 * Called by cron every 5 minutes (and optionally by webhook).
 *
 * Steps per order:
 *  1. Idempotency check (skip if external_id already exists)
 *  2. Resolve / create customer
 *  3. Map order items → service duration + amount
 *  4. Find available barber (or leave unassigned if none free)
 *  5. Insert schedule (source = 'moka', status = 'completed')
 *  6. Insert transaction + items
 *  7. Write sync_log
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} outletId - our DB outlet UUID
 * @returns {{ processed:number, skipped:number, errors:number }}
 */
async function pullMokaToWeb(supabase, outletId) {
  if (_syncPromises.has(outletId)) {
    console.log(`[Sync] Outlet ${outletId} already syncing — joining inflight pull`);
    return _syncPromises.get(outletId);
  }

  const run = _pullMokaToWebNow(supabase, outletId);
  _syncPromises.set(outletId, run);
  try {
    return await run;
  } finally {
    _syncPromises.delete(outletId);
  }
}

async function _pullMokaToWebNow(supabase, outletId) {
  if (_syncLock.has(outletId)) {
    console.log(`[Sync] Outlet ${outletId} already syncing — skipping tick`);
    return { processed: 0, skipped: 0, errors: 0 };
  }
  _syncLock.add(outletId);

  const logId = await _startLog(supabase, 'moka_to_web', 'order', outletId);
  let processed = 0, skipped = 0, errors = 0;

  try {
    const { data: outlet } = await supabase
      .from('outlets')
      .select('id, moka_outlet_id, last_polled_at')
      .eq('id', outletId)
      .single();

    if (!outlet?.moka_outlet_id) {
      await _finishLog(supabase, logId, 'skipped', 'No moka_outlet_id configured');
      return { processed: 0, skipped: 0, errors: 0 };
    }

    const client = await _getClient(supabase, outletId, outlet.moka_outlet_id);

    // Hydrate in-memory cache from DB on cold start so we don't refetch 1h every invocation
    if (!_lastSyncAt.has(outletId) && outlet.last_polled_at) {
      _lastSyncAt.set(outletId, outlet.last_polled_at);
    }
    // 1-hour lookback (was 24h) caps cold-start backfill work. Older completed orders
    // are non-blocking — they can stay in Moka without web mirror.
    const since = _lastSyncAt.get(outletId)
      || new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Kick both pulls in parallel. We AWAIT Pull 3 first (fast, time-critical) and
    // persist last_polled_at + finishLog immediately. Pull 1 (slow, historical) keeps
    // running in remaining budget; whatever it completes is bonus. If function timeout
    // hits Pull 1 mid-way, next tick continues from persisted last_polled_at.
    const pull1Promise = _runPull1Orders(supabase, client, outletId, since)
      .catch(err => { console.warn(`[Sync] Pull 1 error: ${err.message}`); return { processed: 0, skipped: 0, errors: 1 }; });
    const pull3Promise = _runPull3OpenBills(supabase, client, outletId)
      .catch(err => { console.warn(`[Sync] Pull 3 error: ${err.message}`); return { processed: 0, skipped: 0, errors: 1 }; });

    const pull3 = await pull3Promise;

    // Persist last_polled_at NOW (after Pull 3) so even if Pull 1 doesn't finish,
    // next tick has a fresh cursor and won't keep refetching 1h every time.
    const polledAt = new Date().toISOString();
    _lastSyncAt.set(outletId, polledAt);
    const { error: persistErr } = await supabase
      .from('outlets').update({ last_polled_at: polledAt }).eq('id', outletId);
    if (persistErr) console.warn(`[Sync] persist last_polled_at failed: ${persistErr.message}`);

    // Now wait for Pull 1 to finish (may be killed by function timeout — that's OK)
    const pull1 = await pull1Promise;
    processed = pull1.processed + pull3.processed;
    skipped   = pull1.skipped   + pull3.skipped;
    errors    = pull1.errors    + pull3.errors;

    await _finishLog(supabase, logId, 'success', null, { processed, skipped, errors });

  } catch (err) {
    await _finishLog(supabase, logId, 'failed', err.message);
    throw err;
  } finally {
    _syncLock.delete(outletId);
  }

  return { processed, skipped, errors };
}

// Pull 1: Completed transactions via Report API. Walk-in yang sudah selesai → schedule 'completed'.
// Slow path on cold start (up to 24h of orders). Safe to fail / partial — historical can backfill
// on next tick. Each new order takes ~2-3s (customer + barber + schedule + transaction inserts).
async function _runPull1Orders(supabase, client, outletId, since) {
  let processed = 0, skipped = 0, errors = 0;
  let orders = [];
  // Limit to 20 per tick (was 100) to bound per-tick work. Each NEW order costs ~2-3s
  // for customer + barber + schedule + transaction inserts. 20 × 3s = 60s worst case,
  // which fits Hobby plan timeout. cron-job.org tick = 5min, so 20 orders/tick supports
  // up to ~5760 orders/day across all 5 outlets — more than enough for steady-state.
  try {
    const response = await client.getOrders({ updatedSince: since, limit: 20 });
    const rawOrders = response?.data?.payments || [];
    orders = Array.isArray(rawOrders) ? rawOrders : [];
  } catch (pull1Err) {
    console.warn(`[Sync] Pull 1 (v3/reports) skipped for outlet ${outletId}: ${pull1Err.message}`);
    return { processed, skipped, errors };
  }

  for (const order of orders) {
    try {
      const result = await _processIncomingOrder(supabase, order, outletId);
      if (result === 'skipped') skipped++;
      else processed++;
    } catch (orderErr) {
      errors++;
      console.error(`[Sync] Error processing Moka order ${order.id}:`, orderErr.message);
      await supabase.from('sync_logs').insert({
        direction:     'moka_to_web',
        entity_type:   'order',
        entity_id:     String(order.id),
        payload:       order,
        status:        'failed',
        error_message: orderErr.message,
      }).catch(() => {});
    }
  }
  return { processed, skipped, errors };
}

// Pull 3: Open (PENDING) walk-in bills from sync_bills. Time-critical for slot blocking —
// GoShow customer yang langsung dilayani kasir harus segera blok slot di website.
// start/end filter by bill *creation date* (not appointment date), so we query 7 days back →
// tomorrow to catch advance bills (e.g. "Onoy 14:00 Sabtu" dibuat Jumat malam untuk Sabtu).
async function _runPull3OpenBills(supabase, client, outletId) {
  let processed = 0, skipped = 0, errors = 0;
  const WIB_MS = 7 * 60 * 60 * 1000;
  const nowWIB      = Date.now() + WIB_MS;
  const startWIB    = new Date(nowWIB - 7 * 86_400_000).toISOString().slice(0, 10);
  const tomorrowWIB = new Date(nowWIB + 86_400_000).toISOString().slice(0, 10);

  let billsRes;
  try {
    billsRes = await client.getOpenBills(startWIB, tomorrowWIB);
  } catch (e) {
    console.warn(`[Sync] getOpenBills(${startWIB}…${tomorrowWIB}) failed (${e.message})`);
    await supabase.from('sync_logs').insert({
      direction:     'pull',
      entity_type:   'moka_open_bills',
      entity_id:     `${outletId}_${startWIB}`,
      status:        'failed',
      error_message: `getOpenBills failed: ${e.message} (status: ${e.status || 'unknown'})`,
      retry_count:   0,
      created_at:    new Date().toISOString(),
    }).catch(() => {});
    return { processed, skipped, errors: errors + 1 };
  }

  if (!billsRes) return { processed, skipped, errors };

  // Moka may return data as array (multi-bill) or object (single-bill) — normalize.
  const rawData   = billsRes?.data;
  const openBills = Array.isArray(rawData) ? rawData
                  : (rawData && typeof rawData === 'object' && rawData.id) ? [rawData]
                  : [];
  if (!openBills.length) {
    console.log(`[Sync] getOpenBills(${startWIB}…${tomorrowWIB}) returned 0 PENDING bills for outlet ${outletId}`);
    return { processed, skipped, errors };
  }

  // FIFO: sort by createdAt ASC supaya queue order benar saat 1 kapster melayani
  // multiple goshow customer berurutan.
  openBills.sort((a, b) => {
    const ta = new Date(a.createdAt || a.created_at || 0).getTime();
    const tb = new Date(b.createdAt || b.created_at || 0).getTime();
    return ta - tb;
  });
  console.log(`[Sync] getOpenBills(${startWIB}…${tomorrowWIB}) → ${openBills.length} PENDING bill(s) for outlet ${outletId}`);

  for (const bill of openBills) {
    try {
      const result = await _processOpenBill(supabase, bill, outletId, client);
      if (result === 'skipped') skipped++;
      else processed++;
    } catch (bErr) {
      errors++;
      console.warn(`[Sync] Open bill ${bill.id}:`, bErr.message);
    }
  }
  return { processed, skipped, errors };
}

/**
 * Process a single Moka order into our schedules + transactions.
 *
 * Status mapping from Moka:
 *   HOLD / PENDING → 'reserved'   (GoShow sitting down, not yet paid — blocks slot immediately)
 *   COMPLETED      → 'completed'  (paid and done)
 *   VOID           → 'cancelled'  (voided in Moka — cancel existing schedule if any)
 *
 * @returns {'skipped'|'processed'|'updated'|'cancelled'}
 */
async function _processIncomingOrder(supabase, order, outletId) {
  const mokaOrderId  = String(order.id || order.order_id);
  // BUG FIX: v3 payments have no 'transaction_status' field.
  // v3 only returns settled transactions; detect voids via is_deleted / is_refunded flags.
  const isVoid      = Boolean(order.is_deleted || order.is_refunded);
  const mokaStatus  = isVoid ? 'VOID' : 'COMPLETED';

  // 1. Check if we already have a schedule for this order
  const { data: existing } = await supabase
    .from('schedules')
    .select('id, status')
    .eq('external_id', mokaOrderId)
    .maybeSingle();

  // VOID — cancel existing schedule (if any) and stop
  if (mokaStatus === 'VOID' || mokaStatus === 'VOIDED') {
    if (existing) {
      await supabase.from('schedules').update({ status: 'cancelled' }).eq('id', existing.id);
    }
    return 'cancelled';
  }

  // Map Moka status to our schedule status
  const scheduleStatus = (mokaStatus === 'COMPLETED') ? 'completed' : 'reserved';

  // If already exists: update status if progressed (reserved → completed), otherwise skip
  if (existing) {
    if (existing.status === 'reserved' && scheduleStatus === 'completed') {
      await supabase.from('schedules').update({ status: 'completed' }).eq('id', existing.id);
      // Insert transaction now that it's completed
      await _insertTransaction(supabase, {
        customerId: null, outletId,
        scheduleId: existing.id, externalId: mokaOrderId,
        totalAmount: order.total_collected || 0,
        source: 'moka', mokaPayload: order, items: [],
      });
      return 'updated';
    }
    return 'skipped';
  }

  // 2. Determine start time
  const orderTime = _safeDate(order.transaction_time, order.created_at, order.updated_at);

  // 3. Map order items → duration + amount
  // Moka Report API returns items in `checkouts[]`; Advanced Ordering uses `order_items`
  const items = order.checkouts || order.order_items || order.items || [];
  const { totalDuration, totalAmount, mappedItems } =
    await _mapOrderItems(supabase, items, order.total_collected);

  const startTime = orderTime;
  const endTime   = new Date(orderTime.getTime() + totalDuration * 60 * 1000);

  // 4. Resolve or create customer
  const customerId = await _resolveCustomer(supabase, {
    name:  order.customer_name  || null,
    phone: order.customer_phone || null,
    id:    order.customer_id    || null,
  });

  // 5. Resolve barber from Moka item_id (checkouts[0].item_id = barber's moka_employee_id)
  //    This is more accurate than "find available" since we know exactly which barber served them
  let barberId = null;
  const firstItem = items[0];
  if (firstItem?.item_id) {
    const { data: barber } = await supabase
      .from('barbers')
      .select('id')
      .eq('moka_employee_id', String(firstItem.item_id))
      .eq('outlet_id', outletId)
      .maybeSingle();
    barberId = barber?.id || null;
  }
  // Fallback: find any available barber if specific one not matched
  if (!barberId) {
    const { data: avail } = await supabase.rpc('find_available_barber', {
      p_outlet_id: outletId,
      p_start:     startTime.toISOString(),
      p_end:       endTime.toISOString(),
    });
    barberId = avail || null;
  }

  // 6. Insert schedule
  const { data: schedule, error: schErr } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    outletId,
      barber_id:    barberId || null,
      customer_id:  customerId || null,
      service_name: mappedItems.map(i => i.name).join(' + '),
      price:        totalAmount,
      start_time:   startTime.toISOString(),
      end_time:     endTime.toISOString(),
      status:       scheduleStatus,
      source:       'moka',
      external_id:  mokaOrderId,
      notes:        barberId ? null : '⚠ No barber matched — assign manually',
    })
    .select()
    .single();

  if (schErr) {
    // Overlap constraint: open bill already blocked this slot.
    // If this is a completed transaction, upgrade the existing open-bill reservation.
    if ((schErr.code === '23P01' || schErr.message?.includes('no_barber_overlap'))
        && scheduleStatus === 'completed' && barberId) {
      const { data: openBillSch } = await supabase
        .from('schedules')
        .select('id')
        .eq('outlet_id', outletId)
        .eq('barber_id', barberId)
        .eq('source', 'moka')
        .eq('status', 'reserved')
        .gte('start_time', startTime.toISOString())
        .lt('start_time', endTime.toISOString())
        .maybeSingle();
      if (openBillSch) {
        await supabase.from('schedules').update({
          status:      'completed',
          external_id: mokaOrderId,
        }).eq('id', openBillSch.id);
        await _insertTransaction(supabase, {
          customerId, outletId,
          scheduleId:  openBillSch.id,
          externalId:  mokaOrderId,
          totalAmount,
          source:      'moka',
          mokaPayload: order,
          items:       mappedItems,
        });
        return 'updated';
      }
      return 'skipped';
    }
    throw new Error(`Schedule insert failed: ${schErr.message}`);
  }

  // 7. Insert transaction (only for completed orders — HOLD transactions haven't been paid)
  if (scheduleStatus === 'completed') {
    await _insertTransaction(supabase, {
      customerId, outletId,
      scheduleId:  schedule.id,
      externalId:  mokaOrderId,
      totalAmount,
      source:      'moka',
      mokaPayload: order,
      items:       mappedItems,
    });
  }

  return 'processed';
}

/**
 * Try to extract the appointment time from a Moka bill name.
 * Kasir convention: bill names include "HH.MM DayName" (e.g., "Satria Abdul 15.00 Sabtu").
 * This is critical for advance bills created today for a future day's appointment.
 *
 * @param {string}      billName    - e.g. "Satria Abdul 15.00 Sabtu"
 * @param {string|Date} billCreatedAt - bill creation timestamp (to resolve day → date)
 * @returns {Date|null} appointment start time as UTC Date, or null if not parseable
 */
function _parseAppointmentTimeFromBillName(billName, billCreatedAt) {
  if (!billName) return null;

  const WIB_MS = 7 * 60 * 60 * 1000;
  const created  = _safeDate(billCreatedAt);
  const wibBase  = new Date(created.getTime() + WIB_MS);

  // Pattern C (NEW — highest priority): "DD/MM HH.MM" or "DD/MM HH:MM" — explicit date
  // Kasir format: "ARIF 09/05 18.30 ONOY" → 9 May at 18:30 WIB
  // Lebih presisi dari Pattern A/B karena tanggal tidak ambigu.
  const matchWithDate = billName.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s+(\d{1,2})[.:](\d{2})/);
  if (matchWithDate) {
    const day     = parseInt(matchWithDate[1], 10);
    const month   = parseInt(matchWithDate[2], 10);
    const yearStr = matchWithDate[3] ? String(matchWithDate[3]).trim() : '';
    const hours   = parseInt(matchWithDate[4], 10);
    const minutes = parseInt(matchWithDate[5], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      let year = wibBase.getUTCFullYear();
      if (yearStr) {
        const rawYear = parseInt(yearStr, 10);
        if (!Number.isNaN(rawYear)) {
          year = yearStr.length === 2 ? (2000 + rawYear) : rawYear;
        }
      }
      const mo = String(month).padStart(2, '0');
      const d  = String(day).padStart(2, '0');
      const h  = String(hours).padStart(2, '0');
      const mi = String(minutes).padStart(2, '0');
      let candidate = new Date(`${year}-${mo}-${d}T${h}:${mi}:00+07:00`);
      // Tanggal sudah lewat lebih dari 1 hari → booking untuk tahun depan (e.g. Des → Jan)
      if (!yearStr && candidate.getTime() < wibBase.getTime() - 86_400_000) {
        year += 1;
        candidate = new Date(`${year}-${mo}-${d}T${h}:${mi}:00+07:00`);
      }
      return candidate;
    }
  }

  // Pattern A: "HH.MM DayName" or "DayName HH.MM" — advance bill with day name (either order)
  // e.g. "Satria Abdul 15.00 Sabtu" atau "Budiono minggu 10.00 bob"
  const ID_DAYS = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
  const matchWithDay =
    billName.match(/(\d{1,2})[.:](\d{2})\s*(minggu|senin|selasa|rabu|kamis|jumat|sabtu)/i) ||
    billName.match(/(minggu|senin|selasa|rabu|kamis|jumat|sabtu)\s+(\d{1,2})[.:](\d{2})/i);
  if (matchWithDay) {
    // Normalise: grup 1&2 = jam&menit jika format TIME DAY, atau 2&3 jika format DAY TIME
    const isTimeThenDay = /^\d/.test(matchWithDay[1]);
    const hours   = parseInt(isTimeThenDay ? matchWithDay[1] : matchWithDay[2], 10);
    const minutes = parseInt(isTimeThenDay ? matchWithDay[2] : matchWithDay[3], 10);
    const dayStr  = (isTimeThenDay ? matchWithDay[3] : matchWithDay[1]).toLowerCase();
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    const targetDow  = ID_DAYS[dayStr];
    if (targetDow === undefined) return null;

    const createdDow = wibBase.getUTCDay();
    const daysToAdd  = (targetDow - createdDow + 7) % 7 || 7; // 0 → 7 agar tidak ke hari ini yg sudah lewat
    const targetWIB  = new Date(wibBase.getTime() + daysToAdd * 86_400_000);

    const y  = targetWIB.getUTCFullYear();
    const mo = String(targetWIB.getUTCMonth() + 1).padStart(2, '0');
    const d  = String(targetWIB.getUTCDate()).padStart(2, '0');
    const h  = String(hours).padStart(2, '0');
    const mi = String(minutes).padStart(2, '0');
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:00+07:00`);
  }

  // Pattern B: "HH.MM" or "HH:MM" without day name — same-day GoShow
  // e.g. "-justin abdul 16.00" → today at 16:00 (using createdAt date in WIB)
  // Only accept business-hours range (8–22) to avoid matching dates or prices.
  const matchTimeOnly = billName.match(/\b(\d{1,2})[.:](\d{2})\b/);
  if (matchTimeOnly) {
    const hours   = parseInt(matchTimeOnly[1], 10);
    const minutes = parseInt(matchTimeOnly[2], 10);
    if (hours >= 8 && hours <= 22 && minutes >= 0 && minutes <= 59) {
      const y  = wibBase.getUTCFullYear();
      const mo = String(wibBase.getUTCMonth() + 1).padStart(2, '0');
      const d  = String(wibBase.getUTCDate()).padStart(2, '0');
      const h  = String(hours).padStart(2, '0');
      const mi = String(minutes).padStart(2, '0');
      return new Date(`${y}-${mo}-${d}T${h}:${mi}:00+07:00`);
    }
  }

  return null;
}

/**
 * For structured bill names "CUSTOMER DD/MM HH.MM BARBER", extract the barber
 * name hint = text after the time pattern. Returns null for unstructured names.
 * Example: "bayu 10/05 12.00 abdul" → "abdul"
 */
function _parseBarberHintFromBillName(billName) {
  if (!billName) return null;
  const m = billName.match(/\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\s+\d{1,2}[.:]\d{2}\s+(.*)/);
  const hint = m ? m[1].trim() : null;
  return hint || null;
}

/**
 * Process a single PENDING walk-in bill from sync_bills API.
 * Creates a 'reserved' schedule to block the slot on the website.
 * When the bill is later COMPLETED, _processIncomingOrder (Pull 1) will update it.
 *
 * @param {object} bill   - sync_bills entry from Moka
 * @param {string} outletId
 * @param {MokaClient} [client] - optional, used for variant→item lookup fallback
 */
async function _processOpenBill(supabase, bill, outletId, client = null) {
  const billId     = String(bill.id);
  const billName   = bill.name || '';
  const billStatus = (bill.status || '').toUpperCase();

  // Only process PENDING bills
  if (billStatus !== 'PENDING') return 'skipped';

  // ── Resolve barber + service FIRST (needed for both insert and update paths) ─
  // Moka response: schema docs use 'bill_detail' (snake_case), but actual API
  // returns 'billDetail' (camelCase) per the example payload. Support both.
  const billDetail = bill.billDetail || bill.bill_detail || null;
  const items = billDetail?.items || bill.checkouts || bill.items || [];
  let barberId    = null;
  let serviceName = billName;
  let totalPrice  = bill.totalPrice || bill.total
                 || billDetail?.bill_total_amount || billDetail?.bill_sub_total_amount || 0;
  if (typeof totalPrice === 'string') totalPrice = parseFloat(totalPrice) || 0;

  // Pass 1: match by item ID (parent item ID = barber's moka_employee_id)
  // Walk SEMUA items — bukan cuma pertama — supaya kita bisa:
  //   • find barberId dari item match pertama
  //   • collect SEMUA variant names (utk concat service display)
  //   • sum durasi setiap variant individually di Pass 4 (lebih akurat
  //     daripada lookup string "Hair Cut + Fade" yang tidak ada di DB)
  const collectedVariantNames = []; // urutan order seperti di bill
  let priceFromItems = 0;
  for (const item of items) {
    const mokaItemId = String(item.item_id || item.id || '');

    // Resolve barber from first matching item
    if (!barberId && mokaItemId) {
      const { data: barber } = await supabase
        .from('barbers').select('id')
        .eq('moka_employee_id', mokaItemId)
        .eq('outlet_id', outletId)
        .maybeSingle();
      if (barber) barberId = barber.id;
    }

    // Collect variant info (every item, not just first)
    const variantArr  = Array.isArray(item.item_variants) ? item.item_variants : [];
    const variantName = variantArr[0]?.name || item.variant_name || item.item_variant_name || null;
    if (variantName) collectedVariantNames.push(variantName);
    if (variantArr[0]?.price) priceFromItems += Number(variantArr[0].price) || 0;
    else if (item.price) priceFromItems += Number(item.price) || 0;
  }

  if (collectedVariantNames.length) {
    serviceName = collectedVariantNames.join(' + ');
  }
  if (!totalPrice && priceFromItems) totalPrice = priceFromItems;

  // Pass 2 (ENHANCED): Use improved barber resolution with outlet validation
  // This prevents cross-branch assignment errors like Yuki→Abdul instead of Yuki→Opan
  if (!barberId && billName) {
    try {
      const { resolveBarberWithValidation, validateOutletAssignment } = require('./improved-sync');
      
      // Resolve barber with strict validation
      const resolution = await resolveBarberWithValidation(billName, outletId, billId);
      
      if (resolution) {
        barberId = resolution.barberId;
        
        // Validate outlet assignment to prevent cross-branch errors
        const isValidOutlet = await validateOutletAssignment(barberId, outletId, billId);
        
        if (!isValidOutlet) {
          console.error(`[Sync] ❌ CRITICAL: Outlet validation failed for bill ${billId} - preventing cross-branch assignment`);
          barberId = null; // Reset to prevent wrong assignment
        } else {
          console.log(`[Sync] ✅ Enhanced barber resolution for bill ${billId}: ${resolution.method} (confidence: ${resolution.confidence})`);
          
          // Use parsed time from structured format if available
          if (resolution.parsedTime && !parsedStart) {
            parsedStart = resolution.parsedTime;
            console.log(`[Sync] 📅 Using parsed appointment time: ${parsedStart.toISOString()}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[Sync] Open bill ${billId} enhanced resolution failed:`, e.message);
      // Fall back to original method as safety net
      const fallbackId = await _fallbackBarberResolution(billName, outletId, billId);
      if (fallbackId) {
        barberId = fallbackId;
      }
    }
  }

  // Fallback barber resolution (original method as safety net)
  async function _fallbackBarberResolution(billName, outletId, billId) {
    try {
      const { _matchScore } = require('./schemaSync');
      const { data: outletBarbers } = await supabase
        .from('barbers').select('id, name')
        .eq('outlet_id', outletId).eq('is_active', true);
      let bestId = null, bestScore = 0;
      const barberHint = _parseBarberHintFromBillName(billName);
      for (const b of outletBarbers || []) {
        if (!b.name) continue;
        let score;
        if (barberHint) {
          // Structured: match only against the hint token (not full bill name)
          const hintLower   = barberHint.toLowerCase();
          const barberLower = b.name.toLowerCase();
          const tokens = barberLower.split(/\s+/).filter(t => t.length >= 2);
          const tokenHit = tokens.some(t => hintLower.includes(t));
          score = tokenHit ? 0.95 : _matchScore(barberHint, b.name);
        } else {
          // Unstructured: fall back to scanning full bill name
          const bnLower  = billName.toLowerCase();
          const tokens   = String(b.name).toLowerCase().split(/\s+/).filter(t => t.length >= 3);
          const tokenHit = tokens.some(t => bnLower.includes(t));
          score = tokenHit ? 0.9 : _matchScore(billName, b.name);
        }
        if (score > bestScore) { bestScore = score; bestId = b.id; }
      }
      const threshold = barberHint ? 0.4 : 0.5;
      if (bestScore >= threshold) {
        return bestId; // Return instead of setting external variable
      }
    } catch (e) {
      console.warn(`[Sync] Open bill ${billId} fallback resolution failed:`, e.message);
    }
    return null;
  }

  // Pass 3 (fallback): if still no match and we have a client, look up variant ID against
  // the items library to find the parent item (barber). Useful when bill items only contain
  // variant IDs without parent context.
  if (!barberId && client) {
    try {
      const mokaItems = await _getMokaItems(client, outletId);
      for (const item of items) {
        const variantId = String(item.id || '');
        if (!variantId) continue;
        const parent = mokaItems.find(mi =>
          (mi.item_variants || []).some(v => String(v.id) === variantId)
        );
        if (parent) {
          const { data: barber } = await supabase
            .from('barbers').select('id')
            .eq('moka_employee_id', String(parent.id))
            .eq('outlet_id', outletId)
            .maybeSingle();
          if (barber) {
            barberId = barber.id;
            console.log(`[Sync] Open bill ${billId}: barber resolved by variant→parent lookup → ${barber.id}`);
            break;
          }
        }
      }
    } catch (e) {
      console.warn(`[Sync] Open bill ${billId} variant→parent lookup failed:`, e.message);
    }
  }

  if (!barberId) {
    const nonBarberNames = items
      .map(i => (Array.isArray(i.item_variants) ? i.item_variants[0]?.name : null) || i.name || i.item_name)
      .filter(Boolean);
    if (nonBarberNames.length) serviceName = nonBarberNames.join(' + ');
    console.log(`[Sync] Open bill ${billId} ("${billName}") → no barber match; will insert as outlet-wide block`);
  }

  // ── Pass 4: Resolve service duration ─────────────────────────────────
  // SUM durasi PER variant, bukan sekedar lookup gabungan string.
  // Contoh: bill "Hair Cut + Hair Fade Cut" → 45 + 60 = 105 menit.
  // Tanpa ini, slot kapster ke-blok kurang dari durasi sebenarnya
  // dan web booking bisa tetap konflik dengan walk-in.
  let durationMin = 0;
  let resolvedDurations = 0;

  for (const variantName of collectedVariantNames) {
    let svcDur = null;
    const { data: svcByVariant } = await supabase
      .from('services').select('duration_minutes')
      .ilike('moka_variant_name', variantName).maybeSingle();
    if (svcByVariant?.duration_minutes) {
      svcDur = svcByVariant.duration_minutes;
    } else {
      const { data: svcByName } = await supabase
        .from('services').select('duration_minutes')
        .ilike('name', variantName).maybeSingle();
      if (svcByName?.duration_minutes) svcDur = svcByName.duration_minutes;
    }
    if (svcDur) {
      durationMin += svcDur;
      resolvedDurations++;
    }
  }

  // Fallback A: tidak ada variant match → coba lookup billName as a whole
  if (durationMin === 0 && serviceName) {
    const { data: svcByVariant } = await supabase
      .from('services').select('duration_minutes')
      .ilike('moka_variant_name', serviceName).maybeSingle();
    if (svcByVariant?.duration_minutes) {
      durationMin = svcByVariant.duration_minutes;
    } else {
      const { data: svcByName } = await supabase
        .from('services').select('duration_minutes')
        .ilike('name', serviceName).maybeSingle();
      if (svcByName?.duration_minutes) durationMin = svcByName.duration_minutes;
    }
  }

  // Fallback B: masih nol → 60 menit safe default
  if (durationMin === 0) durationMin = 60;

  // Fallback C: jika sebagian variant tidak ke-resolve, pakai max-known-duration
  // sebagai safety: lebih baik over-block sedikit daripada under-block dan
  // bikin double booking.
  if (collectedVariantNames.length > 0 && resolvedDurations < collectedVariantNames.length) {
    const { data: maxSvc } = await supabase
      .from('services').select('duration_minutes')
      .eq('is_active', true)
      .order('duration_minutes', { ascending: false })
      .limit(1).maybeSingle();
    const fallbackPerUnresolved = maxSvc?.duration_minutes || 60;
    durationMin += (collectedVariantNames.length - resolvedDurations) * fallbackPerUnresolved;
  }

  // Tambah buffer transisi (cleanup kapster) ke total.
  durationMin += MOKA_OPENBILL_BUFFER_MIN;

  // ── Parse appointment time from bill name ─────────────────
  // Kasir memberi nama bill dengan format "NamaCustomer HH.MM HariIni",
  // mis. "Satria Abdul 15.00 Sabtu". Ini adalah waktu appointment SEBENARNYA.
  // Jika tidak ada pola ini, fall back ke bill.createdAt (GoShow langsung).
  let parsedStart = _parseAppointmentTimeFromBillName(billName, bill.createdAt || bill.created_at);
  let startTime     = parsedStart || _safeDate(bill.createdAt, bill.created_at);
  let endTime       = new Date(startTime.getTime() + durationMin * 60_000);

  // ── FINAL VALIDATION: Prevent cross-branch assignment ───────
  // CRITICAL: Validasi final untuk mencegah double booking antar cabang
  if (barberId) {
    const { validateOutletAssignment } = require('./improved-sync');
    const isValidOutlet = await validateOutletAssignment(barberId, outletId, billId);
    
    if (!isValidOutlet) {
      console.error(`[Sync] ❌ FATAL: Cross-branch assignment detected for bill ${billId}`);
      console.error(`    This would cause double booking - blocking assignment completely`);
      barberId = null; // Force outlet-wide block instead of wrong assignment
    }
  }

  // ── Idempotency: check for existing schedule ──────────────
  // PENTING: idempotency check HARUS dilakukan SEBELUM queue logic, karena
  // queue logic hanya untuk insert baru. Tanpa ini, sync rerun akan
  // mendorong existing schedule ke depan tiap iterasi (infinite drift).
  const { data: existing } = await supabase
    .from('schedules').select('id, barber_id, service_name, start_time, end_time, status').eq('external_id', billId).maybeSingle();

  // ── GOSHOW QUEUE: 1 kapster untuk multiple orang ────────────
  // HANYA untuk INSERT BARU (existing == null). Skenario: kasir buat Bill A
  // jam 14:00 (Bob, 60m → end 15:10) lalu Bill B jam 14:05 (Bob, 45m).
  // Tanpa logika ini, Bill B akan ditolak oleh constraint no_barber_overlap.
  // Solusi: kalau goshow (parsedStart=null) dan barber_id sama sudah punya
  // schedule reserved aktif, geser startTime Bill B = end_time Bill A.
  //
  // BERLAKU untuk goshow saja. Advance booking ("Adit 15.00 Sabtu") tetap
  // dihormati — tidak digeser ke antrian.
  if (!existing && !parsedStart && barberId) {
    const { data: queueAhead } = await supabase
      .from('schedules')
      .select('id, end_time, external_id')
      .eq('barber_id', barberId)
      .eq('source', 'moka')
      .eq('status', 'reserved')
      .neq('external_id', billId)               // exclude diri sendiri
      .gt('end_time', startTime.toISOString())  // masih akan/sedang aktif
      .order('end_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (queueAhead?.end_time) {
      const queuedStart = new Date(queueAhead.end_time);
      console.log(`[Sync] Open bill ${billId} (goshow queue) → di-queue setelah ${queueAhead.external_id}: ${startTime.toISOString()} → ${queuedStart.toISOString()}`);
      startTime = queuedStart;
      endTime   = new Date(startTime.getTime() + durationMin * 60_000);
    }
  }

  if (existing) {
    const patch = {};

    // Reactivate jika bill masih PENDING di Moka tapi schedule di-cancel stale cleanup.
    // Tanpa ini, slot tidak pernah bisa diblok lagi setelah di-cancel.
    if (existing.status === 'cancelled') {
      patch.status = 'reserved';
      patch.notes  = null;
    }

    // If barber was missing before but we resolved it now — patch it
    if (!existing.barber_id && barberId) {
      patch.barber_id = barberId;
      if (!patch.notes) patch.notes = null;
      if (existing.service_name === billName && serviceName !== billName) {
        patch.service_name = serviceName;
      }
    }

    // If structured hint resolves a DIFFERENT barber than stored — correct it.
    // Structured hint is high-confidence (fixed position after DD/MM HH.MM in bill name).
    const structuredHint = _parseBarberHintFromBillName(billName);
    if (structuredHint && barberId && existing.barber_id && existing.barber_id !== barberId) {
      patch.barber_id = barberId;
      console.log(`[Sync] Open bill ${billId}: correcting barber ${existing.barber_id} → ${barberId} (structured hint "${structuredHint}")`);
    }

    // If start_time was stored wrong (e.g. used createdAt before this fix), correct it
    if (parsedStart) {
      const existingMs = new Date(existing.start_time).getTime();
      const correctMs  = parsedStart.getTime();
      if (Math.abs(existingMs - correctMs) > 5 * 60_000) { // lebih dari 5 menit beda
        patch.start_time = startTime.toISOString();
        patch.end_time   = endTime.toISOString();
      }
    }

    // Correct end_time if stored duration is shorter than what we now compute.
    // This fixes old records created before the 60-min default was in place (were 30 min).
    // Only extend; never shrink — avoids overwriting a correctly-resolved duration.
    if (!patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();
      if (endTime.getTime() > existingEndMs + 5 * 60_000) {
        patch.end_time = endTime.toISOString();
      }
    }

    // Jika sebelumnya ada buffer, dan sekarang buffer = 0, maka end_time lama bisa terlalu panjang.
    // Untuk open-bill schedules, kita boleh shrink supaya slot per jam tidak ikut terblokir.
    if (!patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();
      if (endTime.getTime() < existingEndMs - 5 * 60_000) {
        patch.end_time = endTime.toISOString();
      }
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from('schedules').update(patch).eq('id', existing.id);
      return 'updated';
    }
    return 'skipped';
  }

  // ── Insert new schedule ───────────────────────────────────

  // Untuk format terstruktur "CUSTOMER DD/MM HH.MM BARBER", ekstrak nama customer
  // dari bagian sebelum tanggal. Tanpa ini, billName penuh ("ARIF 09/05 18.30 ONOY")
  // tersimpan sebagai nama customer — tidak ideal untuk CRM.
  const structuredNameMatch = billName.match(/^(.+?)\s+\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\s+\d{1,2}[.:]\d{2}/);
  const resolvedCustomerName = structuredNameMatch
    ? structuredNameMatch[1].trim()
    : (bill.customer_name || billName || null);

  const customerId = await _resolveCustomer(supabase, {
    name:  resolvedCustomerName,
    phone: bill.customer_phone || null,
    id:    null,
  });

  const { error: schErr } = await supabase.from('schedules').insert({
    outlet_id:    outletId,
    barber_id:    barberId || null,
    customer_id:  customerId || null,
    service_name: serviceName || billName,
    price:        totalPrice,
    start_time:   startTime.toISOString(),
    end_time:     endTime.toISOString(),
    status:       'reserved',
    source:       'moka',
    external_id:  billId,
    notes:        barberId ? null : '⚠ No barber matched — assign manually',
  });

  if (schErr) {
    // Handle duplicate external_id - bill already synced
    if (schErr.message?.includes('schedules_external_id_key') || schErr.code === '23505') {
      console.log(`[Sync] Open bill ${billId} already exists (duplicate external_id), skipping`);
      return 'skipped';
    }
    // Handle overlapping schedule (goshow queue)
    if (schErr.message?.includes('no_barber_overlap') || schErr.code === '23P01') return 'skipped';
    throw new Error(`Open bill insert failed: ${schErr.message}`);
  }

  return 'processed';
}

// ── WEBHOOK HANDLER ────────────────────────────────────────

/**
 * Handle a Moka Advanced Ordering callback.
 *
 * Moka POSTs to our per-order callback URLs when the cashier
 * accepts, completes, or rejects an order. Payload format:
 *   { outlet_id: number, application_order_id: string, status: string }
 *
 * Status mapping:
 *   'accepted'  → schedule.status = 'confirmed'
 *   'completed' → schedule.status = 'completed'
 *   'rejected'  → schedule.status = 'cancelled'
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} callbackBody - parsed body from Moka
 */
async function handleWebhookEvent(supabase, callbackBody) {
  const {
    application_order_id: scheduleId,
    status:               mokaStatus,
  } = callbackBody || {};

  if (!scheduleId || !mokaStatus) {
    console.warn('[Callback] Moka callback missing required fields:', callbackBody);
    return;
  }

  const STATUS_MAP = {
    accepted:  'confirmed',
    completed: 'completed',
    rejected:  'cancelled',
  };

  const newStatus = STATUS_MAP[mokaStatus];
  if (!newStatus) {
    console.warn(`[Callback] Unrecognised Moka status "${mokaStatus}" — ignored`);
    return;
  }

  const { data: schedule, error } = await supabase
    .from('schedules')
    .update({ status: newStatus })
    .eq('id', scheduleId)   // application_order_id = our schedule UUID
    .select('external_id, source')
    .single();

  if (error) {
    console.error(`[Callback] Update schedule ${scheduleId} failed:`, error.message);
  } else {
    console.log(`[Callback] Schedule ${scheduleId}: Moka "${mokaStatus}" → local "${newStatus}"`);

    // Mirror status ke bookings table jika schedule ini berasal dari bridge booking.
    // Bridge booking punya external_id awal 'booking:<uuid>' sebelum diganti Moka order ID.
    // Setelah push sukses external_id jadi Moka order ID, tapi source tetap 'web'.
    // Kita lookup booking berdasarkan schedule UUID yang tersimpan di bookings.notes atau
    // lewat jadwal → cari booking dengan barber+date+time yang sama.
    // Cara paling andal: simpan schedule_id di bookings table (via trigger atau lookup).
    // Fallback sementara: update bookings WHERE schedule_id = scheduleId (jika kolom ada).
    if (schedule?.source === 'web' || schedule?.source === 'bridge') {
      // Try to update bookings table by schedule_id reference (if column exists)
      supabase.from('bookings')
        .update({ status: newStatus === 'confirmed' ? 'confirmed'
                        : newStatus === 'completed'  ? 'done'
                        : newStatus === 'cancelled'  ? 'cancelled'
                        : newStatus })
        .eq('schedule_id', scheduleId)
        .then(() => {})
        .catch(() => {
          // Column schedule_id might not exist yet — non-fatal
        });
    }
  }

  // Log the callback for audit
  await supabase.from('sync_logs').insert({
    direction:   'moka_to_web',
    entity_type: 'schedule',
    entity_id:   scheduleId,
    status:      error ? 'failed' : 'success',
    error_message: error?.message || null,
  }).catch(() => {});
}

// ── CRON SCHEDULER ────────────────────────────────────────

/**
 * Register a cron job that pulls Moka orders every 5 minutes.
 * Safe to call once at server startup.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
function startCronJobs(supabase) {
  if (process.env.NODE_ENV === 'test') return;
  if (!supabase) { console.warn('[Cron] Supabase not configured — skipping Moka cron'); return; }

  let cron;
  try { cron = require('node-cron'); } catch {
    console.warn('[Cron] node-cron not available (serverless env) — cron skipped');
    return;
  }

  // Cron 1: Pull Moka → Web sesering mungkin untuk mempercepat blok slot goshow
  cron.schedule(`*/${MOKA_PULL_INTERVAL_MINUTES} * * * *`, async () => {
    try {
      const { data: outletIds } = await supabase
        .from('outlets').select('id').eq('is_active', true)
        .not('moka_outlet_id', 'is', null);

      if (!outletIds?.length) return;

      const { data: tokenRows } = await supabase
        .from('moka_tokens').select('outlet_id')
        .in('outlet_id', outletIds.map(o => o.id));

      const authorizedIds = new Set((tokenRows || []).map(r => r.outlet_id));

      for (const o of outletIds) {
        if (!authorizedIds.has(o.id)) continue;
        pullMokaToWeb(supabase, o.id).catch(err => {
          console.error(`[Cron] Outlet ${o.id} sync error:`, err.message);
        });
      }
    } catch (err) {
      console.error('[Cron] Pull sync error:', err.message);
    }
  });

  // Cron 2: Retry fallback — interval lebih rapat dari default lama
  // Push real-time dilakukan saat booking dibuat. Cron ini menangani jadwal
  // yang gagal push dalam 24 jam ke depan. Dua kondisi yang perlu di-retry:
  //   (a) external_id IS NULL  → push belum pernah dicoba / gagal sebelum save
  //   (b) external_id LIKE 'booking:%' → bridge booking (dari /api/bookings)
  //       yang belum dapat Moka order ID
  cron.schedule(`*/${MOKA_RETRY_INTERVAL_MINUTES} * * * *`, async () => {
    try {
      const now     = new Date();
      const ceiling = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const range   = { gte: now.toISOString(), lte: ceiling.toISOString() };

      // (a) external_id null
      const { data: nullMissed } = await supabase
        .from('schedules')
        .select('id')
        .is('external_id', null)
        .in('status', ['reserved', 'confirmed'])
        .gte('start_time', range.gte)
        .lte('start_time', range.lte);

      // (b) external_id starts with 'booking:' (bridge ref, not a real Moka ID)
      const { data: bridgeMissed } = await supabase
        .from('schedules')
        .select('id')
        .like('external_id', 'booking:%')
        .in('status', ['reserved', 'confirmed'])
        .gte('start_time', range.gte)
        .lte('start_time', range.lte);

      const missed = [...(nullMissed || []), ...(bridgeMissed || [])];
      if (!missed.length) return;

      console.log(`[Cron] Retry push: ${missed.length} schedule(s) belum ke Moka`);
      for (const s of missed) {
        pushScheduleToMoka(supabase, s.id).catch(err =>
          console.error(`[Cron] Retry push ${s.id}:`, err.message)
        );
      }
    } catch (err) {
      console.error('[Cron] Retry push error:', err.message);
    }
  });

  // Cron 3: Auto-expire stale reserved Open Bill schedules.
  // Skenario: kasir membuat open bill jam 14:00 (durasi 60m + buffer 10m → end 15:10),
  // tapi LUPA close bill di MokaPOS sampai akhir hari. Tanpa cron ini, schedule
  // tetap "reserved" → slot kapster terblokir selamanya di web booking.
  //
  // Logika: jika end_time + safety_window (default 4 jam) sudah lewat dan status
  // masih 'reserved' & source='moka', mark cancelled.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - MOKA_OPENBILL_STALE_HOURS * 60 * 60 * 1000).toISOString();
      const { data: stale, error } = await supabase
        .from('schedules')
        .update({ status: 'cancelled', notes: '[auto] stale open bill — kasir lupa close di MokaPOS' })
        .eq('source', 'moka')
        .eq('status', 'reserved')
        .lt('end_time', cutoff)
        .select('id');
      if (error) {
        console.error('[Cron] Stale open-bill expire error:', error.message);
      } else if (stale?.length) {
        console.log(`[Cron] Auto-expired ${stale.length} stale reserved open-bill schedule(s)`);
      }
    } catch (err) {
      console.error('[Cron] Stale open-bill expire error:', err.message);
    }
  });

  // Cron 4: Schema sync harian jam 03:00 WIB (20:00 UTC)
  cron.schedule('0 20 * * *', async () => {
    console.log('[Cron] Daily schema sync starting…');
    try {
      const { syncMokaSchema } = require('./schemaSync');
      const report = await syncMokaSchema(supabase);
      console.log(`[Cron] Schema sync done — barbers:${report.barbers_updated} services:${report.services_updated} errors:${report.errors.length}`);
    } catch (err) {
      console.error('[Cron] Schema sync error:', err.message);
    }
  });

  // Run schema sync sekali saat startup (non-blocking)
  setTimeout(async () => {
    try {
      const { syncMokaSchema } = require('./schemaSync');
      const report = await syncMokaSchema(supabase);
      console.log(`[Startup] Schema sync — barbers:${report.barbers_updated} services:${report.services_updated}`);
    } catch (err) {
      console.warn('[Startup] Schema sync failed:', err.message);
    }
  }, 5000);

  console.log(`[Cron] Moka jobs scheduled: pull ${MOKA_PULL_INTERVAL_MINUTES}min, retry ${MOKA_RETRY_INTERVAL_MINUTES}min, stale-bill expire 15min (window ${MOKA_OPENBILL_STALE_HOURS}h, buffer ${MOKA_OPENBILL_BUFFER_MIN}m), schema sync 03:00 WIB`);
}

function getLastSyncAt(outletId) {
  return _lastSyncAt.get(outletId) || null;
}

async function maybeRefreshOutletData(supabase, outletId, options = {}) {
  const maxAgeMs = Math.max(5_000, parseInt(options.maxAgeMs, 10) || MOKA_ON_DEMAND_SYNC_MAX_AGE_MS);
  const lastSyncAt = getLastSyncAt(outletId);
  if (lastSyncAt && (Date.now() - new Date(lastSyncAt).getTime()) < maxAgeMs) {
    return { refreshed: false, reason: 'fresh_cache', lastSyncAt };
  }

  try {
    const result = await pullMokaToWeb(supabase, outletId);
    return { refreshed: true, lastSyncAt: getLastSyncAt(outletId), result };
  } catch (err) {
    return {
      refreshed: false,
      reason: 'sync_failed',
      error: err.message,
      lastSyncAt: getLastSyncAt(outletId),
    };
  }
}

// ── PRIVATE HELPERS ───────────────────────────────────────

async function _getClient(supabase, outletId, mokaOutletId) {
  if (!mokaOutletId) {
    // Fetch from DB if not provided
    const { data: outlet } = await supabase
      .from('outlets').select('moka_outlet_id').eq('id', outletId).single();
    mokaOutletId = outlet?.moka_outlet_id;
  }
  return new MokaClient(supabase, outletId, mokaOutletId);
}

/**
 * Build a payload for Moka Advanced Ordering API.
 * Spec: POST /v1/outlets/{outlet_id}/advanced_orderings/orders
 *
 * In Moka's item library: Items = barbers, Variants = service types.
 * So item_id = barber's moka_employee_id, variant_id = service variant in that barber's item.
 *
 * @param {object} schedule       - row from schedules_full view (enriched with barber/service moka fields)
 * @param {string|null} mokaCustomerId
 * @param {MokaClient|null} client - used to resolve variant ID from item cache
 * @returns {object}
 */
async function _buildMokaOrderPayload(schedule, client) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

  const note = [
    `Online booking — ${schedule.outlet_name || 'RedBox'}`,
    schedule.barber_name ? `Barber: ${schedule.barber_name}` : null,
    schedule.notes || null,
  ].filter(Boolean).join('. ');

  // In Moka: item = barber, variant = service type
  let mokaItemId   = schedule.barber_moka_employee_id ? String(schedule.barber_moka_employee_id) : null;
  let categoryId   = schedule.moka_category_id   ? String(schedule.moka_category_id) : null;
  let categoryName = schedule.moka_category_name || null;
  let variantId    = null;
  const variantName = schedule.moka_variant_name || schedule.service_name || null;

  // Resolve barber → Moka item via name matching against live items cache.
  // outlet_moka_id may not be in schedules_full view; client always has it.
  const mokaOutletId = schedule.outlet_moka_id || schedule.outlet_moka_outlet_id
    || (client && client._mokaOutletId) || null;
  if (mokaOutletId && schedule.barber_name) {
    try {
      const itemsRes = await _getMokaItems(client, schedule.outlet_id);
      let bestItem = null, bestScore = 0;
      for (const item of itemsRes) {
        if (!item.item_variants?.length) continue;
        const s = _matchScore(schedule.barber_name, item.name);
        if (s > bestScore) { bestScore = s; bestItem = item; }
      }
      if (bestItem && bestScore >= 0.6) {
        mokaItemId   = mokaItemId   || String(bestItem.id);
        categoryId   = categoryId   || (bestItem.category_id ? String(bestItem.category_id) : null);
        categoryName = categoryName || bestItem.category?.name || null;

        // Resolve variant by service name
        if (variantName && !variantId) {
          let bestV = null, bestVScore = 0;
          for (const v of (bestItem.item_variants || [])) {
            const vs = _matchScore(variantName, v.name);
            if (vs > bestVScore) { bestVScore = vs; bestV = v; }
          }
          if (bestV && bestVScore >= 0.5) {
            variantId = bestV.id;
          }
          // Fallback: first variant if still null
          if (!variantId && bestItem.item_variants?.length) {
            variantId = bestItem.item_variants[0].id;
          }
        }
      }
    } catch (err) {
      console.warn('[Sync] Could not resolve barber Moka item:', err.message);
    }
  }

  const orderItem = {
    item_id:            mokaItemId ? Number(mokaItemId) : undefined,
    item_name:          schedule.barber_name || 'Barber',
    quantity:           1,
    item_price_library: schedule.price || 0,
  };
  if (variantId)    orderItem.item_variant_id  = Number(variantId);
  if (variantName)  orderItem.item_variant_name = variantName;
  if (categoryId)   orderItem.category_id       = Number(categoryId);
  if (categoryName) orderItem.category_name      = categoryName;

  const orderItems = [orderItem];
  const reservasiFeeItemId = process.env.MOKA_RESERVASI_FEE_ITEM_ID;
  if (reservasiFeeItemId) {
    orderItems.push({
      item_id:            Number(reservasiFeeItemId),
      item_name:          'Biaya Reservasi',
      quantity:           1,
      item_price_library: 10000,
    });
  }

  return {
    application_order_id:            schedule.id,
    payment_type:                    'online_booking',
    customer_name:                   schedule.customer_name  || 'Guest',
    note:                            note.slice(0, 255),
    // BUG FIX: customer_id is NOT in Moka Order spec — removed.
    // Customer identified via customer_name + customer_phone_number.
    customer_phone_number:           schedule.customer_phone || undefined,
    client_created_at:               schedule.start_time,
    // BUG FIX: auto_cancel_in_seconds is NOT in Moka Order spec — removed.
    accept_order_notification_url:   `${base}/api/moka/callback/accept`,
    complete_order_notification_url: `${base}/api/moka/callback/complete`,
    cancel_order_notification_url:   `${base}/api/moka/callback/cancel`,
    order_items: orderItems,
  };
}

async function _getMokaItems(client, outletId) {
  const cached = _mokaItemsCache.get(outletId);
  if (cached && Date.now() - cached.ts < MOKA_ITEMS_CACHE_TTL) return cached.items;
  try {
    const res   = await client.getItems();
    // Try all known Moka v1/items response paths (consistent with schemaSync.js)
    const rawItems = res?.data?.items || res?.data?.item
      || (Array.isArray(res?.data) ? res.data : null)
      || res?.items || [];
    const items = Array.isArray(rawItems) ? rawItems : [];
    _mokaItemsCache.set(outletId, { ts: Date.now(), items });
    return items;
  } catch (err) {
    console.warn('[Sync] Could not fetch Moka items for cache:', err.message);
    return cached?.items || [];
  }
}

async function _mapOrderItems(supabase, items, totalCollected) {
  let totalDuration = 0;
  let totalAmount   = 0;
  const mappedItems = [];

  for (const item of items) {
    // In Moka checkouts: item_variant_name = service type, item_name = barber name
    const variantName = item.item_variant_name || item.variant_name || null;
    const itemName    = variantName || item.item_name || item.name || 'Service';
    const itemPrice   = item.price || item.unit_price || 0;
    const qty         = item.quantity || item.qty || 1;

    // Match service duration by moka_variant_name first, then by display name
    let svc = null;
    if (variantName) {
      const { data } = await supabase
        .from('services').select('duration_minutes, price')
        .ilike('moka_variant_name', variantName).maybeSingle();
      svc = data;
    }
    if (!svc) {
      const { data } = await supabase
        .from('services').select('duration_minutes, price')
        .ilike('name', itemName).maybeSingle();
      svc = data;
    }

    totalDuration += (svc?.duration_minutes || 30) * qty;
    totalAmount   += (itemPrice || svc?.price || 0) * qty;
    mappedItems.push({ name: itemName, price: itemPrice * qty, qty, moka_item_id: item.item_id || null });
  }

  if (!mappedItems.length) totalDuration = 30;
  // Prefer Moka's authoritative total_collected over per-item sum
  if (totalCollected != null) totalAmount = totalCollected;

  return { totalDuration, totalAmount, mappedItems };
}

async function _resolveCustomer(supabase, customerData) {
  if (!customerData) return null;

  const phone = _normalizePhone(customerData.phone || customerData.phone_number);
  const email = customerData.email || null;
  const name  = customerData.name  || customerData.customer_name || 'Moka Customer';
  const mokaId = String(customerData.id || customerData.customer_id || '');

  if (!phone && !email && !mokaId) return null;

  // Lookup by moka_customer_id first (fastest)
  if (mokaId) {
    const { data: byMoka } = await supabase
      .from('customers').select('id').eq('moka_customer_id', mokaId).maybeSingle();
    if (byMoka) return byMoka.id;
  }

  // Lookup by phone (wa column)
  if (phone) {
    const { data: byPhone } = await supabase
      .from('customers').select('id').eq('phone_e164', phone).maybeSingle();
    if (byPhone) {
      // Backfill moka_customer_id if missing
      if (mokaId || phone) {
        await supabase.from('customers')
          .update({
            moka_customer_id: mokaId || null,
            phone_e164: phone,
          })
          .eq('id', byPhone.id);
      }
      return byPhone.id;
    }
  }

  // Create new customer
  const { data: newCust } = await supabase
    .from('customers')
    .insert({
      name,
      wa: phone || '',
      phone_e164: phone || null,
      email,
      source: 'moka',
      moka_customer_id: mokaId || null,
    })
    .select('id')
    .single();

  return newCust?.id || null;
}

async function _insertTransaction(supabase, {
  customerId, outletId, scheduleId, externalId, totalAmount, source, mokaPayload, items,
}) {
  // Idempotency: skip if external_id already exists in transactions
  const { data: existing } = await supabase
    .from('transactions').select('id').eq('external_id', externalId).maybeSingle();
  if (existing) return existing;

  const { data: txn, error } = await supabase
    .from('transactions')
    .insert({
      customer_id:  customerId,
      outlet_id:    outletId,
      schedule_id:  scheduleId,
      external_id:  externalId,
      total_amount: totalAmount,
      source,
      status:      'completed',
      moka_payload: mokaPayload || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Transaction insert failed: ${error.message}`);

  if (items?.length) {
    await supabase.from('transaction_items').insert(
      items.map(i => ({
        transaction_id: txn.id,
        service_name:   i.name,
        price:          i.price || 0,
        quantity:       i.qty   || 1,
        moka_item_id:   i.moka_item_id || null,
      }))
    );
  }

  return txn;
}

/**
 * Robust date parser — handles ISO strings with +0700 (no-colon) timezone,
 * Unix timestamps in seconds, and falls back to now() if everything fails.
 */
function _safeDate(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    // Direct parse (standard ISO, ms timestamp number)
    let d = new Date(v);
    if (!isNaN(d.getTime())) return d;
    // Fix +0700 / -0700 → +07:00 / -07:00 (Moka API timezone format)
    if (typeof v === 'string') {
      const fixed = v.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3');
      d = new Date(fixed);
      if (!isNaN(d.getTime())) return d;
    }
    // Unix seconds (Moka sometimes returns epoch seconds as number/string)
    const n = Number(v);
    if (!isNaN(n) && n > 0) {
      d = new Date(n > 1e12 ? n : n * 1000);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return new Date(); // fallback to now
}

async function _startLog(supabase, direction, entityType, entityId) {
  const { data } = await supabase
    .from('sync_logs')
    .insert({ direction, entity_type: entityType, entity_id: String(entityId), status: 'pending' })
    .select('id').single();
  return data?.id;
}

async function _finishLog(supabase, logId, status, errorMessage = null, payload = null) {
  if (!logId) return;
  await supabase.from('sync_logs').update({
    status,
    error_message: errorMessage,
    payload:       payload ? JSON.parse(JSON.stringify(payload)) : null,
  }).eq('id', logId);
}

function _normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return `+${digits}`;
  if (digits.startsWith('0'))  return `+62${digits.slice(1)}`;
  return `+62${digits}`;
}

// ── BRIDGE: OLD BOOKINGS TABLE → SCHEDULES + MOKA ────────────

/**
 * Bridge a legacy `bookings` row into the new `schedules` table and push to Moka.
 * Called fire-and-forget from POST /api/bookings after the booking is saved.
 *
 * Idempotent: uses external_id = 'booking:<uuid>' so duplicate calls are no-ops.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} booking  - row from bookings table
 * @returns {Promise<{ scheduleId:string|null, mokaSync:string }>}
 */
async function bridgeBookingToMoka(supabase, booking) {
  const legacyRef = `booking:${booking.id}`;

  // Idempotency guard
  const { data: already } = await supabase
    .from('schedules').select('id').eq('external_id', legacyRef).maybeSingle();
  if (already) return { scheduleId: already.id, mokaSync: 'already_synced' };

  // 1. Resolve outlet from location slug
  const { data: outlet } = await supabase
    .from('outlets')
    .select('id, moka_outlet_id')
    .eq('slug', booking.location || 'bypass')
    .maybeSingle();

  if (!outlet?.id) {
    console.warn(`[Bridge] Outlet not found for location: "${booking.location}"`);
    return { scheduleId: null, mokaSync: 'skipped_no_outlet' };
  }

  // 2. Resolve service UUID from name (best-effort)
  let serviceId = null;
  if (booking.service) {
    const { data: svc } = await supabase
      .from('services').select('id').ilike('name', booking.service).maybeSingle();
    serviceId = svc?.id || null;
  }

  // 3. Build ISO timestamps (WIB = +07:00)
  const timeStr  = String(booking.time  || '09:00').slice(0, 5);
  const dateStr  = String(booking.date  || '').slice(0, 10);
  const startTime = `${dateStr}T${timeStr}:00+07:00`;
  const durMins   = _parseDurationMins(booking.duration);
  const endTime   = new Date(new Date(startTime).getTime() + durMins * 60_000).toISOString();

  // 4. Resolve/create customer by phone
  const phone = _normalizePhone(booking.wa);
  let customerId = null;
  if (phone) {
    const { data: existCust } = await supabase
      .from('customers').select('id').eq('phone_e164', phone).maybeSingle();
    if (existCust) {
      customerId = existCust.id;
    } else {
      const { data: newCust } = await supabase
        .from('customers')
        .insert({ name: booking.name || 'Guest', wa: phone, phone_e164: phone, source: 'web' })
        .select('id').single();
      customerId = newCust?.id;
    }
  }

  // 5. Insert schedule
  // Encode payment method in notes so it reaches the Moka cashier
  const paymentNote = _formatPaymentNote(booking.payment);
  const combinedNotes = [paymentNote, booking.notes].filter(Boolean).join(' | ');
  const scheduleStatus = String(booking.status || '').toLowerCase() === 'confirmed'
    ? 'confirmed'
    : 'reserved';

  const { data: schedule, error: schErr } = await supabase
    .from('schedules')
    .insert({
      outlet_id:    outlet.id,
      barber_id:    booking.barber_id || null,
      customer_id:  customerId,
      service_id:   serviceId,
      service_name: booking.service || null,
      price:        Number(booking.price) || 0,
      start_time:   startTime,
      end_time:     endTime,
      status:       scheduleStatus,
      source:       'web',
      external_id:  legacyRef,
      notes:        combinedNotes || null,
    })
    .select().single();

  if (schErr) {
    if (schErr.code === '23P01' || schErr.message?.includes('no_barber_overlap')) {
      console.warn(`[Bridge] Barber overlap for booking ${booking.id} — slot taken by Moka walk-in`);
      return { scheduleId: null, mokaSync: 'conflict_overlap' };
    }
    console.error(`[Bridge] Schedule insert failed for booking ${booking.id}:`, schErr.message);
    return { scheduleId: null, mokaSync: 'error_insert' };
  }

  // 6. Write schedule_id back to bookings so Moka callbacks can mirror status
  supabase.from('bookings')
    .update({ schedule_id: schedule.id })
    .eq('id', booking.id)
    .then(() => {})
    .catch(() => {}); // non-fatal — column may not exist yet

  // 7. Push to Moka
  const { isMokaOAuthConfigured } = require('./oauth');
  let mokaSync = 'skipped_not_configured';
  if (isMokaOAuthConfigured()) {
    try {
      await pushScheduleToMoka(supabase, schedule.id);
      mokaSync = 'success';
    } catch (err) {
      mokaSync = 'failed';
      console.error(`[Bridge] Moka push failed for schedule ${schedule.id}:`, err.message);
    }
  }

  return { scheduleId: schedule.id, mokaSync };
}

function _formatPaymentNote(payment) {
  if (!payment) return null;
  const p = String(payment).toLowerCase();
  if (p.includes('tempat') || p === 'cash' || p === 'bayar_ditempat') return '💵 Bayar di tempat';
  if (p.includes('qr') || p.includes('online') || p.includes('transfer')) return '📱 Sudah bayar online';
  return null;
}

function _parseDurationMins(dur) {
  if (!dur) return 30;
  const s = String(dur).toLowerCase();
  if (s.includes('jam')) return Math.round((parseFloat(s) || 1) * 60);
  const m = parseInt(s, 10);
  return (Number.isFinite(m) && m > 0) ? m : 30;
}

module.exports = {
  pushScheduleToMoka,
  pushCheckoutToMoka,
  pullMokaToWeb,
  handleWebhookEvent,
  startCronJobs,
  bridgeBookingToMoka,
  maybeRefreshOutletData,
  getLastSyncAt,
};
