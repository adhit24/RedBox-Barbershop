'use strict';

/**
 * Task 17.3 — Historical Transaction Linkage Backfill Dry-Run Planner.
 *
 * READ-ONLY PLANNER — ZERO DATABASE WRITES PERMITTED.
 *
 * Evaluates historical transaction rows against canonical transactionCustomerLinkage
 * service and reports dry-run classification counts.
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

async function runDryRunPlanner() {
  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;



  if (!supabaseUrl || !supabaseKey) {
    console.error('[DryRun] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('==================================================');
  console.log('TASK 17.3 — HISTORICAL TRANSACTION LINKAGE DRY-RUN PLANNER');
  console.log('Target DB:', supabaseUrl);
  console.log('==================================================\n');

  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('id, customer_id, source, moka_payload');

  if (error) {
    console.error('[DryRun] Error fetching transactions:', error.message);
    return;
  }

  const summary = {
    total_processed: transactions ? transactions.length : 0,
    already_linked: 0,
    safe_link_existing_authoritative: 0,
    safe_link_unique_moka: 0,
    safe_link_unique_phone: 0,
    ambiguous: 0,
    not_found: 0,
    invalid: 0,
    lookup_failed: 0,
  };

  for (const tx of transactions || []) {
    const payload = tx.moka_payload || {};
    const mokaCustId = String(payload.customer_id || payload.customer?.id || '').trim();
    const phone = String(payload.customer_phone || payload.customer?.phone_number || '').trim();

    const plan = await resolveTransactionCustomerLinkage(supabase, {
      transaction: { id: tx.id, customer_id: tx.customer_id },
      provenance: tx.source === 'web' || tx.source === 'checkout_api' ? PROVENANCE.VERIFIED_REDBOX_FK : PROVENANCE.NONE,
      mokaCustomerId: mokaCustId || null,
      phone: phone || null,
      sourceSystem: 'dry_run_planner',
    });

    if (tx.customer_id && plan.status === 'linked_existing_authoritative') {
      summary.already_linked++;
      summary.safe_link_existing_authoritative++;
    } else if (plan.status === 'linked_unique_moka') {
      summary.safe_link_unique_moka++;
    } else if (plan.status === 'linked_unique_phone') {
      summary.safe_link_unique_phone++;
    } else if (plan.status === 'ambiguous_moka' || plan.status === 'ambiguous_phone') {
      summary.ambiguous++;
    } else if (plan.status === 'not_found') {
      summary.not_found++;
    } else if (plan.status === 'invalid') {
      summary.invalid++;
    } else if (plan.status === 'lookup_failed') {
      summary.lookup_failed++;
    }
  }

  console.log('--- HISTORICAL BACKFILL DRY-RUN PLANNER SUMMARY ---');
  console.log(`Total transactions evaluated:           ${summary.total_processed}`);
  console.log(`Already linked:                          ${summary.already_linked}`);
  console.log(`Safe link (existing authoritative FK):  ${summary.safe_link_existing_authoritative}`);
  console.log(`Safe link (unique Moka ID):              ${summary.safe_link_unique_moka}`);
  console.log(`Safe link (unique Phone):                ${summary.safe_link_unique_phone}`);
  console.log(`Ambiguous (duplicate Moka/Phone):        ${summary.ambiguous}`);
  console.log(`Not found:                               ${summary.not_found}`);
  console.log(`Invalid:                                 ${summary.invalid}`);
  console.log(`Lookup failed:                           ${summary.lookup_failed}\n`);

  console.log('==================================================');
  console.log('DRY-RUN PLANNER COMPLETE — ZERO WRITES PERFORMED');
  console.log('==================================================');

  return summary;
}

if (require.main === module) {
  runDryRunPlanner().catch(err => {
    console.error('Dry-run planner fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runDryRunPlanner };
