'use strict';

const { createClient } = require('@supabase/supabase-js');

const STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  DONE: 'DONE',
  AMBIGUOUS: 'AMBIGUOUS',
});

let client;

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith('0')) variants.add(`62${digits.slice(1)}`);
  if (digits.startsWith('62')) variants.add(`0${digits.slice(2)}`);
  return [...variants];
};

const normalizeBranch = (branch) => {
  const value = String(branch || '').trim().toLowerCase();
  if (value.includes('csb')) return 'csb';
  if (value.includes('bypass')) return 'bypass';
  if (value.includes('samadikun')) return 'samadikun';
  if (value.includes('sumber')) return 'sumber';
  if (value.includes('tegal')) return 'tegal';
  return value;
};

const getClient = () => {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
};

const getCustomerBookingStatus = async (phone, branch, context = {}) => {
  const sb = getClient();
  const phones = normalizePhone(phone);
  if (!sb || phones.length === 0) {
    return { status: STATUS.AMBIGUOUS, bookings: [], reason: 'database_unavailable' };
  }

  let query = sb
    .from('bookings')
    .select('id,name,wa,service,date,time,location,status,barber_id,updated_at,created_at')
    .in('wa', phones)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(context.limit || 10);

  const branchSlug = normalizeBranch(branch);
  if (branchSlug) query = query.eq('location', branchSlug);
  if (context.statuses?.length) query = query.in('status', context.statuses);

  const { data, error } = await query;
  if (error) return { status: STATUS.AMBIGUOUS, bookings: [], reason: 'database_error' };

  const bookings = data || [];
  if (!bookings.length) return { status: STATUS.NOT_FOUND, bookings };

  const priority = ['confirmed', 'pending', 'done', 'cancelled'];
  const selected = priority.map((value) => bookings.find((booking) => booking.status === value)).find(Boolean);
  const status = selected?.status === 'confirmed' ? STATUS.CONFIRMED
    : selected?.status === 'pending' ? STATUS.PENDING
      : selected?.status === 'done' ? STATUS.DONE
        : STATUS.CANCELLED;

  return { status, booking: selected, bookings };
};

module.exports = { STATUS, normalizePhone, normalizeBranch, getCustomerBookingStatus };
