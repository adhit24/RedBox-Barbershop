'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const bookingJs = fs.readFileSync(path.join(root, 'public', 'js', 'booking.js'), 'utf8');
const mokaRoutes = fs.readFileSync(path.join(root, 'server', 'moka', 'routes.js'), 'utf8');

test('booking guard rejects a missing or any kapster before insert', () => {
  assert.match(server, /if \(!normalizedBarberId \|\| normalizedBarberId === 'any'\)/);
  assert.match(server, /Kapster wajib dipilih sebelum booking/);
});

test('public booking rejects a barber from another branch instead of correcting location', () => {
  assert.match(server, /branchMatchesBarber\(barberCheck, resolvedLocation\)/);
  assert.match(server, /Kapster .*tidak tersedia di cabang/);
  assert.doesNotMatch(server, /resolvedLocation = barberCheck\.branch/);
});

test('booking page accepts branch context from the WhatsApp booking link', () => {
  assert.match(bookingJs, /const requestedBranch = \(params\.get\('branch'\) \|\| ''\)/);
  assert.match(bookingJs, /let currentBranchFilter = requestedBranch \|\| 'bypass'/);
  assert.match(bookingJs, /initialLocation\.value = requestedBranch/);
});

test('legacy reservations require an explicit barber and verify its outlet', () => {
  assert.match(mokaRoutes, /if \(!barberId \|\| barberId === 'any'\)/);
  assert.match(mokaRoutes, /branchMatchesBarber\(selectedBarber, outlet\.slug, outletId\)/);
  assert.doesNotMatch(mokaRoutes, /find_available_barber/);
});
