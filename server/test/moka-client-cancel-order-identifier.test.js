'use strict';

// P1: MokaClient.cancelOrder must use application_order_id (Redbox schedule UUID),
// not the numeric moka_order_id — Moka rejects the numeric ID with 400 ORDR-ORNF.
// See server/moka/client.js cancelOrder()/getOrder() doc comments for the
// production-verified contract this test locks in.

const assert = require('node:assert/strict');
const test = require('node:test');

const oauth = require('../moka/oauth');

function loadFreshMokaClient() {
  delete require.cache[require.resolve('../moka/client')];
  return require('../moka/client');
}

function withMockedToken(token, fn) {
  const original = oauth.getAccessToken;
  oauth.getAccessToken = async () => token;
  return fn().finally(() => { oauth.getAccessToken = original; });
}

const APPLICATION_ORDER_ID = '1bb98668-2588-476b-94f4-aa3aad859b41';
const NUMERIC_MOKA_ORDER_ID = '8787416';

test('cancelOrder: accepts the application_order_id UUID and requests the correct path', async () => {
  await withMockedToken('fake-token', async () => {
    const MokaClient = loadFreshMokaClient();
    let capturedUrl = null;
    let capturedBody = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ status: 'cancelled', status_code: 3 }),
      };
    };
    try {
      const client = new MokaClient({}, 'outlet-uuid', '1001');
      const result = await client.cancelOrder(APPLICATION_ORDER_ID, 'CUSTOMER#Cancelled by customer');
      assert.match(capturedUrl, /\/advanced_orderings\/orders\/1bb98668-2588-476b-94f4-aa3aad859b41\/cancel$/);
      assert.equal(capturedBody.cancel_reason, 'CUSTOMER#Cancelled by customer');
      assert.equal(result.status, 'cancelled');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('cancelOrder: rejects a numeric-only moka_order_id locally, before any HTTP request', async () => {
  await withMockedToken('fake-token', async () => {
    const MokaClient = loadFreshMokaClient();
    let fetchCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async () => { fetchCalled = true; throw new Error('should not be called'); };
    try {
      const client = new MokaClient({}, 'outlet-uuid', '1001');
      await assert.rejects(
        () => client.cancelOrder(NUMERIC_MOKA_ORDER_ID),
        /application_order_id UUID, not numeric moka_order_id/
      );
      assert.equal(fetchCalled, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('cancelOrder: rejects an empty application_order_id', async () => {
  const MokaClient = loadFreshMokaClient();
  const client = new MokaClient({}, 'outlet-uuid', '1001');
  await assert.rejects(() => client.cancelOrder(''), /application_order_id is required/);
  await assert.rejects(() => client.cancelOrder(null), /application_order_id is required/);
});

test('getOrder: rejects a numeric-only moka_order_id locally, before any HTTP request', async () => {
  await withMockedToken('fake-token', async () => {
    const MokaClient = loadFreshMokaClient();
    let fetchCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async () => { fetchCalled = true; throw new Error('should not be called'); };
    try {
      const client = new MokaClient({}, 'outlet-uuid', '1001');
      await assert.rejects(
        () => client.getOrder(NUMERIC_MOKA_ORDER_ID),
        /application_order_id UUID, not numeric moka_order_id/
      );
      assert.equal(fetchCalled, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
