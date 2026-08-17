'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  notifyStockRequestSubmitted,
  notifyStockRequestReviewed,
  notifyStockRequestFulfilled,
  notifyTransferDiscrepancy,
  checkAndNotifyLowStock,
} = require('../services/stockistNotifications');

// `push_subscriptions` is kept empty for every user so sendPushToUser's
// early-return path is exercised (no real webpush.sendNotification call) —
// these tests only assert *who* gets targeted, not the wire payload.
function fakeSupabase({ users = [], alertState = [] } = {}) {
  const state = { users, pushQueries: [], alertState: structuredClone(alertState) };
  return {
    state,
    from(table) {
      if (table === 'users') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) { return Promise.resolve({ data: state.users.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); } };
        return query;
      }
      if (table === 'push_subscriptions') {
        const query = { _filters: [], select() { return query; }, eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          then(res, rej) {
            state.pushQueries.push(query._filters);
            return Promise.resolve({ data: [], error: null }).then(res, rej);
          } };
        return query;
      }
      if (table === 'stock_alert_state') {
        const query = {
          _filters: [], _upsert: null,
          select() { return query; },
          eq(c, v) { query._filters.push((r) => r[c] === v); return query; },
          upsert(row) { state.alertState = state.alertState.filter((r) => !(r.product_id === row.product_id && r.location_id === row.location_id)); state.alertState.push(row); return Promise.resolve({ data: [row], error: null }); },
          then(res, rej) { return Promise.resolve({ data: state.alertState.filter((r) => query._filters.every((f) => f(r))), error: null }).then(res, rej); },
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('notifyStockRequestSubmitted targets every owner user', async () => {
  const supabase = fakeSupabase({ users: [{ id: 'owner-1', role: 'owner' }, { id: 'owner-2', role: 'owner' }, { id: 'branch-1', role: 'branch_admin', branch: 'csb' }] });
  await notifyStockRequestSubmitted(supabase, { request: { id: 'req-1' }, branchName: 'Cabang CSB', itemCount: 3 });
  // One push_subscriptions lookup per targeted owner (2), not per all users (3).
  assert.equal(supabase.state.pushQueries.length, 2);
});

test('notifyStockRequestReviewed targets only the original requester', async () => {
  const supabase = fakeSupabase({ users: [{ id: 'owner-1', role: 'owner' }] });
  await notifyStockRequestReviewed(supabase, { request: { id: 'req-1', request_number: 'REQ-1', requested_by: 'branch-1', status: 'APPROVED' } });
  assert.equal(supabase.state.pushQueries.length, 1);
});

test('notifyStockRequestFulfilled and notifyTransferDiscrepancy target the right audience without throwing', async () => {
  const supabase = fakeSupabase({ users: [{ id: 'owner-1', role: 'owner' }] });
  await notifyStockRequestFulfilled(supabase, { request: { id: 'req-1', request_number: 'REQ-1', requested_by: 'branch-1', fulfilling_transfer_id: 'transfer-1' } });
  await notifyTransferDiscrepancy(supabase, { transfer: { id: 'transfer-1', transfer_number: 'TRF-1' } });
});

test('checkAndNotifyLowStock alerts branch_admin on a NORMAL -> LOW transition', async () => {
  const supabase = fakeSupabase({ users: [{ id: 'branch-1', role: 'branch_admin', branch: 'csb' }] });
  await checkAndNotifyLowStock(supabase, {
    productId: 'p1', locationId: 'loc-csb', branchSlug: 'csb', productName: 'Pomade', newQuantity: 2, minimumStock: 3,
  });
  assert.equal(supabase.state.alertState.length, 1);
  assert.equal(supabase.state.alertState[0].last_status, 'LOW');
  assert.ok(supabase.state.alertState[0].last_alerted_at);
  assert.equal(supabase.state.pushQueries.length, 1);
});

test('checkAndNotifyLowStock stays quiet on a second LOW movement within the cooldown window', async () => {
  const supabase = fakeSupabase({
    users: [{ id: 'branch-1', role: 'branch_admin', branch: 'csb' }],
    alertState: [{ product_id: 'p1', location_id: 'loc-csb', last_status: 'LOW', last_alerted_at: new Date().toISOString() }],
  });
  await checkAndNotifyLowStock(supabase, {
    productId: 'p1', locationId: 'loc-csb', branchSlug: 'csb', productName: 'Pomade', newQuantity: 1, minimumStock: 3,
  });
  assert.equal(supabase.state.pushQueries.length, 0);
});

test('checkAndNotifyLowStock re-alerts once the cooldown has elapsed', async () => {
  const staleAlert = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  const supabase = fakeSupabase({
    users: [{ id: 'branch-1', role: 'branch_admin', branch: 'csb' }],
    alertState: [{ product_id: 'p1', location_id: 'loc-csb', last_status: 'LOW', last_alerted_at: staleAlert }],
  });
  await checkAndNotifyLowStock(supabase, {
    productId: 'p1', locationId: 'loc-csb', branchSlug: 'csb', productName: 'Pomade', newQuantity: 1, minimumStock: 3,
  });
  assert.equal(supabase.state.pushQueries.length, 1);
});

test('checkAndNotifyLowStock resets to NORMAL and does not notify once stock recovers', async () => {
  const supabase = fakeSupabase({
    users: [{ id: 'branch-1', role: 'branch_admin', branch: 'csb' }],
    alertState: [{ product_id: 'p1', location_id: 'loc-csb', last_status: 'LOW', last_alerted_at: new Date().toISOString() }],
  });
  await checkAndNotifyLowStock(supabase, {
    productId: 'p1', locationId: 'loc-csb', branchSlug: 'csb', productName: 'Pomade', newQuantity: 10, minimumStock: 3,
  });
  assert.equal(supabase.state.pushQueries.length, 0);
  assert.equal(supabase.state.alertState.find((r) => r.product_id === 'p1').last_status, 'NORMAL');
});

test('checkAndNotifyLowStock alerts again after recovering to NORMAL and dipping low a second time', async () => {
  const supabase = fakeSupabase({
    users: [{ id: 'branch-1', role: 'branch_admin', branch: 'csb' }],
    alertState: [{ product_id: 'p1', location_id: 'loc-csb', last_status: 'NORMAL', last_alerted_at: null }],
  });
  await checkAndNotifyLowStock(supabase, {
    productId: 'p1', locationId: 'loc-csb', branchSlug: 'csb', productName: 'Pomade', newQuantity: 2, minimumStock: 3,
  });
  assert.equal(supabase.state.pushQueries.length, 1);
});
