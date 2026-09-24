'use strict';
// Post-commit notifications for CONFIRMED bookings (single or multi-person).
//
// Three distinct notification types, never sharing one destination variable:
//   booking_customer_confirmation  -> customer (main contact)         role: customer
//   booking_barber_assignment      -> barbers.phone of assigned barber role: barber
//   booking_admin_notice           -> branch/owner admin              role: branch_admin
//
// Every delivery is independent (Promise.allSettled): one failure never stops another.
// A barber notice is NEVER redirected to the admin number; a missing/invalid barber
// phone is recorded as `skipped` with an explicit reason.
//
// Idempotency reuses booking_notification_outbox (UNIQUE booking_id+kind) as a claim
// ledger; a second call for the same booking/kind is `duplicate` and sends nothing.
// A previous `failed` row (nothing was delivered) may be reclaimed and retried.

const wa = require('./waNotification');
const { logSystemEvent } = require('./systemEventLog');

const OUTBOX_TABLE = 'booking_notification_outbox';
const KIND = {
  groupCustomer: 'booking_group_customer_confirmation',
  barber: 'booking_barber_assignment',
  groupAdmin: 'booking_group_admin_notice',
};

/** 08xxx / 628xxx / +628xxx / 8xxx -> 628xxx, or null when not a valid Indonesian mobile. */
function normalizeBarberPhone(raw) {
  let n = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return /^62[1-9]\d{7,12}$/.test(n) ? n : null;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `***${d.slice(-4)}` : null;
}

