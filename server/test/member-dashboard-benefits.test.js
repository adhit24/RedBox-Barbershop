const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardScript = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'dashboard.js'),
  'utf8',
);
const dashboardPage = fs.readFileSync(
  path.join(__dirname, '..', '..', 'member-dashboard.html'),
  'utf8',
);

test('member dashboard only advertises approved membership benefits', () => {
  assert.doesNotMatch(dashboardScript, /Poin multiplier|Cashback 50%|Birthday gratis penuh/);
  assert.match(dashboardScript, /Diskon 50% saat birthday/);
  assert.match(dashboardScript, /7 hari sebelum sampai 7 hari sesudah/);
  assert.match(dashboardScript, /Diskon 10% layanan/);
  assert.match(dashboardScript, /kecuali CSB Mall/);
  assert.match(dashboardScript, /Free Gentlemen Grooming/);
  assert.match(dashboardScript, /Free Iced Americano/);
  assert.match(dashboardScript, /Priority semua cabang/);
  assert.doesNotMatch(dashboardPage, /5% discount haircut|Free birthday penuh|Berlaku di semua cabang/);
  assert.match(dashboardPage, /Tidak berlaku di CSB Mall/);
});
