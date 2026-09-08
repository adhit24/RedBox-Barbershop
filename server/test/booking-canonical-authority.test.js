// server/test/booking-canonical-authority.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');

const serverFile = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const frontendRouteFile = fs.readFileSync(
  path.join(workspace, 'frontend', 'src', 'app', 'api', 'bookings', 'route.ts'),
  'utf8'
);
const frontendIdRouteFile = fs.readFileSync(
  path.join(workspace, 'frontend', 'src', 'app', 'api', 'bookings', '[id]', 'route.ts'),
  'utf8'
);
const frontendAuthFile = fs.readFileSync(
  path.join(workspace, 'frontend', 'src', 'app', 'api', 'bookings', '_auth.ts'),
  'utf8'
);
const frontendPolicyFile = fs.readFileSync(
  path.join(workspace, 'frontend', 'src', 'app', 'api', 'bookings', '_policy.ts'),
  'utf8'
);
const calendarViewFile = fs.readFileSync(
  path.join(workspace, 'frontend', 'src', 'app', 'admin', '(admin_portal)', 'bookings', 'CalendarView.tsx'),
  'utf8'
);

const {
  authorizeBookingAdminSession,
  authorizeBookingPatchOperation,
  resolveBookingAdminRole,
  normalizeBranch,
} = require(path.join(workspace, 'frontend', 'src', 'app', 'api', 'bookings', '_policy.ts'));

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

// ============================================================================
// P2-B1 CORRECTION ROUND 1 — SECURE ADMIN PATCH PROXY TESTS
// ============================================================================

