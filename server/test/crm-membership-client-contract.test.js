'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(workspace, relativePath), 'utf8');
}

test('legacy CRM activation uses the authenticated atomic API with paid-tier audit fields', () => {
  const crm = source(path.join('public', 'js', 'crm.js'));
  const html = source(path.join('public', 'crm.html'));

  assert.match(crm, /API_URL}\/admin\/crm\/membership\/activate/);
  assert.match(crm, /paymentReference/);
  assert.match(crm, /staffId/);
  assert.doesNotMatch(crm, /membership_status:\s*'ACTIVE'/);
  assert.doesNotMatch(crm, /sbMem\('member_activations'/);
  for (const id of ['memTier', 'memPaymentReference', 'memStaffId', 'qaTier', 'qaPaymentReference', 'qaStaffId']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing legacy CRM field ${id}`);
  }
  assert.match(html, /value="silver"[\s\S]{0,100}100\.000/);
  assert.match(html, /value="gold"[\s\S]{0,100}250\.000/);
  assert.match(html, /value="platinum"[\s\S]{0,100}1\.500\.000/);
});

test('Next CRM shows paid registration states and activates only the selected registration', () => {
  const page = source(path.join('frontend', 'src', 'app', 'admin', 'membership', 'page.tsx'));
  const authProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', '_auth.ts'));
  const proxySecret = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', '_proxySecret.ts'));
  const registrationsProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', 'registrations', 'route.ts'));
  const activationProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', 'registrations', '[registrationId]', 'activate', 'route.ts'));
  const changeProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', 'registrations', '[registrationId]', 'change', 'route.ts'));
  const backend = source(path.join('server', 'routes', 'adminCrm.js'));

  assert.match(page, /\/api\/admin\/crm\/membership\/registrations/);
  assert.match(page, /'PENDING'/);
  assert.match(page, /'ACTIVE'/);
  assert.match(page, /'EXPIRED'/);
  assert.match(page, /registrationCode/);
  assert.match(page, /amount/);
  assert.match(page, /readOnly/);
  assert.match(page, /paymentReference/);
  assert.match(page, /paymentConfirmed/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /await loadRegistrations\(\)/);
  assert.match(page, /membershipExpiresAt \|\| registration\.pendingExpiresAt/);
  assert.match(page, /branch:\s*activationBranch/);
  assert.match(page, /value=\{paymentReference\}/);
  assert.match(page, /value=\{activationBranch\}/);
  assert.match(page, /registration\.canUpgrade/);
  assert.match(page, /registration\.canRenew/);
  assert.match(page, /Nominal penuh tier tujuan/);
  assert.match(page, /registrations\/\$\{changeSelection\.registration\.id\}\/change/);
  assert.match(page, /registrationType:\s*changeSelection\.kind/);
  assert.match(page, /TIER_PRICES\[destinationTier\]/);
  assert.doesNotMatch(page, /userKey:\s*activating/);
  assert.doesNotMatch(page, /tier:\s*tier/);
  assert.doesNotMatch(page, /staffId\s*:/);
  assert.match(authProxy, /await cookies\(\)/);
  assert.match(authProxy, /createClient\(cookieStore\)/);
  assert.match(authProxy, /supabase\.auth\.getUser\(\)/);
  assert.match(authProxy, /\.from\('users'\)/);
  assert.match(authProxy, /\.eq\('id', user\.id\)/);
  assert.match(authProxy, /x-redbox-admin-session/);
  assert.match(authProxy, /createHmac\('sha256'/);
  assert.match(authProxy, /requireAdminSessionProxySecret\(process\.env\)/);
  assert.doesNotMatch(authProxy, /ADMIN_SESSION_PROXY_SECRET\s*\|\|/);
  assert.match(proxySecret, /ADMIN_SESSION_PROXY_SECRET/);
  assert.match(proxySecret, /ADMIN_PASSWORD/);
  assert.match(proxySecret, /proxySecret\s*===\s*adminPassword/);
  assert.match(registrationsProxy, /\/api\/admin\/crm\/membership\/registrations/);
  assert.match(registrationsProxy, /requireMembershipAdminSession\(\)/);
  assert.match(registrationsProxy, /createMembershipAdminProxyHeaders\(auth\.session\)/);
  assert.match(registrationsProxy, /cache:\s*'no-store'/);
  assert.match(activationProxy, /\/api\/admin\/crm\/membership\/registrations\/\$\{encodeURIComponent\(registrationId\)\}\/activate/);
  assert.match(activationProxy, /requireMembershipAdminSession\(\)/);
  assert.match(activationProxy, /resolveMembershipActivationBranch\(auth\.session, body\.branch\)/);
  assert.match(activationProxy, /JSON\.stringify\(\{ paymentMethod, paymentReference, branch: branchDecision\.value \}\)/);
  assert.doesNotMatch(activationProxy, /JSON\.stringify\(body\)/);
  assert.doesNotMatch(activationProxy, /body\.(?:staffId|tier|amount)/);
  assert.match(changeProxy, /requireMembershipAdminSession\(\)/);
  assert.match(changeProxy, /createMembershipAdminProxyHeaders\(auth\.session\)/);
  assert.match(changeProxy, /registrations\/\$\{encodeURIComponent\(registrationId\)\}\/change/);
  assert.match(changeProxy, /body\.registrationType/);
  assert.match(changeProxy, /JSON\.stringify\(\{ tier, registrationType \}\)/);
  assert.doesNotMatch(changeProxy, /JSON\.stringify\(body\)/);
  assert.doesNotMatch(changeProxy, /body\.(?:staffId|amount|branch|role)/);
  assert.match(backend, /verified membership admin session required/);
  assert.match(backend, /registration\.branch === access\.branch/);
  assert.match(backend, /p_confirmed_by:\s*staffId/);
  assert.match(backend, /p_requested_by:\s*access\.staffId/);
  assert.match(backend, /p_requested_branch:\s*sourceBranch/);
});

test('Next membership admin policy returns 401, 403, branch scope, and preserves owner flow', () => {
  const {
    authorizeMembershipAdmin,
    resolveMembershipActivationBranch,
  } = require(path.join(workspace, 'frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', '_policy.ts'));

  assert.deepEqual(authorizeMembershipAdmin(null, null), {
    ok: false, status: 401, error: 'Unauthorized',
  });
  assert.deepEqual(authorizeMembershipAdmin(
    { id: 'user-1' }, { id: 'user-1', role: 'barber', branch: 'csb' },
  ), { ok: false, status: 403, error: 'Admin access required' });

  const branchAdmin = authorizeMembershipAdmin(
    { id: 'staff-1' }, { id: 'staff-1', role: 'branch_admin', branch: 'csb' },
  );
  assert.equal(branchAdmin.ok, true);
  assert.deepEqual(resolveMembershipActivationBranch(branchAdmin.value, 'tegal'), {
    ok: false, status: 403, error: 'Branch access denied',
  });
  assert.deepEqual(resolveMembershipActivationBranch(branchAdmin.value, 'csb'), {
    ok: true, value: 'csb',
  });

  const owner = authorizeMembershipAdmin(
    { id: 'owner-1' }, { id: 'owner-1', role: 'owner', branch: null },
  );
  assert.equal(owner.ok, true);
  assert.deepEqual(resolveMembershipActivationBranch(owner.value, 'tegal'), {
    ok: true, value: 'tegal',
  });
});

test('users role and branch authorization fields are read-only to browser sessions', () => {
  const migration = source(path.join('server', 'migrations', '2026-08-08-secure-users-admin-roles.sql'));

  assert.match(migration, /ALTER TABLE public\.users ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.users FROM anon/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.users FROM authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.users TO authenticated/i);
  assert.match(migration, /USING \(id = auth\.uid\(\)\)/i);
});
