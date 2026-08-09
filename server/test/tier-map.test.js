'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..', '..');
const source = (rel) => fs.readFileSync(path.join(workspace, rel), 'utf8');

test('the dashboard no longer claims points drive tier level-up', () => {
  const html = source('member-dashboard.html');
  const js = source('js/dashboard.js');
  assert.doesNotMatch(html, /Kumpulkan poin setiap kunjungan untuk naik level/);
  assert.doesNotMatch(js, /tierFill1|tierFill2/);
});

test('member-dashboard.html has a tier map container and no static progress nodes', () => {
  const html = source('member-dashboard.html');
  assert.match(html, /id="tierMapContainer"/);
  assert.doesNotMatch(html, /tier-connector-fill/);
});

test('dashboard.js renders the tier map with an upgrade CTA to member-register.html', () => {
  const js = source('js/dashboard.js');
  assert.match(js, /function renderTierMap/);
  assert.match(js, /renderTierMap\(tier\)/);
  assert.match(js, /member-register\.html\?tier=/);
});
