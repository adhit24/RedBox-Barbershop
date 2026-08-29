'use strict';

const fs = require('fs');
const path = require('path');

// Load server/.env manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const { createClient } = require('@supabase/supabase-js');
const { normalizeMemberPhone } = require('../member-identity');
const { planDuplicateReconciliation } = require('../services/customerDuplicateReconciliation');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

async function runAudit() {
  console.log('Connecting to Supabase:', url);

  // 1. Fetch total count of customers
  const { count: totalCustomers, error: countErr } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error('Count error:', countErr);
    process.exit(1);
  }

  console.log('Total customers row count:', totalCustomers);

  // 2. Fetch customers in batches
  let allCustomers = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, wa, phone_e164, moka_customer_id, points, visits, total_spent, first_visit, last_visit, source, membership_status, created_at, updated_at')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error('Fetch error at page', page, error);
      break;
    }
    if (!data || data.length === 0) break;
    allCustomers.push(...data);
    page++;
    if (data.length < pageSize) break;
  }

  console.log('Fetched total customer records:', allCustomers.length);

  // Group by normalized phone
  const phoneGroups = new Map();
  const invalidPhones = [];

  for (const c of allCustomers) {
    const normWa = c.wa ? normalizeMemberPhone(c.wa) : null;
    const normE164 = c.phone_e164 ? normalizeMemberPhone(c.phone_e164) : null;
    const phone = normWa || normE164;

    if (!phone || phone.length < 9) {
      invalidPhones.push(c);
      continue;
    }

    if (!phoneGroups.has(phone)) {
      phoneGroups.set(phone, []);
    }
    phoneGroups.get(phone).push(c);
  }

  // Filter duplicate groups (> 1 distinct row)
  const dupGroups = [];
  for (const [phone, rows] of phoneGroups.entries()) {
    if (rows.length > 1) {
      dupGroups.push({ phone, rows });
    }
  }

  console.log('Duplicate normalized phone groups count:', dupGroups.length);

  const totalDupRows = dupGroups.reduce((sum, g) => sum + g.rows.length, 0);
  console.log('Total customer rows involved in duplicates:', totalDupRows);

  // Fetch all member profiles
  let allMemberProfiles = [];
  page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('member_profiles')
      .select('id, user_key, phone, full_name, total_points, membership_status, created_at')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) {
      console.error('Member profiles fetch error at page', page, error);
      break;
    }
    if (!data || data.length === 0) break;
    allMemberProfiles.push(...data);
    page++;
    if (data.length < pageSize) break;
  }

  console.log('Fetched member_profiles count:', allMemberProfiles.length);

  const profilePhoneMap = new Map();
  for (const p of allMemberProfiles) {
    const norm = p.phone ? normalizeMemberPhone(p.phone) : null;
    if (norm) {
      if (!profilePhoneMap.has(norm)) profilePhoneMap.set(norm, []);
      profilePhoneMap.get(norm).push(p);
    }
  }

  // Collect all customer IDs involved in duplicate groups
  const dupCustomerIds = dupGroups.flatMap(g => g.rows.map(r => r.id));

  // Check transactions linked to these duplicate customer IDs
  const txByCustId = new Map();
  const chunkSize = 80;
  for (let i = 0; i < dupCustomerIds.length; i += chunkSize) {
    const chunk = dupCustomerIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('transactions')
      .select('id, customer_id, total_amount, status')
      .in('customer_id', chunk);
    if (error) {
      console.error('Tx query error at chunk', i, error.message);
    } else if (data) {
      for (const t of data) {
        if (!txByCustId.has(t.customer_id)) txByCustId.set(t.customer_id, []);
        txByCustId.get(t.customer_id).push(t);
      }
    }
  }

  // Check bookings linked to duplicate customer IDs
  const bkByCustId = new Map();
  for (let i = 0; i < dupCustomerIds.length; i += chunkSize) {
    const chunk = dupCustomerIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('bookings')
      .select('id, customer_id, status')
      .in('customer_id', chunk);
    if (error) {
      console.error('Bk query error at chunk', i, error.message);
    } else if (data) {
      for (const b of data) {
        if (!bkByCustId.has(b.customer_id)) bkByCustId.set(b.customer_id, []);
        bkByCustId.get(b.customer_id).push(b);
      }
    }
  }

  // Execute Dry-Run Planner on all duplicate groups
  let catA = 0; // safe_auto_merge
  let catB = 0; // deterministic_reconciliation
  let catC = 0; // manual_review
  let catD = 0; // invalid_identity
  let unresolved = 0;

  let totalRetiredRows = 0;
  let totalTxMoved = 0;
  let totalBkMoved = 0;
  let totalProfilesAffected = 0;
  let totalGroupsRecomputed = 0;
  let totalBlockedMembership = 0;
  let totalBlockedName = 0;
  let totalBlockedMoka = 0;

  for (const g of dupGroups) {
    const custIds = g.rows.map(r => r.id);
    const groupTxs = custIds.flatMap(id => txByCustId.get(id) || []);
    const groupBks = custIds.flatMap(id => bkByCustId.get(id) || []);
    const groupProfiles = profilePhoneMap.get(g.phone) || [];

    const plan = planDuplicateReconciliation({
      phone: g.phone,
      rows: g.rows,
      memberProfiles: groupProfiles,
      transactions: groupTxs,
      bookings: groupBks,
    });

    if (plan.group_status === 'safe_auto_merge') catA++;
    else if (plan.group_status === 'deterministic_reconciliation') catB++;
    else if (plan.group_status === 'manual_review') catC++;
    else if (plan.group_status === 'invalid_identity') catD++;
    else unresolved++;

    if (plan.canonical_customer_id) {
      totalRetiredRows += plan.alias_customer_ids.length;
      totalTxMoved += plan.reference_plan.transactions.count;
      totalBkMoved += plan.reference_plan.bookings.count;
      if (groupProfiles.length > 0) totalProfilesAffected += groupProfiles.length;
      if (plan.group_status === 'deterministic_reconciliation') totalGroupsRecomputed++;
    }

    if (plan.conflicts.includes('multiple_authoritative_memberships')) totalBlockedMembership++;
    if (plan.conflicts.includes('conflicting_customer_names')) totalBlockedName++;
    if (plan.conflicts.includes('multiple_distinct_moka_customer_ids')) totalBlockedMoka++;
  }

  console.log('\n=== RECALCULATED PRODUCTION DRY-RUN RESULTS ===');
  console.log('Category A (safe_auto_merge):', catA);
  console.log('Category B (deterministic_reconciliation):', catB);
  console.log('Category C (manual_review):', catC);
  console.log('Category D (invalid_identity):', catD);
  console.log('Unresolved groups:', unresolved);
  console.log('Total customer rows that would be retired:', totalRetiredRows);
  console.log('Total transaction references that would move:', totalTxMoved);
  console.log('Total booking references that would move:', totalBkMoved);
  console.log('Total member_profile relationships affected:', totalProfilesAffected);
  console.log('Total groups requiring recomputation:', totalGroupsRecomputed);
  console.log('Total groups blocked by membership conflict:', totalBlockedMembership);
  console.log('Total groups blocked by name conflict:', totalBlockedName);
  console.log('Total groups blocked by Moka ID conflict:', totalBlockedMoka);
}

runAudit().catch(err => console.error(err));
