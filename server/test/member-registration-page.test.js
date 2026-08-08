'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const registrationPagePath = path.join(root, 'member-register.html');
const membershipPagePath = path.join(root, 'membership.html');

test('member registration page has a mobile form, tier choices, and an explicit outlet-activation boundary', () => {
  const page = fs.readFileSync(registrationPagePath, 'utf8');
  assert.match(page, /<main\b/i);
  assert.match(page, /<form[^>]+id="membershipRegistrationForm"/i);
  assert.match(page, /id="fullName"/i);
  assert.match(page, /id="phone"/i);
  assert.match(page, /id="email"/i);
  assert.match(page, /name="tier"/i);
  assert.match(page, /value="silver"/i);
  assert.match(page, /value="gold"/i);
  assert.match(page, /value="platinum"/i);
  assert.match(page, /bayar di outlet/i);
  assert.match(page, /belum aktif sebelum kasir mengonfirmasi/i);
  assert.match(page, /id="registrationSubmit"/i);
  assert.match(page, /aria-live="polite"/i);
  assert.match(page, /js\/member-registration\.js/);
});

test('tier CTAs point to paid registration with the selected tier and no longer promise immediate activation', () => {
  const membershipPage = fs.readFileSync(membershipPagePath, 'utf8');
  assert.match(membershipPage, /href="member-register\.html\?tier=silver"[^>]*class="tier-cta"/i);
  assert.match(membershipPage, /href="member-register\.html\?tier=gold"[^>]*class="tier-cta"/i);
  assert.match(membershipPage, /href="member-register\.html\?tier=platinum"[^>]*class="tier-cta"/i);
  assert.match(membershipPage, /pilih tier, bayar di outlet, aktivasi oleh kasir/i);
  assert.doesNotMatch(membershipPage, /akun membership langsung aktif/i);
});

test('registration script preselects the URL tier and submits only the public registration payload', () => {
  const script = fs.readFileSync(path.join(root, 'js', 'member-registration.js'), 'utf8');
  assert.match(script, /URLSearchParams/);
  assert.match(script, /tier/);
  assert.match(script, /\/api\/membership\/registrations/);
  assert.match(script, /fullName/);
  assert.match(script, /phone/);
  assert.match(script, /email/);
  assert.doesNotMatch(script, /paymentReference|payment_method|paymentMethod/);
  assert.match(script, /disabled\s*=\s*true/);
});

test('logged-in legacy members are prefilled from the OTP session and do not need to retype biodata', () => {
  const page = fs.readFileSync(registrationPagePath, 'utf8');
  const script = fs.readFileSync(path.join(root, 'js', 'member-registration.js'), 'utf8');
  assert.match(script, /rb_member_token/);
  assert.match(script, /redbox_member/);
  assert.match(script, /readOnly = true/);
  assert.match(page, /legacyMemberHint/);
});
