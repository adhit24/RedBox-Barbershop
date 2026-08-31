'use strict';

/**
 * Task 17.3 — Production Audit Script (READ ONLY ONLY).
 *
 * Audits Supabase production DB (khcvklzxfohwkyocenaf) for:
 *   1. Global duplicate moka_customer_id in customers table
 *   2. Transaction-subset duplicate moka_customer_id metrics
 *   3. Transactions customer_id attribution breakdown & canonical link estimate
 *
 * NO DATABASE MUTATIONS OR UPDATES PERMITTED.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { resolveTransactionCustomerLinkage, PROVENANCE } = require('../services/transactionCustomerLinkage');

function loadEnvFile() {
  const envPaths = ['.env.local', '.env.prod.local', '.env'];
  for (const envFile of envPaths) {
    const fullPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
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
  }
}

async function runProductionAudit() {
  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;



  if (!supabaseUrl || !supabaseKey) {
    console.error('[Audit] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables required.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('==================================================');
  console.log('TASK 17.3 — PRODUCTION CRM TRANSACTION LINKAGE AUDIT');
  console.log('Target DB:', supabaseUrl);
  console.log('==================================================\n');

  // ── 1. GLOBAL MOKA CUSTOMER ID DUPLICATE AUDIT ──────────────────────────────
  console.log('--- 1. GLOBAL CUSTOMERS MOKA_CUSTOMER_ID DUPLICATE AUDIT ---');
  let { data: mokaCustRows, error: mokaErr } = await supabase
    .from('customers')
    .select('id, moka_customer_id')
    .not('moka_customer_id', 'is', null);

  if (mokaErr) {
    console.error('Error querying customers by moka_customer_id:', mokaErr.message);
    mokaCustRows = [];
  }

  const mokaMap = new Map(); // moka_id -> array of customer UUIDs
  for (const row of mokaCustRows || []) {
    const mId = String(row.moka_customer_id).trim();
    if (!mId) continue;
    if (!mokaMap.has(mId)) mokaMap.set(mId, []);
    mokaMap.get(mId).push(row.id);
  }

  let globalDuplicateMokaCount = 0;
  let globalDuplicateCustomerRowsCount = 0;
  const duplicateMokaIds = new Set();

  for (const [mId, custIds] of mokaMap.entries()) {
    if (custIds.length > 1) {
      globalDuplicateMokaCount++;
      globalDuplicateCustomerRowsCount += custIds.length;
      duplicateMokaIds.add(mId);
    }
  }

  console.log(`Global distinct moka_customer_id values: ${mokaMap.size}`);
  console.log(`Global duplicate moka_customer_id count (values with >1 rows): ${globalDuplicateMokaCount}`);
  console.log(`Global customer rows involved in duplicates: ${globalDuplicateCustomerRowsCount}\n`);

  // ── 2. TRANSACTIONS AUDIT & CANONICAL ESTIMATE ──────────────────────────────
  console.log('--- 2. TRANSACTIONS ATTRUBUTION & CANONICAL ESTIMATE ---');
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('id, customer_id, external_id, source, moka_payload');

  if (txErr) {
    console.error('Error querying transactions:', txErr.message);
    return;
  }

  const totalTransactions = txRows ? txRows.length : 0;
  let alreadyLinkedCount = 0;
  let customerIdNullCount = 0;

  let txRelevantDuplicateMokaCount = 0;
  let txRowsAffectedByAmbiguousMoka = 0;
  const txReferencedMokaIds = new Set();

  const estimateCounts = {
    safe_link_unique_moka: 0,
    safe_link_unique_phone: 0,
    ambiguous_moka: 0,
    ambiguous_phone: 0,
    not_found: 0,
    invalid: 0,
    lookup_failed: 0,
    linked_existing_authoritative: 0,
  };

  for (const tx of txRows || []) {
    if (tx.customer_id) {
      alreadyLinkedCount++;
    } else {
      customerIdNullCount++;
    }

    const payload = tx.moka_payload || {};
    const mokaCustId = String(payload.customer_id || payload.customer?.id || '').trim();
    const phone = String(payload.customer_phone || payload.customer?.phone_number || '').trim();

    if (mokaCustId) {
      txReferencedMokaIds.add(mokaCustId);
      if (duplicateMokaIds.has(mokaCustId)) {
        txRowsAffectedByAmbiguousMoka++;
      }
    }

    // Run canonical linkage resolution estimate
    const plan = await resolveTransactionCustomerLinkage(supabase, {
      transaction: { id: tx.id, customer_id: tx.customer_id },
      provenance: tx.source === 'web' || tx.source === 'checkout_api' ? PROVENANCE.VERIFIED_REDBOX_FK : PROVENANCE.NONE,
      mokaCustomerId: mokaCustId || null,
      phone: phone || null,
      sourceSystem: 'audit',
    });

    if (estimateCounts[plan.status] !== undefined) {
      estimateCounts[plan.status]++;
    }
  }

  for (const mId of txReferencedMokaIds) {
    if (duplicateMokaIds.has(mId)) {
      txRelevantDuplicateMokaCount++;
    }
  }

  console.log(`Total transactions in database: ${totalTransactions}`);
  console.log(`Already linked (customer_id NOT NULL): ${alreadyLinkedCount}`);
  console.log(`Unlinked (customer_id IS NULL): ${customerIdNullCount}`);
  console.log(`Transaction-relevant duplicate moka_customer_id count: ${txRelevantDuplicateMokaCount}`);
  console.log(`Transaction rows affected by ambiguous Moka ownership: ${txRowsAffectedByAmbiguousMoka}\n`);

  console.log('--- CANONICAL ESTIMATE BREAKDOWN ---');
  console.log(`  linked_existing_authoritative: ${estimateCounts.linked_existing_authoritative}`);
  console.log(`  safe_link_unique_moka:         ${estimateCounts.safe_link_unique_moka}`);
  console.log(`  safe_link_unique_phone:        ${estimateCounts.safe_link_unique_phone}`);
  console.log(`  ambiguous_moka:                ${estimateCounts.ambiguous_moka}`);
  console.log(`  ambiguous_phone:               ${estimateCounts.ambiguous_phone}`);
  console.log(`  not_found:                     ${estimateCounts.not_found}`);
  console.log(`  invalid:                       ${estimateCounts.invalid}`);
  console.log(`  lookup_failed:                 ${estimateCounts.lookup_failed}\n`);

  console.log('==================================================');
  console.log('AUDIT COMPLETE — ZERO MUTATIONS PERFORMED');
  console.log('==================================================');
}

if (require.main === module) {
  runProductionAudit().catch(err => {
    console.error('Audit fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runProductionAudit };
