// server/services/atomicBookingService.js
'use strict';

const { logDataAuthorityEvent } = require('../orchestrator/telemetry');

/**
 * Map PostgreSQL / Supabase RPC error to standard business error format.
 *
 * @param {any} error
 * @returns {{ success: false, ok: false, status: number, code: string, error: string, message: string, conflictIndex?: number }}
 */
function mapRpcError(error) {
  const message = error?.message || error?.error || String(error);
  const code = error?.code || '';

  // Slot conflict (Postgres exclusion violation 23P01 or explicit message/code)
  if (
    code === '23P01' ||
    code === 'BOOKING_SLOT_CONFLICT' ||
    message.includes('BOOKING_SLOT_CONFLICT') ||
    message.includes('no_barber_overlap') ||
    message.includes('conflicts with existing schedule')
  ) {
    return {
      success: false,
      ok: false,
      status: 409,
      code: 'BOOKING_SLOT_CONFLICT',
      error: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.',
      message: 'Kapster sudah memiliki jadwal pada rentang waktu tersebut.',
    };
  }

  // Idempotency conflict
  if (
    code === '23505' ||
    code === 'IDEMPOTENCY_KEY_REUSED' ||
    message.includes('IDEMPOTENCY_KEY_REUSED')
  ) {
    return {
      success: false,
      ok: false,
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
      error: 'Idempotency key has already been used with a different booking payload.',
      message: 'Idempotency key has already been used with a different booking payload.',
    };
  }

  // Not found
  if (code === 'P0002' || message.includes('BOOKING_NOT_FOUND')) {
    return {
      success: false,
      ok: false,
      status: 404,
      code: 'BOOKING_NOT_FOUND',
      error: 'Booking tidak ditemukan',
      message: 'Booking tidak ditemukan',
    };
  }

  // Already cancelled
  if (message.includes('BOOKING_ALREADY_CANCELLED')) {
    return {
      success: false,
      ok: false,
      status: 400,
      code: 'BOOKING_ALREADY_CANCELLED',
      error: 'Booking sudah dibatalkan sebelumnya',
      message: 'Booking sudah dibatalkan sebelumnya',
    };
  }

  // Group item conflict
  if (message.includes('GROUP_ITEM_') || message.includes('GROUP_BOOKING_ITEM_CONFLICT')) {
    const match = message.match(/GROUP_ITEM_(\d+)/);
    const conflictIndex = match ? parseInt(match[1], 10) - 1 : undefined;
    return {
      success: false,
      ok: false,
      status: 409,
      code: 'BOOKING_SLOT_CONFLICT',
      error: 'Salah satu jadwal kapster pada pemesanan grup bentrok atau tidak valid. Seluruh grup dibatalkan.',
      message: 'Salah satu jadwal kapster pada pemesanan grup bentrok atau tidak valid. Seluruh grup dibatalkan.',
      conflictIndex,
    };
  }

  console.error('[AtomicBookingService] DB error:', message);
  return {
    success: false,
    ok: false,
    status: 500,
    code: 'BOOKING_CREATE_FAILED',
    error: message || 'Gagal memproses booking',
    message: message || 'Gagal memproses booking',
  };
}

/**
 * Execute atomic booking creation in PostgreSQL.
 * Guarantees both bookings row and schedules row are created inside ONE database transaction.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @returns {Promise<{ success: boolean, ok: boolean, status: number, data?: any, booking?: any, scheduleId?: string, replayed?: boolean, code?: string, error?: string, message?: string }>}
 */
