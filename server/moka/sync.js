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
    // Fetch outlet's Moka outlet_id
    const { data: outlet } = await supabase
      .from('outlets')
      .select('id, moka_outlet_id')
      .eq('id', outletId)
      .single();

    if (!outlet?.moka_outlet_id) {
      await _finishLog(supabase, logId, 'skipped', 'No moka_outlet_id configured');
      return { processed: 0, skipped: 0, errors: 0 };
    }

    const client = await _getClient(supabase, outletId, outlet.moka_outlet_id);

    // ── Pull 1: Completed transactions via Report API ──────────────────────
    // Membawa walk-in yang sudah selesai + dibayar → menjadi schedule 'completed'
    const since = _lastSyncAt.get(outletId)
      || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const response  = await client.getOrders({ updatedSince: since, limit: 100 });
    // BUG FIX: v3 response shape is { data: { payments: [], next_url, completed } }
    // response.data is an object, not an array — must access data.payments
    const rawOrders = response?.data?.payments || [];
    const orders    = Array.isArray(rawOrders) ? rawOrders : [];

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
        });
      }
    }

    // Pull 2 REMOVED: GET /v1/advanced_orderings/orders does not exist in Moka API spec.
    // Walk-in pending slots are covered by Pull 3 (sync_bills) below.

    // ── Pull 3: Open (PENDING) walk-in bills from sync_bills ────────────────
    // GoShow customer yang langsung dilayani kasir (bukan via Advanced Ordering).
    // Slot harus terblokir di website segera, sebelum transaksi selesai.
    try {
      const todayStr  = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      const billsRes  = await client.getOpenBills(todayStr);
      const openBills = billsRes?.data || [];
      if (Array.isArray(openBills)) {
        for (const bill of openBills) {
          try {
            const result = await _processOpenBill(supabase, bill, outletId);
            if (result === 'skipped') skipped++;
            else processed++;
          } catch (bErr) {
            console.warn(`[Sync] Open bill ${bill.id}:`, bErr.message);
          }
        }
      }
    } catch (billsErr) {
      console.warn(`[Sync] getOpenBills skipped (${billsErr.message})`);
    }

    // ── Pull 3: Open (PENDING) walk-in bills from sync_bills ────────────────
    // GoShow customer yang langsung dilayani kasir (bukan via Advanced Ordering).
    // Slot harus terblokir di website segera, sebelum transaksi selesai.
    try {
      const todayStr  = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      const billsRes  = await client.getOpenBills(todayStr);
      const openBills = billsRes?.data || [];
      if (Array.isArray(openBills)) {
        for (const bill of openBills) {
          try {
            const result = await _processOpenBill(supabase, bill, outletId);
            if (result === 'skipped') skipped++;
            else processed++;
          } catch (bErr) {
            console.warn(`[Sync] Open bill ${bill.id}:`, bErr.message);
          }
        }
      }
    } catch (billsErr) {
      console.warn(`[Sync] getOpenBills skipped (${billsErr.message})`);
    }

    _lastSyncAt.set(outletId, new Date().toISOString());
    await _finishLog(supabase, logId, 'success', null, { processed, skipped, errors });

  } catch (err) {
    await _finishLog(supabase, logId, 'failed', err.message);
    throw err;
  } finally {
    _syncLock.delete(outletId);
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
  const orderTime = new Date(
    order.transaction_time || order.created_at || order.updated_at || Date.now()
  );

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
 * Process a single PENDING walk-in bill from sync_bills API.
 * Creates a 'reserved' schedule to block the slot on the website.
 * When the bill is later COMPLETED, _processIncomingOrder (Pull 1) will update it.
 */
async function _processOpenBill(supabase, bill, outletId) {
  const billId     = String(bill.id);
  const billName   = bill.name || '';
  const billStatus = (bill.status || '').toUpperCase();

  // Only process PENDING bills
  if (billStatus !== 'PENDING') return 'skipped';

  // ── Resolve barber + service FIRST (needed for both insert and update paths) ─
  const items = bill.billDetail?.items || bill.checkouts || bill.items || [];
  let barberId    = null;
  let durationMin = 30;
  let serviceName = billName;
  let totalPrice  = bill.totalPrice || bill.total || 0;

  for (const item of items) {
    const mokaItemId = String(item.id || item.item_id || '');
    if (!mokaItemId) continue;

    const { data: barber } = await supabase
      .from('barbers').select('id')
      .eq('moka_employee_id', mokaItemId)
      .eq('outlet_id', outletId)
      .maybeSingle();

    if (barber) {
      barberId = barber.id;
      const variantName = item.item_variants?.name || item.variant_name || null;
      if (variantName) serviceName = variantName;
      if (!totalPrice && item.item_variants?.price) totalPrice = item.item_variants.price;
      break;
    }
  }

  if (!barberId) {
    const nonBarberNames = items.map(i => i.item_variants?.name || i.name || i.item_name).filter(Boolean);
    if (nonBarberNames.length) serviceName = nonBarberNames.join(' + ');
  }

  // Resolve service duration
  if (serviceName && serviceName !== billName) {
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

  // ── Idempotency: check for existing schedule ──────────────
  const { data: existing } = await supabase
    .from('schedules').select('id, barber_id, service_name').eq('external_id', billId).maybeSingle();

  if (existing) {
    // If barber was missing before but we resolved it now — patch it
    if (!existing.barber_id && barberId) {
      const patch = { barber_id: barberId, notes: null };
      if (existing.service_name === billName && serviceName !== billName) {
        patch.service_name = serviceName;
      }
      await supabase.from('schedules').update(patch).eq('id', existing.id);
      return 'updated';
    }
    return 'skipped';
  }

  // ── Insert new schedule ───────────────────────────────────
  const startTime = new Date(bill.createdAt || bill.created_at || Date.now());
  const endTime   = new Date(startTime.getTime() + durationMin * 60_000);

  const customerId = await _resolveCustomer(supabase, {
    name:  bill.customer_name || billName || null,
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

  // Cron 3: Schema sync harian jam 03:00 WIB (20:00 UTC)
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

  console.log(`[Cron] Moka jobs scheduled: pull ${MOKA_PULL_INTERVAL_MINUTES}min, retry ${MOKA_RETRY_INTERVAL_MINUTES}min, schema sync 03:00 WIB`);
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
    // BUG FIX: Moka v1/items returns { data: { item: [...], total_pages, total_count } }
    // Key is 'item' (singular), NOT 'items'
    const items = res?.data?.item || [];
    _mokaItemsCache.set(outletId, { ts: Date.now(), items });
    return Array.isArray(items) ? items : [];
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
      status:       'reserved',
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
  pullMokaToWeb,
  handleWebhookEvent,
  startCronJobs,
  bridgeBookingToMoka,
  maybeRefreshOutletData,
  getLastSyncAt,
};
