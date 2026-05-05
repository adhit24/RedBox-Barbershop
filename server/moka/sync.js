'use strict';
// ============================================================
// MOKA POS  —  Bidirectional Sync Service
//
// FLOW A (web → Moka):  pushScheduleToMoka(supabase, scheduleId)
// FLOW B (Moka → web):  pullMokaToWeb(supabase, outletId)
// Cron:                 startCronJobs(supabase)  — every 5 min
// ============================================================

const MokaClient = require('./client');

// Simple in-process lock so concurrent cron ticks don't overlap
const _syncLock = new Set();

// Last-pulled timestamp per outlet to fetch only new/updated orders
const _lastSyncAt = new Map(); // outletId → ISO string

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
    if (sch.external_id)  { await _finishLog(supabase, logId, 'skipped', 'Already synced'); return; }

    // 2. Resolve Moka client for this outlet
    const client = await _getClient(supabase, sch.outlet_id, sch.outlet_moka_id);

    // 3. Upsert customer in Moka
    let mokaCustomerId = null;
    if (sch.customer_phone) {
      try {
        const mokaCustomer = await client.upsertCustomer({
          name:  sch.customer_name  || 'Guest',
          phone: sch.customer_phone,
          email: sch.customer_email || undefined,
        });
        mokaCustomerId = mokaCustomer?.data?.id || mokaCustomer?.id;

        // Persist Moka customer ID back onto our customer row
        if (mokaCustomerId && sch.customer_id) {
          await supabase.from('customers')
            .update({
              moka_customer_id: mokaCustomerId,
              phone_e164: sch.customer_phone || null,
            })
            .eq('id', sch.customer_id);
        }
      } catch (custErr) {
        console.warn('[Sync] Could not upsert Moka customer:', custErr.message);
        // Non-fatal — continue without Moka customer_id
      }
    }

    // 4. Create Moka order
    const orderPayload = _buildMokaOrderPayload(sch, mokaCustomerId);
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

    // Fetch orders updated since last sync (default: last 24 h on first run)
    const since = _lastSyncAt.get(outletId)
      || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const response  = await client.getOrders({ updatedSince: since, limit: 100 });
    const orders    = response?.data || response?.orders || [];

    for (const order of orders) {
      try {
        const result = await _processIncomingOrder(supabase, order, outletId);
        if (result === 'skipped') skipped++;
        else processed++;
      } catch (orderErr) {
        errors++;
        console.error(`[Sync] Error processing Moka order ${order.id}:`, orderErr.message);
        // Log per-order failure but continue with remaining orders
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
 * @returns {'skipped'|'processed'}
 */
async function _processIncomingOrder(supabase, order, outletId) {
  const mokaOrderId = String(order.id || order.order_id);

  // 1. Idempotency: skip if already imported
  const { data: exists } = await supabase
    .from('schedules')
    .select('id')
    .eq('external_id', mokaOrderId)
    .maybeSingle();

  if (exists) return 'skipped';

  // 2. Determine start time
  const orderTime = new Date(
    order.transaction_time || order.created_at || order.updated_at || Date.now()
  );

  // 3. Map order items → duration + amount
  const items = order.order_items || order.items || [];
  const { totalDuration, totalAmount, mappedItems } =
    await _mapOrderItems(supabase, items);

  const startTime = orderTime;
  const endTime   = new Date(orderTime.getTime() + totalDuration * 60 * 1000);

  // 4. Resolve or create customer
  const customerId = await _resolveCustomer(supabase, order.customer || order.buyer);

  // 5. Find available barber (conflict resolution: Option A — reassign)
  const { data: barberId } = await supabase.rpc('find_available_barber', {
    p_outlet_id: outletId,
    p_start:     startTime.toISOString(),
    p_end:       endTime.toISOString(),
  });
  // barberId may be null if all barbers are busy — schedule is still inserted
  // (shows as unassigned conflict for manual review)

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
      status:       'completed',
      source:       'moka',
      external_id:  mokaOrderId,
      notes:        barberId ? null : '⚠ No barber available at sync time — assign manually',
    })
    .select()
    .single();

  if (schErr) throw new Error(`Schedule insert failed: ${schErr.message}`);

  // 7. Insert transaction
  await _insertTransaction(supabase, {
    customerId,
    outletId,
    scheduleId:  schedule.id,
    externalId:  mokaOrderId,
    totalAmount,
    source:      'moka',
    mokaPayload: order,
    items:       mappedItems,
  });

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

  const { error } = await supabase
    .from('schedules')
    .update({ status: newStatus })
    .eq('id', scheduleId);   // application_order_id = our schedule UUID

  if (error) {
    console.error(`[Callback] Update schedule ${scheduleId} failed:`, error.message);
  } else {
    console.log(`[Callback] Schedule ${scheduleId}: Moka "${mokaStatus}" → local "${newStatus}"`);
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

  cron.schedule('*/5 * * * *', async () => {
    console.log('[Cron] Moka → Web sync starting…');
    try {
      // Only sync outlets that have a moka_outlet_id AND a stored token
      const { data: outletIds } = await supabase
        .from('outlets')
        .select('id')
        .eq('is_active', true)
        .not('moka_outlet_id', 'is', null);

      if (!outletIds?.length) return;

      const tokenCheck = await supabase
        .from('moka_tokens')
        .select('outlet_id')
        .in('outlet_id', outletIds.map(o => o.id));

      const authorizedIds = new Set((tokenCheck.data || []).map(r => r.outlet_id));

      for (const o of outletIds) {
        if (!authorizedIds.has(o.id)) continue;
        pullMokaToWeb(supabase, o.id).catch(err => {
          console.error(`[Cron] Outlet ${o.id} sync error:`, err.message);
        });
      }
    } catch (err) {
      console.error('[Cron] Fatal sync error:', err.message);
    }
  });

  console.log('[Cron] Moka sync scheduled every 5 minutes');
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
 * Spec: POST /v1/outlets/{outlet_id}/orders
 * Docs: https://api.mokapos.com/docs — "Advanced Orderings" section
 *
 * Moka requires per-order callback URLs so it can notify us when
 * the cashier accepts / completes / rejects the order.
 *
 * @param {object} schedule  - row from schedules_full view
 * @param {string|null} mokaCustomerId  - Moka's internal customer ID (optional)
 * @returns {object}
 */
function _buildMokaOrderPayload(schedule, mokaCustomerId) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

  const note = [
    `Online booking — ${schedule.outlet_name || 'RedBox'}`,
    schedule.barber_name ? `Barber: ${schedule.barber_name}` : null,
  ].filter(Boolean).join('. ');

  return {
    // ── Required fields ────────────────────────────────────────
    application_order_id: schedule.id,          // our UUID — returned in every callback
    payment_type:         'online_booking',      // register this payment type in Moka dashboard
    customer_name:        schedule.customer_name  || 'Guest',
    note:                 note.slice(0, 255),   // Moka max 255 chars

    // ── Optional customer info ──────────────────────────────────
    customer_id:           mokaCustomerId           || undefined,
    customer_phone_number: schedule.customer_phone  || undefined,
    client_created_at:     schedule.start_time,

    // ── Per-order callback URLs ─────────────────────────────────
    // Moka will POST { outlet_id, application_order_id, status } to these URLs
    accept_order_notification_url:   `${base}/api/moka/callback/accept`,
    complete_order_notification_url: `${base}/api/moka/callback/complete`,
    cancel_order_notification_url:   `${base}/api/moka/callback/cancel`,

    // ── Order items ─────────────────────────────────────────────
    // item_id and category_id must match real IDs in Moka's item library.
    // Store them in the services table as moka_item_id / moka_category_id.
    order_items: [{
      item_id:            schedule.moka_item_id      || 1,
      item_name:          schedule.service_name      || 'Service',
      quantity:           1,
      item_price_library: schedule.price             || 0,
      category_id:        schedule.moka_category_id  || 1,
      category_name:      schedule.moka_category_name || 'Services',
    }],
  };
}

async function _mapOrderItems(supabase, items) {
  let totalDuration = 0;
  let totalAmount   = 0;
  const mappedItems = [];

  for (const item of items) {
    const itemName  = item.name  || item.item_name  || 'Service';
    const itemPrice = item.price || item.unit_price || 0;
    const qty       = item.qty   || item.quantity   || 1;

    // Try to match by moka_item_id or name to get duration
    const { data: svc } = await supabase
      .from('services')
      .select('duration_minutes, price')
      .or(`moka_item_id.eq.${item.item_id || ''},name.ilike.${itemName}`)
      .maybeSingle();

    totalDuration += (svc?.duration_minutes || 30) * qty;
    totalAmount   += (itemPrice || svc?.price || 0) * qty;
    mappedItems.push({ name: itemName, price: itemPrice * qty, qty, moka_item_id: item.item_id });
  }

  if (!mappedItems.length) { totalDuration = 30; }  // fallback: 30 min

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

module.exports = {
  pushScheduleToMoka,
  pullMokaToWeb,
  handleWebhookEvent,
  startCronJobs,
};
