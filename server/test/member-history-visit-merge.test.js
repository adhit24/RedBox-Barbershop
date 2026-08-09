'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const historyRouteMatch = server.match(/app\.get\('\/api\/member\/history'[\s\S]*?\n  \}\);/);

test('the /api/member/history route exists and was located for the other assertions', () => {
  assert.ok(historyRouteMatch, 'expected to find the GET /api/member/history route handler');
});

test('the route queries member_visit_history by the resolved profile user_key', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /\.from\('member_visit_history'\)/);
  assert.match(routeBody, /\.eq\('user_key', profile\.user_key\)/);
  assert.match(routeBody, /\.order\('visit_date', \{ ascending: false \}\)/);
});

test('mapped visit-history rows use the shape renderBookingsHistory already expects', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /status:\s*'done'/);
  assert.match(routeBody, /service:\s*row\.service_summary \|\| 'Kunjungan Moka'/);
  assert.match(routeBody, /price:\s*Number\(row\.amount\)\s*\|\|\s*0/);
  assert.match(routeBody, /location:\s*row\.outlet_slug \|\| 'RedBox Barbershop'/);
});

test('the merged bookings array is sorted by date/time descending and capped at 100', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /\.sort\(\(a, b\) => \{/);
  assert.match(routeBody, /\.slice\(0,\s*100\)/);
});

test('the existing aggregate-fallback synthesis is untouched', () => {
  const routeBody = historyRouteMatch[0];
  assert.match(routeBody, /Legacy Moka visits are stored as aggregates/);
  assert.match(routeBody, /Kunjungan dari Moka/);
});
