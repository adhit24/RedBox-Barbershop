// server/test/booking-canonical-authority.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverFile = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const frontendRouteFile = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'api', 'bookings', 'route.ts'),
  'utf8'
);
const frontendIdRouteFile = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'api', 'bookings', '[id]', 'route.ts'),
  'utf8'
);
const calendarViewFile = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'admin', '(admin_portal)', 'bookings', 'CalendarView.tsx'),
  'utf8'
);

test('P2-B1: DELETE /api/bookings/:id is disabled and returns 405 Method Not Allowed', () => {
  const deleteRouteMatch = serverFile.match(/app\.delete\('\/api\/bookings\/:id'[\s\S]*?\n\}\);/);
  assert.ok(deleteRouteMatch, 'expected app.delete(\'/api/bookings/:id\') route to exist');
  const deleteBody = deleteRouteMatch[0];

  // Must not perform direct table delete
  assert.doesNotMatch(deleteBody, /\.from\('bookings'\)\.delete\(\)/, 'hard delete from bookings must not be called');
  assert.doesNotMatch(deleteBody, /DELETE FROM bookings/, 'SQL delete must not be called');

  // Must return 405 Method Not Allowed with code BOOKING_HARD_DELETE_DISABLED
  assert.match(deleteBody, /res\.status\(405\)/, 'must return 405 status code');
  assert.match(deleteBody, /BOOKING_HARD_DELETE_DISABLED/, 'must return BOOKING_HARD_DELETE_DISABLED error code');

  // Must log noncanonical write blocked event
  assert.match(deleteBody, /booking_noncanonical_write_blocked/, 'must log booking_noncanonical_write_blocked event');
});

test('P2-B1: Next.js POST /api/bookings does not write directly to Supabase and proxies to canonical backend', () => {
  // Must NOT import Supabase client in Next.js route
  assert.doesNotMatch(frontendRouteFile, /import\s*\{[^}]*createClient[^}]*\}\s*from\s*['"]@\/utils\/supabase/, 'Next.js route must not import createClient');
  assert.doesNotMatch(frontendRouteFile, /\.from\(['"]bookings['"]\)\.insert/, 'Next.js route must not insert directly into bookings');

  // Must proxy POST to Express backend
  const postFunctionMatch = frontendRouteFile.match(/export async function POST[\s\S]*?\n\}/);
  assert.ok(postFunctionMatch, 'expected export async function POST');
  const postFunctionBody = postFunctionMatch[0];

  assert.match(postFunctionBody, /fetch\(`\$\{API_URL\}\/api\/bookings`/, 'must proxy to ${API_URL}/api/bookings');
  assert.match(postFunctionBody, /method:\s*['"]POST['"]/, 'must use POST method for proxy');
  assert.doesNotMatch(postFunctionBody, /'x-admin-token'/, 'POST proxy must not forward admin token');
});

test('P2-B1: Next.js PATCH /api/bookings/[id] proxies to canonical backend with admin auth', () => {
  assert.match(frontendIdRouteFile, /export async function PATCH/, 'must export PATCH handler');
  assert.match(frontendIdRouteFile, /fetch\(`\$\{API_URL\}\/api\/bookings\/\$\{encodeURIComponent\(id\)\}`/, 'must forward to canonical backend booking endpoint');
  assert.match(frontendIdRouteFile, /'x-admin-token':\s*ADMIN_TOKEN/, 'must forward admin token in headers');
});

test('P2-B1: CalendarView.tsx handleReschedule uses canonical PATCH /api/bookings/:id instead of direct DB write', () => {
  // Must NOT import Supabase client
  assert.doesNotMatch(calendarViewFile, /import\s*\{[^}]*createClient[^}]*\}\s*from\s*['"]@\/utils\/supabase\/client['"]/, 'CalendarView must not import supabase client');
  assert.doesNotMatch(calendarViewFile, /const supabase = createClient\(\)/, 'CalendarView must not instantiate supabase');
  assert.doesNotMatch(calendarViewFile, /supabase\.from\(['"]bookings['"]\)\.update/, 'CalendarView must not call supabase update');

  // Must call canonical PATCH /api/bookings/:id
  assert.match(calendarViewFile, /fetch\(`\/api\/bookings\/\$\{encodeURIComponent\(id\)\}`,\s*\{[\s\S]*?method:\s*['"]PATCH['"]/, 'handleReschedule must call fetch PATCH /api/bookings/:id');
});

test('P2-B1: Canonical write routes in server/index.js are preserved and authoritative', () => {
  assert.match(serverFile, /app\.post\('\/api\/bookings',/, 'canonical POST /api/bookings must exist');
  assert.match(serverFile, /app\.patch\('\/api\/bookings\/:id',\s*adminAuth,\s*handleBookingUpdate\);/, 'canonical PATCH /api/bookings/:id must exist');
  assert.match(serverFile, /app\.post\('\/api\/bookings\/:id',\s*adminAuth,\s*handleBookingUpdate\);/, 'canonical POST /api/bookings/:id fallback must exist');
  assert.match(serverFile, /app\.post\('\/api\/booking-status',\s*adminAuth,/, 'canonical POST /api/booking-status must exist');
});
