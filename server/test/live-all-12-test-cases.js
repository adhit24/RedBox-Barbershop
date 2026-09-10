// server/test/live-all-12-test-cases.js
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const app = require('../index');
const { _resetBuckets } = require('../middleware/rateLimit');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEST_DATE = '2026-12-30';
const TEST_BARBER = 'bypass-ari';
const TEST_LOCATION = 'bypass';

// Test phones
const PHONE_SILVER = '08999900001';
const PHONE_SILVER_E164 = '+628999900001';
const PHONE_GOLD = '08999900002';
const PHONE_GOLD_E164 = '+628999900002';
const PHONE_PLATINUM = '08999900003';
const PHONE_PLATINUM_E164 = '+628999900003';
const PHONE_GUEST = '081299990001';

// Test tokens (must be valid UUIDs for PostgreSQL uuid column)
const TOKEN_SILVER = 'a1111111-1111-4111-8111-111111111111';
const TOKEN_GOLD = 'a2222222-2222-4222-8222-222222222222';
const TOKEN_PLATINUM = 'a3333333-3333-4333-8333-333333333333';
const TOKEN_EXPIRED = 'a4444444-4444-4444-8444-444444444444';

async function setupTestData() {
  console.log('Setting up test member profiles & sessions in Supabase...');

  // Clean any leftovers first
  await cleanupTestData();

  // Insert Silver member (birthday matching test date: Dec 30)
  const { error: err1 } = await supabase.from('member_profiles').insert([{
    user_key: 'test_silver@redbox.test',
    email: 'test_silver@redbox.test',
    phone: PHONE_SILVER_E164,
    full_name: 'Test Member Silver',
    current_tier: 'silver',
    membership_status: 'ACTIVE',
    membership_started_at: '2026-01-01T00:00:00Z',
    membership_expires_at: '2027-01-01T00:00:00Z',
    birthdate: '1995-12-30',
  }]);
  if (err1) throw err1;

  // Insert Gold member
  const { error: err2 } = await supabase.from('member_profiles').insert([{
    user_key: 'test_gold@redbox.test',
    email: 'test_gold@redbox.test',
    phone: PHONE_GOLD_E164,
    full_name: 'Test Member Gold',
    current_tier: 'gold',
    membership_status: 'ACTIVE',
    membership_started_at: '2026-01-01T00:00:00Z',
    membership_expires_at: '2027-01-01T00:00:00Z',
    birthdate: '1995-05-15',
  }]);
  if (err2) throw err2;

  // Insert Platinum member
  const { error: err3 } = await supabase.from('member_profiles').insert([{
    user_key: 'test_platinum@redbox.test',
    email: 'test_platinum@redbox.test',
    phone: PHONE_PLATINUM_E164,
    full_name: 'Test Member Platinum',
    current_tier: 'platinum',
    membership_status: 'ACTIVE',
    membership_started_at: '2026-01-01T00:00:00Z',
    membership_expires_at: '2027-01-01T00:00:00Z',
    birthdate: '1995-05-15',
  }]);
  if (err3) throw err3;

  // Insert Sessions
  const { error: err4 } = await supabase.from('member_sessions').insert([
    {
      customer_wa: '628999900001',
      token: TOKEN_SILVER,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
    {
      customer_wa: '628999900002',
      token: TOKEN_GOLD,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
    {
      customer_wa: '628999900003',
      token: TOKEN_PLATINUM,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
    {
      customer_wa: '628999900003',
      token: TOKEN_EXPIRED,
      expires_at: new Date(Date.now() - 86400000).toISOString(), // Expired
    },
  ]);
  if (err4) throw err4;

  console.log('✓ Test profiles and sessions ready.');
}

async function cleanupTestData() {
  // Delete test bookings & schedules for test date
  const { data: bList } = await supabase.from('bookings').select('id, schedule_id').eq('date', TEST_DATE);
  if (bList && bList.length) {
    const ids = bList.map(b => b.id);
    const schIds = bList.map(b => b.schedule_id).filter(Boolean);
    await supabase.from('bookings').delete().in('id', ids);
    if (schIds.length) {
      await supabase.from('schedules').delete().in('id', schIds);
    }
  }

  // Delete test sessions
  await supabase.from('member_sessions').delete().in('token', [
    TOKEN_SILVER, TOKEN_GOLD, TOKEN_PLATINUM, TOKEN_EXPIRED
  ]);

  // Delete test profiles
  await supabase.from('member_profiles').delete().in('user_key', [
    'test_silver@redbox.test', 'test_gold@redbox.test', 'test_platinum@redbox.test'
  ]);
  await supabase.from('member_profiles').delete().in('phone', [
    PHONE_SILVER_E164, PHONE_GOLD_E164, PHONE_PLATINUM_E164
  ]);

  // Delete test customers
  await supabase.from('customers').delete().in('wa', [
    PHONE_SILVER, PHONE_GOLD, PHONE_PLATINUM, PHONE_GUEST, '081299990002', '081299990003', '081299990011', '081299990012'
  ]);
}

async function runTests() {
  const testResults = {};
  await setupTestData();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------
    // TEST 1: Nomor baru, bukan member, tidak login
    // Expected: BOOKING SUCCESS at normal price
    // -------------------------------------------------------------
    console.log('=== TEST 1: Guest non-member, unauthenticated ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Guest Non Member',
          wa: PHONE_GUEST,
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '10:00',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 50000, 'Price must be normal (50000)');
      assert.equal(body.data.original_price, null, 'original_price must be null');
      assert.equal(body.data.discount_label, null, 'discount_label must be null');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 1 (Guest non-member)'] = 'PASS';
      console.log('✓ TEST 1 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 2: Nomor existing member Silver, tidak login
    // Expected: BOOKING SUCCESS, Benefit Silver NOT applied
    // -------------------------------------------------------------
    console.log('=== TEST 2: Existing member Silver, not logged in ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Someone Silver Phone',
          wa: PHONE_SILVER,
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '10:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 50000, 'Price must be normal price (50000)');
      assert.equal(body.data.original_price, null, 'original_price must be null');
      assert.equal(body.data.discount_label, null, 'Silver discount NOT applied');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 2 (Silver not logged in)'] = 'PASS';
      console.log('✓ TEST 2 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 3: Nomor existing member Gold, tidak login
    // Expected: BOOKING SUCCESS, Benefit Gold NOT applied
    // -------------------------------------------------------------
    console.log('=== TEST 3: Existing member Gold, not logged in ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Someone Gold Phone',
          wa: PHONE_GOLD,
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '11:00',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 50000, 'Price must be normal price (50000)');
      assert.equal(body.data.original_price, null, 'original_price must be null');
      assert.equal(body.data.discount_label, null, 'Gold discount NOT applied');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 3 (Gold not logged in)'] = 'PASS';
      console.log('✓ TEST 3 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 4: Nomor existing member Platinum, tidak login
    // Expected: BOOKING SUCCESS, Benefit Platinum NOT applied
    // -------------------------------------------------------------
    console.log('=== TEST 4: Existing member Platinum, not logged in ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Someone Platinum Phone',
          wa: PHONE_PLATINUM,
          service_id: 'gentleman-grooming',
          service: 'Gentleman Grooming',
          price: 95000,
          duration: '60',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '11:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 95000, 'Price must be normal price (95000)');
      assert.equal(body.data.original_price, null, 'original_price must be null');
      assert.equal(body.data.discount_label, null, 'Platinum benefit NOT applied');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 4 (Platinum not logged in)'] = 'PASS';
      console.log('✓ TEST 4 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 5: Member Silver login OTP valid
    // Expected: BOOKING SUCCESS, Eligible Silver birthday benefit applied
    // -------------------------------------------------------------
    console.log('=== TEST 5: Member Silver, logged in with OTP ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN_SILVER}`,
          'x-turnstile-bypass': 'internal-test',
        },
        body: JSON.stringify({
          name: 'Test Member Silver',
          wa: PHONE_SILVER,
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '12:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 25000, '50% birthday discount applied (25000)');
      assert.equal(body.data.original_price, 50000, 'original_price must be 50000');
      assert.equal(body.data.discount_label, 'Diskon Ulang Tahun 50%', 'discount_label must match');
      assert.equal(body.membershipBenefitApplied, true, 'membershipBenefitApplied must be true');
      testResults['TEST 5 (Silver authenticated)'] = 'PASS';
      console.log('✓ TEST 5 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 6: Member Gold login OTP valid
    // Expected: BOOKING SUCCESS, Eligible Gold benefit applied (10%)
    // -------------------------------------------------------------
    console.log('=== TEST 6: Member Gold, logged in with OTP ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN_GOLD}`,
          'x-turnstile-bypass': 'internal-test',
        },
        body: JSON.stringify({
          name: 'Test Member Gold',
          wa: PHONE_GOLD,
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '13:00',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 45000, '10% gold discount applied (45000)');
      assert.equal(body.data.original_price, 50000, 'original_price must be 50000');
      assert.equal(body.data.discount_label, 'Diskon Gold 10%', 'discount_label must match');
      assert.equal(body.membershipBenefitApplied, true, 'membershipBenefitApplied must be true');
      testResults['TEST 6 (Gold authenticated)'] = 'PASS';
      console.log('✓ TEST 6 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 7: Member Platinum login OTP valid
    // Expected: BOOKING SUCCESS, Eligible Platinum benefit applied (free grooming)
    // -------------------------------------------------------------
    console.log('=== TEST 7: Member Platinum, logged in with OTP ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN_PLATINUM}`,
          'x-turnstile-bypass': 'internal-test',
        },
        body: JSON.stringify({
          name: 'Test Member Platinum',
          wa: PHONE_PLATINUM,
          service_id: 'gentleman-grooming',
          service: 'Gentleman Grooming',
          price: 95000,
          duration: '60',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '13:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 0, 'Price must be 0 (Free grooming)');
      assert.equal(body.data.original_price, 95000, 'original_price must be 95000');
      assert.equal(body.data.discount_label, 'Gratis — Benefit Platinum', 'discount_label must match');
      assert.equal(body.membershipBenefitApplied, true, 'membershipBenefitApplied must be true');
      testResults['TEST 7 (Platinum authenticated)'] = 'PASS';
      console.log('✓ TEST 7 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 8: Invalid/expired member session
    // Expected: BOOKING SUCCESS AS GUEST, No member benefit
    // -------------------------------------------------------------
    console.log('=== TEST 8: Expired member session token ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN_EXPIRED}`,
          'x-turnstile-bypass': 'internal-test',
        },
        body: JSON.stringify({
          name: 'Test Member Platinum',
          wa: PHONE_PLATINUM,
          service_id: 'gentleman-grooming',
          service: 'Gentleman Grooming',
          price: 95000,
          duration: '60',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '14:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 95000, 'Price must fallback to normal 95000');
      assert.equal(body.data.original_price, null, 'original_price must be null');
      assert.equal(body.data.discount_label, null, 'discount_label must be null');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 8 (Expired auth -> guest fallback)'] = 'PASS';
      console.log('✓ TEST 8 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 9: Guest tries to manipulate request: discount_label = "Platinum", price = 0
    // Expected: discount rejected/ignored, BOOKING STILL SUCCESS at normal price
    // -------------------------------------------------------------
    console.log('=== TEST 9: Forged discount attempt by guest ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Sneaky Guest',
          wa: '081299990002',
          service_id: 'gentleman-grooming',
          service: 'Gentleman Grooming',
          price: 0, // Tried to forge free price
          discount_label: 'Gratis — Benefit Platinum', // Tried to forge discount label
          duration: '60',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '15:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 95000, 'Price must be enforced to catalog price 95000');
      assert.equal(body.data.discount_label, null, 'discount_label must be ignored/null');
      assert.equal(body.membershipBenefitApplied, false, 'membershipBenefitApplied must be false');
      testResults['TEST 9 (Forged benefit attempt)'] = 'PASS';
      console.log('✓ TEST 9 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 10: Normal guest + add-on
    // Expected: BOOKING SUCCESS
    // -------------------------------------------------------------
    console.log('=== TEST 10: Normal guest + add-on ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Guest With Addon',
          wa: '081299990003',
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 65000, // 50000 base + 15000 addon
          duration: '45',
          notes: 'Add-on: Hair Wash',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '16:30',
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(body.data?.id, 'Booking ID must exist');
      assert.equal(body.data.price, 65000, 'Price reflects service + addon');
      assert.ok(body.data.notes.includes('Add-on: Hair Wash'), 'Notes preserved');
      testResults['TEST 10 (Add-on guest)'] = 'PASS';
      console.log('✓ TEST 10 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 11: Guest group booking
    // Expected: BOOKING SUCCESS (Atomic group booking)
    // -------------------------------------------------------------
    console.log('=== TEST 11: Guest group booking ===');
    {
      const res = await fetch(`${baseUrl}/api/bookings/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          group_request_id: randomUUID(),
          items: [
            {
              name: 'Group Member 1',
              wa: '081299990011',
              service_id: 'haircut-dewasa',
              service: 'Haircut Dewasa',
              price: 50000,
              duration: '30',
              barber_id: TEST_BARBER,
              date: TEST_DATE,
              time: '17:30',
              location: TEST_LOCATION,
              payment: 'cash',
              type: 'outlet',
            },
            {
              name: 'Group Member 2',
              wa: '081299990012',
              service_id: 'haircut-dewasa',
              service: 'Haircut Dewasa',
              price: 50000,
              duration: '30',
              barber_id: TEST_BARBER,
              date: TEST_DATE,
              time: '18:00',
              location: TEST_LOCATION,
              payment: 'cash',
              type: 'outlet',
            },
          ],
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
      assert.equal(body.bookings?.length, 2, 'Must create 2 bookings');
      assert.equal(body.scheduleIds?.length, 2, 'Must create 2 schedules');
      testResults['TEST 11 (Group guest)'] = 'PASS';
      console.log('✓ TEST 11 PASS\n');
    }

    // -------------------------------------------------------------
    // TEST 12: Double booking attempt
    // Expected: Rejected because of SLOT CONFLICT, NOT membership/login
    // -------------------------------------------------------------
    console.log('=== TEST 12: Double booking attempt (slot conflict) ===');
    {
      _resetBuckets();
      // Attempt to book overlapping time on 10:00 (which was booked in TEST 1: 10:00 - 10:30)
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-turnstile-bypass': 'internal-test' },
        body: JSON.stringify({
          name: 'Conflict Attempter',
          wa: '081299990001',
          service_id: 'haircut-dewasa',
          service: 'Haircut Dewasa',
          price: 50000,
          duration: '30',
          barber_id: TEST_BARBER,
          date: TEST_DATE,
          time: '10:15', // Overlaps with 10:00 - 10:30
          location: TEST_LOCATION,
          payment: 'cash',
          type: 'outlet',
          booking_request_id: randomUUID(),
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 409, `Expected 409 conflict, got ${res.status}: ${JSON.stringify(body)}`);
      assert.ok(
        body.error?.includes('jadwal') || body.error?.includes('bentrok') || body.code === 'BOOKING_SLOT_CONFLICT',
        'Rejection reason must be slot conflict'
      );
      assert.notEqual(body.code, 'MEMBER_LOGIN_REQUIRED', 'Must NOT be rejected for membership');
      testResults['TEST 12 (Double booking protection)'] = 'PASS';
      console.log('✓ TEST 12 PASS\n');
    }

    console.log('==============================================');
    console.log('ALL 12 TEST CASES COMPLETED:');
    console.log('==============================================');
    for (const [testName, result] of Object.entries(testResults)) {
      console.log(`${testName}: ${result}`);
    }
  } finally {
    server.close();
    console.log('\nCleaning up test data from Supabase...');
    await cleanupTestData();
    console.log('✓ Cleanup complete.');
  }
}

runTests()
  .then(() => {
    console.log('\nALL TESTS PASSED SUCCESSFULLY.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nTEST SUITE FAILED:', err);
    process.exit(1);
  });
