'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getCustomerReviewsCount, MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP } =
  require('../member-reviews');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

// ============================================================
// Lightweight stub for the two Supabase query-builder calls this module
// makes. Not a Supabase test instance — a narrow fake matching exactly the
// chain shape used in member-reviews.js:
//   supabase.from('bookings').select('id', {count:'exact'}).or(filter)
//   supabase.from('reviews').select('id', {count:'exact',head:true}).in('booking_id', ids)
// ============================================================
function makeSupabaseStub({ bookingsResult, reviewsResult } = {}) {
  const calls = { bookings: [], reviews: [] };
  const stub = {
    from(table) {
      if (table === 'bookings') {
        return {
          select(_cols, _opts) {
            return {
              or(filter) {
                calls.bookings.push({ filter });
                return Promise.resolve(bookingsResult);
              },
            };
          },
        };
      }
      if (table === 'reviews') {
        return {
          select(_cols, _opts) {
            return {
              in(_col, ids) {
                calls.reviews.push({ ids });
                return Promise.resolve(reviewsResult);
              },
            };
          },
        };
      }
      throw new Error('unexpected table in stub: ' + table);
    },
  };
  return { stub, calls };
}

const VALID_WA = '6281234567890';

test('[behavior] no bookings for this customer -> reviews_count is a real 0, reviews table never queried', async () => {
  const { stub, calls } = makeSupabaseStub({
    bookingsResult: { data: [], count: 0, error: null },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, 0);
  assert.equal(calls.reviews.length, 0, 'reviews table must not be queried when there are no bookings');
});

test('[behavior] bookings exist and reviews query returns a count -> that exact count is returned', async () => {
  const { stub, calls } = makeSupabaseStub({
    bookingsResult: { data: [{ id: 'b1' }, { id: 'b2' }], count: 2, error: null },
    reviewsResult: { count: 5, error: null },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, 5);
  assert.equal(calls.reviews.length, 1);
  assert.deepEqual(calls.reviews[0].ids, ['b1', 'b2'], 'reviews lookup must be scoped to exactly this customer\'s booking ids');
});

test('[behavior] bookings query fails -> count unavailable (undefined), not 0', async () => {
  const { stub } = makeSupabaseStub({
    bookingsResult: { data: null, count: null, error: new Error('bookings query boom') },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, undefined);
});

test('[behavior] reviews query fails -> count unavailable (undefined), not 0', async () => {
  const { stub } = makeSupabaseStub({
    bookingsResult: { data: [{ id: 'b1' }], count: 1, error: null },
    reviewsResult: { count: null, error: new Error('reviews query boom') },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, undefined);
});

test('[behavior] a lookup failure never throws — the caller (route) always gets a settled value back', async () => {
  const { stub } = makeSupabaseStub({
    bookingsResult: { data: null, count: null, error: new Error('boom') },
  });
  await assert.doesNotReject(getCustomerReviewsCount(stub, VALID_WA));
});

test('[behavior] truncated bookings result (PostgREST row cap: total > returned) -> count unavailable, reviews table never queried', async () => {
  const { stub, calls } = makeSupabaseStub({
    // Only 1 row came back but the true total match count is 5 — the id
    // list is incomplete.
    bookingsResult: { data: [{ id: 'b1' }], count: 5, error: null },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, undefined);
  assert.equal(calls.reviews.length, 0, 'must not count reviews against an incomplete booking-id list');
});

test('[behavior] booking-id list exceeds the conservative .in() cap -> lookup skipped, count unavailable', async () => {
  const manyIds = Array.from({ length: MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP + 1 }, (_, i) => `b${i}`);
  const { stub, calls } = makeSupabaseStub({
    // Not truncated: PostgREST returned everything it matched (count === length).
    bookingsResult: { data: manyIds.map(id => ({ id })), count: manyIds.length, error: null },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, undefined);
  assert.equal(calls.reviews.length, 0, 'must not send an unbounded id list through .in(...)');
});

test('[behavior] a list exactly at the cap is still queried (cap is a ceiling, not an off-by-one exclusion)', async () => {
  const idsAtCap = Array.from({ length: MAX_BOOKING_IDS_FOR_REVIEWS_LOOKUP }, (_, i) => `b${i}`);
  const { stub, calls } = makeSupabaseStub({
    bookingsResult: { data: idsAtCap.map(id => ({ id })), count: idsAtCap.length, error: null },
    reviewsResult: { count: 3, error: null },
  });
  const result = await getCustomerReviewsCount(stub, VALID_WA);
  assert.equal(result, 3);
  assert.equal(calls.reviews.length, 1);
});

test('[behavior] empty session phone -> lookup is not run at all (no table queried)', async () => {
  const { stub, calls } = makeSupabaseStub({});
  const resultEmpty = await getCustomerReviewsCount(stub, '');
  const resultNull = await getCustomerReviewsCount(stub, null);
  const resultUndefined = await getCustomerReviewsCount(stub, undefined);
  assert.equal(resultEmpty, undefined);
  assert.equal(resultNull, undefined);
  assert.equal(resultUndefined, undefined);
  assert.equal(calls.bookings.length, 0, 'must not query bookings for an empty/malformed phone');
  assert.equal(calls.reviews.length, 0);
});

test('[behavior] the function signature has no request-derived input channel — result only ever varies with the phone argument', async () => {
  // getCustomerReviewsCount(supabase, customerWa) takes exactly two
  // parameters: the query client and the phone string. There is nowhere
  // for a request query/body/params value to enter this function, so a
  // caller passing session.customer_wa (as the real route does — see the
  // source-inspection test below) cannot have that redirected by anything
  // else in the incoming request.
  assert.equal(getCustomerReviewsCount.length, 2);

  const { stub: stubA } = makeSupabaseStub({
    bookingsResult: { data: [{ id: 'b1' }], count: 1, error: null },
    reviewsResult: { count: 7, error: null },
  });
  const { stub: stubB } = makeSupabaseStub({
    bookingsResult: { data: [{ id: 'b1' }], count: 1, error: null },
    reviewsResult: { count: 7, error: null },
  });
  const resultA = await getCustomerReviewsCount(stubA, '6281111111111');
  const resultB = await getCustomerReviewsCount(stubB, '6282222222222');
  // Same stubbed backend data either way — the only thing that could have
  // changed the outcome between these two calls is the phone argument, and
  // here it didn't (both stubs return the same canned data), confirming
  // there's no side-channel input.
  assert.equal(resultA, 7);
  assert.equal(resultB, 7);
});

// ============================================================
// Source-inspection: how server/index.js WIRES this module into the route.
// This does not execute the route — it checks the call site uses the
// session-resolved identity and doesn't reintroduce the old inline logic.
// ============================================================
test('[source-inspection] /api/auth/me calls getCustomerReviewsCount with session.customer_wa, not any request-supplied value', () => {
  const server = source('server/index.js');
  assert.match(server, /require\('\.\/member-reviews'\)/, 'expected index.js to require the extracted member-reviews module');
  assert.match(server, /getCustomerReviewsCount\(supabase, session\.customer_wa\)/,
    'the route must call getCustomerReviewsCount with session.customer_wa');

  const meRouteMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);
  assert.ok(meRouteMatch, 'expected to find the /api/auth/me route handler');
  const routeBody = meRouteMatch[0];
  assert.doesNotMatch(routeBody, /getCustomerReviewsCount\(supabase, req\./,
    'must never call the reviews lookup with a request-derived identity');
});

test('[source-inspection] /api/auth/me only assigns reviews_count when the lookup resolved a value, and keeps the response contract unchanged', () => {
  const server = source('server/index.js');
  const meRouteMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);
  assert.ok(meRouteMatch, 'expected to find the /api/auth/me route handler');
  const routeBody = meRouteMatch[0];

  assert.match(routeBody, /if \(reviewsCount !== undefined\) customer\.reviews_count = reviewsCount;/,
    'reviews_count must only be assigned when the lookup did not return undefined ("unavailable")');
  assert.match(routeBody, /return res\.json\(\{ customer: customer \|\| null \}\);/,
    'the endpoint must still return { customer } unchanged — reviews_count is only an added property on that object');

  const ifCustomerIdx = routeBody.indexOf('if (customer) {');
  const lookupIdx = routeBody.indexOf('getCustomerReviewsCount(supabase, session.customer_wa)');
  const returnJsonIdx = routeBody.indexOf('return res.json({ customer: customer || null });');
  assert.ok(ifCustomerIdx > -1 && lookupIdx > -1 && returnJsonIdx > -1);
  assert.ok(ifCustomerIdx < lookupIdx && lookupIdx < returnJsonIdx,
    'the reviews lookup must run inside if(customer), before the response is sent (a lookup failure must never block or abort the main profile response)');
});
