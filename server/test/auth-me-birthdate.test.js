'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const authMeMatch = server.match(/app\.get\('\/api\/auth\/me'[\s\S]*?\n  \}\);/);

test('the GET /api/auth/me route exists and was located for the other assertions', () => {
  assert.ok(authMeMatch, "expected to find the GET '/api/auth/me' route handler");
});

test('GET /api/auth/me copies birthdate from the member profile onto the returned customer', () => {
  const routeBody = authMeMatch[0];
  assert.match(routeBody, /if \(profile\?\.birthdate\) customer\.birthdate = profile\.birthdate;/);
});
