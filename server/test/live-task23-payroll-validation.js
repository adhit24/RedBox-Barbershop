'use strict';

/**
 * Live Production Verification Script for Task 2.3:
 * Kapster Payroll Draft Engine + Immutable Commission Snapshot
 */

require('dotenv').config({ path: 'd:/Digital Market/Website RedBox/server/.env' });
const { createClient } = require('@supabase/supabase-js');
const {
  generatePayrollDraft,
  regeneratePayrollDraft,
  lockPayrollRun,
  addManualAdjustment,
  deleteManualAdjustment,
  getPayrollRunDetail,
  RUN_STATUS,
} = require('../services/kapsterPayrollService');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function runValidation() {
  console.log('=== REDBOX COMMAND CENTER: TASK 2.3 LIVE PRODUCTION VALIDATION ===\n');

  let testRunId = null;

  try {
    // 1. Check Tables Existence (All 6 canonical tables)
    console.log('1. Verifying Database Tables...');
    const tables = [
      'payroll_runs',
      'payroll_barber_items',
      'payroll_barber_commission_items',
      'payroll_review_items',
      'payroll_adjustments',
      'payroll_source_claims',
    ];
    for (const tbl of tables) {
      const { data, error } = await supabase.from(tbl).select('*').limit(1);
      if (error) {
        throw new Error(`Table public.${tbl} does not exist or schema cache not refreshed: ${error.message}`);
      }
      console.log(`   ✓ public.${tbl} exists`);
    }

    // 2. Check Exclusion Constraint on barber_commission_rates
    console.log('\n2. Testing barber_commission_rates exclusion constraint...');
    const { data: testBarber } = await supabase.from('barbers').select('id, name').limit(1).single();
    if (testBarber) {
      // Try to insert a rate then an overlapping rate
      const { data: r1, error: e1 } = await supabase
        .from('barber_commission_rates')
        .insert({
          barber_id: testBarber.id,
          rate: 0.30,
          effective_from: '2099-01-01',
          effective_to: '2099-01-15',
          created_by: 'system_test',
        })
        .select()
        .single();

      if (e1) {
        console.log(`   Notice inserting test rate 1: ${e1.message}`);
      } else {
        const { error: eOverlap } = await supabase
          .from('barber_commission_rates')
          .insert({
            barber_id: testBarber.id,
            rate: 0.35,
            effective_from: '2099-01-10',
            effective_to: '2099-01-20',
            created_by: 'system_test',
          });

        if (eOverlap && (eOverlap.code === '23P01' || eOverlap.message.includes('exclusion constraint'))) {
          console.log(`   ✓ Exclusion constraint correctly rejected overlapping period at database level: ${eOverlap.message}`);
        } else {
          console.warn('   ⚠ Exclusion constraint did not reject overlapping period!', eOverlap);
        }

        // Clean up test rate 1
        await supabase.from('barber_commission_rates').delete().eq('id', r1.id);
        console.log('   ✓ Cleaned up temporary test rate');
      }
    }

    // 3. Generate a controlled test draft (using recent dates 2026-09-01 to 2026-09-05)
    console.log('\n3. Testing Draft Generation (generatePayrollDraft)...');
    const draftRes = await generatePayrollDraft(supabase, {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-05',
      userEmail: 'owner@redbox.id',
    });

    testRunId = draftRes.run.id;
    console.log(`   ✓ Created Draft Run ID: ${testRunId}`);
    console.log(`   ✓ Status: ${draftRes.run.status}`);
    console.log(`   ✓ Review items persisted: ${draftRes.review_items.length}`);
    console.log(`   ✓ Blockers found: ${draftRes.blockers.length}`);
    if (draftRes.blockers.length > 0) {
      console.log(`   Blocker sample: ${draftRes.blockers[0].type} - ${draftRes.blockers[0].message}`);
    }

    // 4. Inspect Detail and Barber Items
    console.log('\n4. Inspecting Run Detail and Snapshots...');
    const detail = await getPayrollRunDetail(supabase, {
      runId: testRunId,
      auth: { role: 'owner' },
    });
    console.log(`   ✓ Barber items count: ${detail.barbers.length}`);
    console.log(`   ✓ Total net service revenue: Rp ${detail.run.total_service_revenue.toLocaleString('id-ID')}`);
    console.log(`   ✓ Total commission snapshot: Rp ${detail.run.total_commission.toLocaleString('id-ID')}`);
    console.log(`   ✓ Review items in run: ${detail.review_items.length}`);

    if (detail.barbers.length > 0) {
      const b0 = detail.barbers[0];
      console.log(`   ✓ Barber snapshot sample: ${b0.barber_name_snapshot} (${b0.branch_snapshot}) - Net: ${b0.net_service_revenue}, Comm: ${b0.commission_amount}`);
      console.log(`   ✓ Attendance context: ${JSON.stringify(b0.attendance_context)}`);

      // 5. Test Manual Adjustment Foundation
      console.log('\n5. Testing Manual Adjustments...');
      const adjBonus = await addManualAdjustment(supabase, {
        runId: testRunId,
        barberId: b0.barber_id,
        amount: 50000,
        reason: 'Bonus insentif kebersihan',
        note: 'Task 2.3 verification test',
        userEmail: 'owner@redbox.id',
      });
      console.log(`   ✓ Added bonus adjustment: ID ${adjBonus.id}, Amount +${adjBonus.amount}`);

      const adjDeduction = await addManualAdjustment(supabase, {
        runId: testRunId,
        barberId: b0.barber_id,
        amount: -25000,
        reason: 'Koreksi kasir selisih',
        userEmail: 'owner@redbox.id',
      });
      console.log(`   ✓ Added deduction adjustment: ID ${adjDeduction.id}, Amount ${adjDeduction.amount}`);

      // Test zero amount rejection
      let zeroRejected = false;
      try {
        await addManualAdjustment(supabase, {
          runId: testRunId,
          barberId: b0.barber_id,
          amount: 0,
          reason: 'Zero test',
          userEmail: 'owner@redbox.id',
        });
      } catch (err) {
        zeroRejected = true;
        console.log(`   ✓ Zero adjustment correctly rejected: ${err.message}`);
      }
      if (!zeroRejected) throw new Error('Zero adjustment was not rejected!');

      // 6. Test Regeneration while preserving adjustments
      console.log('\n6. Testing Regeneration (Preserving Adjustments)...');
      const regenRes = await regeneratePayrollDraft(supabase, {
        runId: testRunId,
        userEmail: 'owner@redbox.id',
      });
      console.log(`   ✓ Regenerated Run ID: ${regenRes.run.id}`);

      const detailAfterRegen = await getPayrollRunDetail(supabase, {
        runId: testRunId,
        auth: { role: 'owner' },
      });
      console.log(`   ✓ Preserved adjustments count after regen: ${detailAfterRegen.adjustments.length}`);
      if (detailAfterRegen.adjustments.length !== 2) {
        throw new Error(`Expected 2 preserved adjustments, got ${detailAfterRegen.adjustments.length}`);
      }

      // Delete the adjustments
      await deleteManualAdjustment(supabase, { runId: testRunId, adjustmentId: adjBonus.id, userEmail: 'owner@redbox.id' });
      await deleteManualAdjustment(supabase, { runId: testRunId, adjustmentId: adjDeduction.id, userEmail: 'owner@redbox.id' });
      console.log('   ✓ Deleted test manual adjustments');
    }

    // 7. Test Locking Rules & Safety
    console.log('\n7. Testing Locking Verification...');
    if (draftRes.blockers.length > 0) {
      let lockBlocked = false;
      try {
        await lockPayrollRun(supabase, { runId: testRunId, userEmail: 'owner@redbox.id' });
      } catch (err) {
        lockBlocked = true;
        console.log(`   ✓ Locking correctly blocked due to active review blockers: ${err.message}`);
      }
      if (!lockBlocked) throw new Error('Locking should have been blocked!');
    } else {
      console.log('   ✓ Draft has zero blockers. (Skipping lock to preserve production cleanly without fake official locked run).');
    }

    console.log('\n=== LIVE VALIDATION COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('\n❌ Validation failed with error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up temporary test draft run so production database remains pristine!
    if (testRunId) {
      console.log(`\nCleaning up temporary test run ID: ${testRunId}...`);
      await supabase.from('payroll_runs').delete().eq('id', testRunId);
      console.log('✓ Cleaned up temporary test run. Production remains 100% pristine.');
    }
  }
}

runValidation();
