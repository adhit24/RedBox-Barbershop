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

test('Next CRM activation collects and sends payment, branch, and staff audit data', () => {
  const page = source(path.join('frontend', 'src', 'app', 'admin', 'membership', 'page.tsx'));

  assert.match(page, /paymentReference/);
  assert.match(page, /staffId:\s*user\?\.id/);
  assert.match(page, /branch:\s*activationBranch/);
  assert.match(page, /value=\{paymentReference\}/);
  assert.match(page, /value=\{activationBranch\}/);
});