async function executeCreateBookingAtomic(supabase, params, options = {}) {
  if (!supabase) {
    return { success: false, ok: false, status: 500, code: 'DB_UNAVAILABLE', error: 'Database client not available', message: 'Database client not available' };
  }

  const isProd = options.env ? options.env === 'production' : (process.env.NODE_ENV === 'production');

  if (typeof supabase.rpc !== 'function') {
    if (isProd) {
      return {
        success: false,
        ok: false,
        status: 500,
        code: 'RPC_UNAVAILABLE',
        error: 'Database atomic RPC create_booking_atomic is not available in database client',
        message: 'Database atomic RPC is not available',
      };
    }
    const bookingId = params.bookingId || params.booking_id || require('crypto').randomUUID();
    const { data, error } = await supabase.from('bookings').insert([{
      id: bookingId,
      name: params.name,
      wa: params.wa,
      service_id: params.service_id || '',
      service: params.service,
      price: Number(params.price) || 0,
      duration: params.duration || '30',
      barber_id: params.barber_id || null,
      date: params.date,
      time: params.time,
      location: params.location || 'bypass',
      status: params.status || 'confirmed',
      notes: params.notes || '',
      payment: params.payment || '',
      type: params.type || 'outlet',
      original_price: params.original_price !== undefined ? params.original_price : null,
      discount_label: params.discount_label || null,
      booking_request_id: params.bookingRequestId || params.booking_request_id || null,
    }]).select().single();
    if (error) return mapRpcError(error);
    const row = data || { id: bookingId, ...params };
    return {
      success: true,
      ok: true,
      status: 201,
      replayed: false,
      data: row,
      booking: row,
      bookingId: row.id,
      scheduleId: 'mock-schedule-id',
    };
  }

  const rpcPayload = {
    p_booking_id: params.bookingId || params.booking_id || null,
    p_booking_request_id: params.bookingRequestId || params.booking_request_id || null,
    p_group_request_id: params.groupRequestId || params.group_request_id || null,
    p_name: params.name,
    p_wa: params.wa,
    p_service_id: params.service_id || '',
    p_service: params.service,
    p_price: Number(params.price) || 0,
    p_duration: params.duration || '30',
    p_barber_id: params.barber_id || null,
    p_date: params.date,
    p_time: params.time,
    p_location: params.location || 'bypass',
    p_status: params.status || 'confirmed',
    p_notes: params.notes || '',
    p_payment: params.payment || '',
    p_type: params.type || 'outlet',
    p_original_price: params.original_price !== undefined ? params.original_price : null,
    p_discount_label: params.discount_label || null,
  };

  try {
    const { data, error } = await supabase.rpc('create_booking_atomic', rpcPayload);

    if (error) {
      return mapRpcError(error);
    }

    if (!data || !data.success) {
      if (data?.code || data?.error) {
        return mapRpcError(data);
      }
      return { success: false, ok: false, status: 500, code: 'BOOKING_CREATE_FAILED', error: 'Gagal membuat booking secara atomik', message: 'Gagal membuat booking secara atomik' };
    }

    const booking = data.booking || null;
    const scheduleId = data.schedule_id || booking?.schedule_id || null;

    return {
      success: true,
      ok: true,
      status: data.replayed ? 200 : 201,
      replayed: Boolean(data.replayed),
      data: booking,
      booking: booking,
      bookingId: data.booking_id || booking?.id,
      scheduleId: scheduleId,
    };
  } catch (err) {
    return mapRpcError(err);
  }
}

/**
 * Execute atomic group booking creation in PostgreSQL.
 * All items succeed or all items roll back.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|object} arg1 - UUID or options object { group_request_id, items }
 * @param {Array<object>} [arg2] - Array of booking payloads
 * @returns {Promise<{ success: boolean, ok: boolean, status: number, group_request_id?: string, items?: any[], bookings?: any[], scheduleIds?: string[], replayed?: boolean, code?: string, error?: string, message?: string, conflictIndex?: number }>}
 */
async function executeCreateGroupBookingAtomic(supabase, arg1, arg2, options = {}) {
  if (!supabase) {
    return { success: false, ok: false, status: 500, code: 'DB_UNAVAILABLE', error: 'Database client not available', message: 'Database client not available' };
  }

  let groupRequestId, items;
  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
    groupRequestId = arg1.group_request_id || arg1.groupRequestId;
    items = arg1.items;
  } else {
    groupRequestId = arg1;
    items = arg2;
  }

  if (!groupRequestId) {
    return { success: false, ok: false, status: 400, code: 'GROUP_REQUEST_ID_REQUIRED', error: 'group_request_id wajib diisi', message: 'group_request_id wajib diisi' };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, ok: false, status: 400, code: 'GROUP_ITEMS_REQUIRED', error: 'items booking wajib diisi', message: 'items booking wajib diisi' };
  }

  const isProd = options.env ? options.env === 'production' : (process.env.NODE_ENV === 'production');

  if (typeof supabase.rpc !== 'function') {
    if (isProd) {
      return {
        success: false,
        ok: false,
        status: 500,
        code: 'RPC_UNAVAILABLE',
        error: 'Database atomic RPC create_group_booking_atomic is not available in database client',
        message: 'Database atomic RPC is not available',
      };
    }
  }

  try {
    const { data, error } = await supabase.rpc('create_group_booking_atomic', {
      p_group_request_id: groupRequestId,
      p_items: items,
    });

    if (error) {
      return mapRpcError(error);
    }

    if (!data || !data.success) {
      if (data?.code || data?.error) {
        return {
          ...mapRpcError(data),
          conflictIndex: data.conflict_index !== undefined ? data.conflict_index : undefined,
        };
      }
      return { success: false, ok: false, status: 500, code: 'GROUP_BOOKING_FAILED', error: 'Gagal membuat group booking', message: 'Gagal membuat group booking' };
    }

    const bookings = data.items || data.bookings || [];
    const scheduleIds = data.schedule_ids || bookings.map(b => b.schedule_id).filter(Boolean);

    return {
      success: true,
      ok: true,
      status: data.replayed ? 200 : 201,
      replayed: Boolean(data.replayed),
      group_request_id: data.group_request_id || groupRequestId,
      groupRequestId: data.group_request_id || groupRequestId,
      items: bookings,
      bookings: bookings,
      scheduleIds: scheduleIds,
    };
  } catch (err) {
    return mapRpcError(err);
  }
}

/**
 * Execute atomic reschedule in PostgreSQL.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} params
 * @param {object} [options]
 * @returns {Promise<{ success: boolean, ok: boolean, status: number, data?: any, booking?: any, code?: string, error?: string, message?: string }>}
 */
