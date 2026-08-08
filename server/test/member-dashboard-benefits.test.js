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
  assert.doesNotMatch(dashboardScript, /Poin multiplier|Birthday gratis penuh/);
  assert.match(dashboardScript, /Diskon 20% saat birthday/);
  assert.match(dashboardScript, /7 hari sebelum sampai 7 hari sesudah/);
  assert.match(dashboardScript, /Diskon 10% layanan/);
  assert.match(dashboardScript, /kecuali CSB Mall/);
  assert.match(dashboardScript, /Free Gentlemen Grooming/);
  assert.match(dashboardScript, /Free Iced Americano/);
  assert.match(dashboardScript, /Priority semua cabang/);
  assert.match(dashboardScript, /Birthday service gratis/);
  assert.match(dashboardScript, /Cashback 50% Haircut Regular/);
  assert.match(dashboardScript, /Cashback 50% Haircut Premium \(CSB\)/);
  assert.doesNotMatch(dashboardScript, /POINT_VALUE_IDR|MAX_POINT_REDEMPTIONS_PER_TRANSACTION|shop-product-discount/);
  assert.match(dashboardScript, /current_tier/);
  assert.match(dashboardScript, /renderShop\(\);/);
  assert.doesNotMatch(dashboardPage, /5% discount haircut|Free birthday penuh|Berlaku di semua cabang/);
  assert.match(dashboardPage, /Tidak berlaku di CSB Mall/);
});