test('P2-B1 Correction: Next.js PATCH /api/bookings/[id] route enforces verified Backoffice Supabase auth before proxying', () => {
  // Must use requireBookingAdminSession
  assert.match(frontendIdRouteFile, /requireBookingAdminSession\(req\)/, 'route must require authenticated admin session');
  assert.match(frontendIdRouteFile, /if \(!authResult\.ok\)[\s\S]*?return authResult\.response/, 'unauthenticated or unauthorized callers must be halted');

  // Must verify manager branch scope before proxying
  assert.match(frontendIdRouteFile, /authorizeBookingPatchOperation/, 'route must call authorizeBookingPatchOperation');
  assert.match(frontendIdRouteFile, /\.from\(['"]bookings['"]\)/, 'route must inspect existing booking for manager scoping');

  // Server secret is injected server-side ONLY in fetch headers
  assert.match(frontendIdRouteFile, /'x-admin-token':\s*ADMIN_TOKEN/, 'must inject server-side ADMIN_TOKEN');
  assert.doesNotMatch(frontendIdRouteFile, /req\.headers\.get\(['"]x-admin-token['"]\)/, 'must NOT trust or forward client-supplied x-admin-token');

  // ADMIN_PASSWORD is never leaked to client
  assert.doesNotMatch(frontendIdRouteFile, /NextResponse\.json\(\s*\{[^}]*ADMIN_TOKEN/, 'never return admin token in json');
  assert.doesNotMatch(frontendIdRouteFile, /NextResponse\.json\(\s*\{[^}]*ADMIN_PASSWORD/, 'never return admin password in json');
});

test('P2-B1 Correction 1: unauthenticated PATCH -> 401', () => {
  // No user or no user id must return 401
  const unauthUser = authorizeBookingAdminSession(null, null);
  assert.equal(unauthUser.ok, false);
  assert.equal(unauthUser.status, 401);
  assert.match(unauthUser.error, /Unauthorized/);

  const emptyIdUser = authorizeBookingAdminSession({ id: '' }, null);
  assert.equal(emptyIdUser.ok, false);
  assert.equal(emptyIdUser.status, 401);

  const whitespaceUser = authorizeBookingAdminSession({ id: '   ' }, null);
  assert.equal(whitespaceUser.ok, false);
  assert.equal(whitespaceUser.status, 401);
});

test('P2-B1 Correction 2: unauthorized role -> 403', () => {
  const disallowedRoles = ['barber', 'customer', 'branch_admin', 'staff', 'guest', ''];
  for (const role of disallowedRoles) {
    const res = authorizeBookingAdminSession(
      { id: 'user-xyz', email: 'test@example.com' },
      { id: 'user-xyz', role, branch: 'csb' }
    );
    assert.equal(res.ok, false, `role ${role} should be unauthorized`);
    assert.equal(res.status, 403, `role ${role} should return 403`);
    assert.match(res.error, /Forbidden/);
  }

  // Profile not matching user ID -> 403
  const mismatchedProfile = authorizeBookingAdminSession(
    { id: 'user-1', email: 'test@example.com' },
    { id: 'user-2', role: 'manager', branch: 'csb' }
  );
  assert.equal(mismatchedProfile.ok, false);
  assert.equal(mismatchedProfile.status, 403);
});

test('P2-B1 Correction 3: manager without branch -> fail closed (403)', () => {
  const invalidBranches = [null, undefined, '', '   ', 'unknown_outlet', 'jakarta'];
  for (const branch of invalidBranches) {
    const res = authorizeBookingAdminSession(
      { id: 'mgr-1', email: 'mgr@example.com' },
      { id: 'mgr-1', role: 'manager', branch }
    );
    assert.equal(res.ok, false, `manager with branch '${branch}' must fail closed`);
    assert.equal(res.status, 403, `manager with branch '${branch}' must return 403`);
    assert.match(res.error, /Forbidden: manager has no assigned branch/);
  }
});

test('P2-B1 Correction 4: authorized owner -> proxy allowed without branch restriction', () => {
  // Owner by profile role
  const ownerByRole = authorizeBookingAdminSession(
    { id: 'owner-1', email: 'owner@customdomain.com' },
    { id: 'owner-1', role: 'owner', branch: null }
  );
  assert.equal(ownerByRole.ok, true);
  assert.equal(ownerByRole.value.role, 'owner');
  assert.equal(ownerByRole.value.branch, null);

  // Owner by email whitelist
  const ownerByEmail = authorizeBookingAdminSession(
    { id: 'owner-2', email: 'adhit24@gmail.com' },
    { id: 'owner-2', role: 'manager', branch: 'csb' }
  );
  assert.equal(ownerByEmail.ok, true);
  assert.equal(ownerByEmail.value.role, 'owner');

  const secondOwner = authorizeBookingAdminSession(
    { id: 'owner-3', email: 'suwandi_gunawan@yahoo.com' },
    { id: 'owner-3', role: 'barber', branch: 'bypass' }
  );
  assert.equal(secondOwner.ok, true);
  assert.equal(secondOwner.value.role, 'owner');

  // Owner can operate across any branch
  const opBypass = authorizeBookingPatchOperation(ownerByRole.value, { id: 'bk-1', location: 'bypass' }, { date: '2026-09-10' });
  assert.equal(opBypass.ok, true);

  const opCsb = authorizeBookingPatchOperation(ownerByRole.value, { id: 'bk-2', location: 'csb' }, { location: 'tegal' });
  assert.equal(opCsb.ok, true);
});

test('P2-B1 Correction 5: authorized manager -> only proper scoped operation allowed', () => {
  const mgrAuth = authorizeBookingAdminSession(
    { id: 'mgr-csb', email: 'manager.csb@redbox.com' },
    { id: 'mgr-csb', role: 'manager', branch: 'csb' }
  );
  assert.equal(mgrAuth.ok, true);
  const session = mgrAuth.value;
  assert.equal(session.role, 'manager');
  assert.equal(session.branch, 'csb');

  // 1. Updating a CSB booking -> ALLOWED
  const opAllowed = authorizeBookingPatchOperation(
    session,
    { id: 'bk-csb', location: 'csb' },
    { date: '2026-09-12', time: '14:00:00' }
  );
  assert.equal(opAllowed.ok, true);
  assert.equal(opAllowed.value.safeBranch, 'csb');

  // 2. Updating a CSB booking with location normalized ('CSB Mall') -> ALLOWED
  const opAlias = authorizeBookingPatchOperation(
    session,
    { id: 'bk-csb-2', location: 'csb mall' },
    { location: 'CSB' }
  );
  assert.equal(opAlias.ok, true);

  // 3. Updating a Sumber booking -> REJECTED 403
  const opSumber = authorizeBookingPatchOperation(
    session,
    { id: 'bk-sumber', location: 'sumber' },
    { date: '2026-09-12' }
  );
  assert.equal(opSumber.ok, false);
  assert.equal(opSumber.status, 403);
  assert.match(opSumber.error, /manager \(csb\) cannot operate on booking for branch \(sumber\)/);

  // 4. Updating a CSB booking but moving to Sumber -> REJECTED 403
  const opMove = authorizeBookingPatchOperation(
    session,
    { id: 'bk-csb-3', location: 'csb' },
    { location: 'sumber' }
  );
  assert.equal(opMove.ok, false);
  assert.equal(opMove.status, 403);
  assert.match(opMove.error, /manager \(csb\) cannot move booking to branch \(sumber\)/);

  // 5. Nonexistent booking -> 404
  const opMissing = authorizeBookingPatchOperation(
    session,
    null,
    { date: '2026-09-12' }
  );
  assert.equal(opMissing.ok, false);
  assert.equal(opMissing.status, 404);
});

test('P2-B1 Correction 6 & 7: client x-admin-token ignored and ADMIN_PASSWORD never exposed', () => {
  // Ensure the auth module does not look for or accept x-admin-token from client
  assert.doesNotMatch(frontendAuthFile, /x-admin-token/, 'auth module must not authenticate via x-admin-token');
  assert.match(frontendAuthFile, /supabase\.auth\.getUser/, 'auth module must verify Supabase session');

  // Ensure route does not forward client x-admin-token
  assert.doesNotMatch(frontendIdRouteFile, /req\.headers\.get\(['"]x-admin-token['"]\)/, 'route must not read client x-admin-token');

  // Ensure ADMIN_PASSWORD is kept server-side only
  assert.match(frontendIdRouteFile, /const ADMIN_TOKEN = process\.env\.ADMIN_PASSWORD \?\? ''/, 'ADMIN_TOKEN read from env');
  assert.match(frontendIdRouteFile, /'x-admin-token':\s*ADMIN_TOKEN/, 'ADMIN_TOKEN injected only in backend fetch');
});