async function executeRescheduleBookingAtomic(supabase, params, options = {}) {
  if (!supabase) {
    return { success: false, ok: false, status: 500, code: 'DB_UNAVAILABLE', error: 'Database client not available', message: 'Database client not available' };
  }

  const bookingId = params.bookingId || params.booking_id;
  const newDate = params.date || params.new_date;
  const newTime = params.time || params.new_time;
  const newBarberId = params.barber_id || params.barberId || params.new_barber_id || null;
  const newLocation = params.location || params.new_location || null;
  const newDuration = params.duration || params.new_duration || null;

  const isProd = options.env ? options.env === 'production' : (process.env.NODE_ENV === 'production');

  if (typeof supabase.rpc !== 'function') {
    if (isProd) {
      return {
        success: false,
        ok: false,
        status: 500,
        code: 'RPC_UNAVAILABLE',
        error: 'Database atomic RPC reschedule_booking_atomic is not available in database client',
        message: 'Database atomic RPC is not available',
      };
    }
    const updates = {
      date: newDate,
      time: newTime,
    };
    if (newBarberId) updates.barber_id = newBarberId;
    if (newLocation) updates.location = newLocation;
    const { data, error } = await supabase.from('bookings').update(updates).eq('id', bookingId).select().single();
    if (error) return mapRpcError(error);
    const booking = data || { id: bookingId, ...updates };
    return {
      success: true,
      ok: true,
      status: 200,
      data: booking,
      booking: booking,
      bookingId: bookingId,
      scheduleId: 'mock-schedule-id',
    };
  }

  try {
    const { data, error } = await supabase.rpc('reschedule_booking_atomic', {
      p_booking_id: bookingId,
      p_new_date: newDate,
      p_new_time: newTime,
      p_new_barber_id: newBarberId,
      p_new_location: newLocation,
      p_new_duration: newDuration,
    });

    if (error) {
      return mapRpcError(error);
    }

    if (!data || !data.success) {
      if (data?.code || data?.error) {
        return mapRpcError(data);
      }
      return { success: false, ok: false, status: 500, code: 'RESCHEDULE_FAILED', error: 'Gagal melakukan reschedule', message: 'Gagal melakukan reschedule' };
    }

    const booking = data?.booking || { id: bookingId, date: newDate, time: newTime, barber_id: newBarberId, location: newLocation };

    return {
      success: true,
      ok: true,
      status: 200,
      data: booking,
      booking: booking,
      bookingId: data?.booking_id || bookingId,
      scheduleId: data?.schedule_id,
    };
  } catch (err) {
    return mapRpcError(err);
  }
}

/**
 * Execute atomic cancel in PostgreSQL.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} bookingId
 * @param {string} [reason]
 * @param {object} [options]
 * @returns {Promise<{ success: boolean, ok: boolean, status: number, data?: any, booking?: any, alreadyCancelled?: boolean, code?: string, error?: string, message?: string }>}
 */
async function executeCancelBookingAtomic(supabase, bookingId, reason = '', options = {}) {
  if (!supabase) {
    return { success: false, ok: false, status: 500, code: 'DB_UNAVAILABLE', error: 'Database client not available', message: 'Database client not available' };
  }

  const isProd = options.env ? options.env === 'production' : (process.env.NODE_ENV === 'production');

  if (typeof supabase.rpc !== 'function') {
    if (isProd) {
      return {
        success: false,
        ok: false,
        status: 500,
        code: 'RPC_UNAVAILABLE',
        error: 'Database atomic RPC cancel_booking_atomic is not available in database client',
        message: 'Database atomic RPC is not available',
      };
    }
    const { data, error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId).select().single();
    if (error) return mapRpcError(error);
    const booking = data || { id: bookingId, status: 'cancelled' };
    return {
      success: true,
      ok: true,
      status: 200,
      alreadyCancelled: false,
      data: booking,
      booking: booking,
      bookingId: bookingId,
      scheduleId: 'mock-schedule-id',
    };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_booking_atomic', {
      p_booking_id: bookingId,
      p_reason: reason || '',
    });

    if (error) {
      return mapRpcError(error);
    }

    if (!data || !data.success) {
      if (data?.code || data?.error) {
        return mapRpcError(data);
      }
      return { success: false, ok: false, status: 500, code: 'CANCEL_FAILED', error: 'Gagal membatalkan booking', message: 'Gagal membatalkan booking' };
    }

    const booking = data?.booking || { id: bookingId, status: 'cancelled' };

    return {
      success: true,
      ok: true,
      status: 200,
      alreadyCancelled: Boolean(data?.already_cancelled),
      data: booking,
      booking: booking,
      bookingId: data?.booking_id || bookingId,
      scheduleId: data?.schedule_id,
    };
  } catch (err) {
    return mapRpcError(err);
  }
}

module.exports = {
  executeCreateBookingAtomic,
  executeCreateGroupBookingAtomic,
  executeRescheduleBookingAtomic,
  executeCancelBookingAtomic,
  mapRpcError,
};
