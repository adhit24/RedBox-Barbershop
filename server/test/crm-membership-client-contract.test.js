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
  const crm = source(path.join('js', 'crm.js'));
  const html = source('crm.html');

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
  const registrationsProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', 'registrations', 'route.ts'));
  const activationProxy = source(path.join('frontend', 'src', 'app', 'api', 'admin', 'crm', 'membership', 'registrations', '[registrationId]', 'activate', 'route.ts'));

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
  assert.doesNotMatch(page, /userKey:\s*activating/);
  assert.doesNotMatch(page, /tier:\s*tier/);
  assert.doesNotMatch(page, /staffId\s*:/);
  assert.match(registrationsProxy, /\/api\/admin\/crm\/membership\/registrations/);
  assert.match(registrationsProxy, /'x-admin-token': TOKEN/);
  assert.match(registrationsProxy, /cache:\s*'no-store'/);
  assert.match(activationProxy, /\/api\/admin\/crm\/membership\/registrations\/\$\{encodeURIComponent\(registrationId\)\}\/activate/);
  assert.match(activationProxy, /'x-admin-token': TOKEN/);
  assert.match(activationProxy, /JSON\.stringify\(\{ paymentMethod, paymentReference, branch \}\)/);
  assert.doesNotMatch(activationProxy, /JSON\.stringify\(body\)/);
  assert.doesNotMatch(activationProxy, /body\.(?:staffId|tier|amount)/);
});