async function resolveBarbers(supabase, bookings) {
  const ids = [...new Set(bookings.map(b => b.barber_id).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return { map, error: null };
  try {
    const { data, error } = await supabase.from('barbers').select('id, name, phone, is_active').in('id', ids);
    if (error) return { map, error: error.message || String(error) };
    for (const row of data || []) map.set(row.id, row);
    return { map, error: null };
  } catch (e) {
    return { map, error: e.message };
  }
}

// Returns { claimed:true } | { claimed:false, reason:'duplicate' } | { claimed:true, ledger:false }
const DEGRADED = { claimed: true, ledger: false, degraded: true, warning: 'notification_outbox_unavailable' };

async function claim(supabase, bookingId, kind, meta) {
  if (!supabase || !bookingId) return DEGRADED;
  try {
    const { error } = await supabase.from(OUTBOX_TABLE).insert({
      booking_id: bookingId, kind, payload: meta, status: 'processing', attempts: 1,
      locked_at: new Date().toISOString(),
    });
    if (!error) return { claimed: true, ledger: true };
    if (error.code !== '23505') return DEGRADED; // ledger down: fail open (still send), flagged degraded
    const { data: reclaimed } = await supabase.from(OUTBOX_TABLE)
      .update({ status: 'processing', locked_at: new Date().toISOString(), last_error: null, payload: meta })
      .eq('booking_id', bookingId).eq('kind', kind).eq('status', 'failed')
      .select('id').maybeSingle();
    return reclaimed ? { claimed: true, ledger: true } : { claimed: false, reason: 'duplicate' };
  } catch (_) {
    return DEGRADED;
  }
}

async function settle(supabase, bookingId, kind, status, reason, providerResponse) {
  if (!supabase || !bookingId) return;
  try {
    await supabase.from(OUTBOX_TABLE).update({
      status: status === 'sent' ? 'sent' : 'failed',
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      last_error: reason || null,
      provider_response: providerResponse || null,
    }).eq('booking_id', bookingId).eq('kind', kind);
  } catch (_) { /* telemetry must not fail the delivery */ }
}

async function runDelivery(d, ctx) {
  const record = {
    notification_type: d.type, recipient_role: d.role, booking_id: d.bookingId,
    barber_id: d.barberId || null, recipient: d.recipientMasked || null,
    branch: ctx.branch, provider: 'fonnte', device: ctx.branch,
    attempted_at: new Date().toISOString(), status: 'failed', reason: null,
    requested_branch: ctx.branch, actual_device: ctx.branch, failover: false,
    idempotency_mode: 'normal', warning: null,
    recipient_scope: d.role === 'branch_admin' ? 'global_admin' : undefined,
  };
  const noteClaim = (c) => { if (c && c.degraded) { record.idempotency_mode = 'degraded'; record.warning = c.warning; } };
  try {
    if (d.skipReason) {
      record.status = 'skipped'; record.reason = d.skipReason;
      if (d.kind) {
        const c = await claim(ctx.supabase, d.bookingId, d.kind, { ...meta(d, ctx), outcome: 'skipped' });
        noteClaim(c);
        if (c.claimed) await settle(ctx.supabase, d.bookingId, d.kind, 'failed', `skipped: ${d.skipReason}`);
      }
      return record;
    }
    if (d.kind) {
      const c = await claim(ctx.supabase, d.bookingId, d.kind, meta(d, ctx));
      noteClaim(c);
      if (!c.claimed) { record.status = 'duplicate'; record.reason = c.reason; return record; }
    }
    let resp;
    try {
      resp = await d.send();
      if (!resp) throw new Error('Fonnte token missing or send skipped');
      if (resp.status === false) throw new Error(resp.reason || resp.error || resp.message || 'Fonnte rejected message');
    } catch (err) {
      record.status = 'failed'; record.reason = String(err.message || err).slice(0, 300);
      if (d.kind) await settle(ctx.supabase, d.bookingId, d.kind, 'failed', record.reason);
      return record;
    }
    record.status = 'sent';
    if (resp.actual_device) record.actual_device = resp.actual_device;
    if (resp.failover) { record.failover = true; record.warning = record.warning || `device_failover: ${resp.failover_reason || 'branch device unavailable'}`; }
    if (d.kind) await settle(ctx.supabase, d.bookingId, d.kind, 'sent', null, resp);
    return record;
  } catch (err) {
    record.status = 'failed'; record.reason = String(err.message || err).slice(0, 300);
    return record;
  }
}

function meta(d, ctx) {
  return {
    notification_type: d.type, recipient_role: d.role, barber_id: d.barberId || null,
    recipient: d.recipientMasked || null, branch: ctx.branch, group_id: ctx.groupId || null,
    correlation_id: ctx.correlationId || null,
  };
}

/**
 * @param {object} p
 * @param {object} p.supabase
 * @param {Array}  p.bookings        confirmed bookings (>=1). >1 => group (consolidated customer msg).
 * @param {string} [p.groupId]
 * @param {string} [p.correlationId]
 * @param {boolean} [p.includeAdmin] group only; single bookings keep their existing admin alert path.
 * @param {object} [p.deps]          { sendCustomerSingle(booking, barberName), logEvent }
 * @returns {Promise<{deliveries: Array}>}
 */
async function dispatchBookingNotifications({
  supabase, bookings, groupId = null, correlationId = null, includeAdmin = false, deps = {},
}) {
  const list = (bookings || []).filter(Boolean);
  if (!list.length) return { deliveries: [] };
  const logEvent = deps.logEvent || logSystemEvent;
  const first = list[0];
  const isGroup = list.length > 1;
  const ctx = { supabase, branch: String(first.location || '').toLowerCase(), groupId, correlationId };

  const { map: barberMap, error: lookupError } = await resolveBarbers(supabase, list);
  const barberName = (b) => barberMap.get(b.barber_id)?.name || null;

  const deliveries = [];

  // ── customer (main contact) ────────────────────────────────
  if (first.wa) {
    if (isGroup) {
      deliveries.push({
        type: 'booking_customer_confirmation', role: 'customer', bookingId: first.id,
        kind: KIND.groupCustomer, recipientMasked: maskPhone(first.wa),
        send: () => wa.notifyCustomerGroupBookingConfirmed({
          wa: first.wa, contactName: first.name, location: first.location, date: first.date,
          members: list.map(b => ({
            name: b.name, service: b.service, time: String(b.time).slice(0, 5), date: b.date,
            duration: b.duration, barber_name: barberName(b),
          })),
        }),
      });
    } else if (deps.sendCustomerSingle) {
      // Single booking keeps its existing outbox-backed customer path.
      deliveries.push({
        type: 'booking_customer_confirmation', role: 'customer', bookingId: first.id,
        recipientMasked: maskPhone(first.wa),
        send: async () => {
          const r = await deps.sendCustomerSingle(first, barberName(first));
          if (r && r.sent === false) throw new Error(r.queued ? 'send failed; queued for retry' : 'send failed');
          return (r && r.providerResponse) || r || { status: true };
        },
      });
    }
  }

  // ── barbers (one delivery per booking; to barbers.phone only) ──
  for (const b of list) {
    const d = {
      type: 'booking_barber_assignment', role: 'barber', bookingId: b.id, barberId: b.barber_id || null,
      kind: KIND.barber,
    };
    const barber = b.barber_id ? barberMap.get(b.barber_id) : null;
    const phone = barber ? normalizeBarberPhone(barber.phone) : null;
    d.recipientMasked = maskPhone(phone || barber?.phone);
    if (!b.barber_id) d.skipReason = 'no_barber_assigned';
    else if (lookupError) d.skipReason = `barber_lookup_failed: ${lookupError}`;
    else if (!barber) d.skipReason = 'barber_not_found';
    else if (barber.is_active === false) d.skipReason = 'barber_inactive';
    else if (!String(barber.phone || '').trim()) d.skipReason = 'barber_phone_missing';
    else if (!phone) d.skipReason = 'barber_phone_invalid';
    else {
      d.send = () => wa.notifyBarberBookingAssignment({
        barberPhone: phone, customerName: b.name, service: b.service,
        time: String(b.time).slice(0, 5), date: b.date, duration: b.duration, location: b.location,
      });
    }
    deliveries.push(d);
  }

  // ── branch admin (group only; separate, never a substitute) ──
  if (includeAdmin && isGroup) {
    deliveries.push({
      type: 'booking_admin_notice', role: 'branch_admin', bookingId: first.id, kind: KIND.groupAdmin,
      send: () => wa.notifyAdminGroupBooking({
        contactName: first.name, wa: first.wa, location: first.location,
        members: list.map(b => ({
          name: b.name, service: b.service, time: String(b.time).slice(0, 5), date: b.date,
          barber_name: barberName(b), barber_id: b.barber_id,
        })),
      }),
    });
  }

  const settled = await Promise.allSettled(deliveries.map(d => runDelivery(d, ctx)));
  const records = settled.map((s, i) => s.status === 'fulfilled' ? s.value : {
    notification_type: deliveries[i].type, recipient_role: deliveries[i].role,
    booking_id: deliveries[i].bookingId, status: 'failed', reason: String(s.reason?.message || s.reason),
  });

  await Promise.allSettled(records.map(r => logEvent({
    module: 'booking',
    eventName: `booking_notification_${r.status}`,
    severity: (r.status === 'failed' || r.failover || r.idempotency_mode === 'degraded') ? 'WARNING' : 'INFO',
    status: r.status === 'sent' ? 'success' : (r.status === 'failed' ? 'failed' : 'skipped'),
    correlationId, bookingId: r.booking_id, barberId: r.barber_id || undefined,
    outletId: ctx.branch || undefined, entityType: 'booking', entityId: r.booking_id,
    errorMessage: r.reason || undefined,
    metadata: {
      notification_type: r.notification_type, recipient_role: r.recipient_role, recipient: r.recipient,
      group_id: groupId, provider: 'fonnte', device: ctx.branch, attempted_at: r.attempted_at,
      requested_branch: r.requested_branch, actual_device: r.actual_device, failover: r.failover,
      idempotency_mode: r.idempotency_mode, warning: r.warning, recipient_scope: r.recipient_scope,
      delivery_status: r.status, // sent = accepted by Fonnte, not proof of handset delivery
    },
  }, { supabase })));

  return { deliveries: records };
}

const LOCATION_LABEL = {
  bypass: 'RedBox Bypass', samadikun: 'RedBox Samadikun', csb: 'RedBox CSB Mall',
  sumber: 'RedBox Sumber', tegal: 'RedBox Tegal',
};

/**
 * Single-booking barber assignment for callers outside the create flow
 * (resend-notif, pending -> confirmed, manual notify). Same rules as the
 * orchestrator: barbers.phone only, booking branch device only, never Bypass.
 * Returns { skipped, reason } when there is nobody to notify; throws on send failure
 * (e.g. `branch_token_missing: ...`).
 */
async function notifyBarberOutletBooking(supabase, booking, deps = {}) {
  if (!booking || !booking.barber_id) return { skipped: true, reason: 'no_barber_assigned' };
  const { data: barber } = await supabase
    .from('barbers').select('name, phone').eq('id', booking.barber_id).single();
  if (!barber) return { skipped: true, reason: 'barber_not_found' };
  if (!String(barber.phone || '').trim()) return { skipped: true, reason: 'barber_phone_missing' };
  const phone = normalizeBarberPhone(barber.phone);
  if (!phone) return { skipped: true, reason: 'barber_phone_invalid' };
  const { formatBookingDateTimeWIB } = deps;
  const dt = formatBookingDateTimeWIB
    ? formatBookingDateTimeWIB(booking.date, booking.time)
    : { dateStr: booking.date, timeStr: String(booking.time).slice(0, 5) };
  const result = await wa.notifyBarberNewOutletBooking({
    barberPhone: phone,
    barberName: barber.name,
    customerName: booking.name || booking.customer_name || 'Pelanggan',
    dateStr: dt.dateStr, timeStr: dt.timeStr,
    location: LOCATION_LABEL[booking.location] || 'RedBox Barbershop',
    serviceLabel: booking.service,
    price: booking.price ? `Rp ${booking.price.toLocaleString('id-ID')}` : '-',
    branch: booking.location,
  });
  if (!result) throw new Error('Outlet barber notification failed: Fonnte token missing or send skipped');
  if (result.status === false) {
    throw new Error(`Outlet barber notification failed: ${result.reason || result.error || result.message || JSON.stringify(result)}`);
  }
  return result;
}

module.exports = { dispatchBookingNotifications, notifyBarberOutletBooking, normalizeBarberPhone, KIND };
