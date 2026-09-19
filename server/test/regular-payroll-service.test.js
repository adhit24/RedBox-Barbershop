'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config({ path: 'server/.env' });
const { createClient } = require('@supabase/supabase-js');
const {
  generateRegularPayrollDraft,
  getRegularPayrollRunDetail,
  addRegularPayrollAdjustment,
  deleteRegularPayrollAdjustment,
  lockRegularPayrollRun,
} = require('../services/regularPayrollService');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

test('End-to-End Regular Payroll Lifecycle (Draft -> Adjustment -> Lock -> Immutability)', async () => {
  let createdRunId = null;

  try {
    // 1. Generate Draft
    const periodStart = '2026-08-26';
    const periodEnd = '2026-09-25';

    console.log('Generating test regular payroll draft...');
    const genRes = await generateRegularPayrollDraft(supabase, {
      periodStart,
      periodEnd,
      businessUnit: 'ALL',
      userEmail: 'test-admin@redbox.id',
    });

    assert.equal(genRes.success, true);
    assert.equal(genRes.status, 'DRAFT');
    assert.ok(genRes.run_id);
    createdRunId = genRes.run_id;

    // 2. Fetch Detail
    const detail = await getRegularPayrollRunDetail(supabase, { runId: createdRunId });
    assert.equal(detail.run.id, createdRunId);
    assert.equal(detail.run.status, 'DRAFT');
    assert.ok(detail.items.length >= 30, 'Should have regular employees');

    const firstItem = detail.items[0];
    const initialTakeHome = Number(firstItem.take_home_pay);
    console.log(`First item: ${firstItem.employee_name_snapshot}, initial take-home: ${initialTakeHome}`);

    // 3. Add Manual Adjustment (DEBT of 100,000)
    const adjRes = await addRegularPayrollAdjustment(supabase, {
      runId: createdRunId,
      payrollRegularItemId: firstItem.id,
      employeeId: firstItem.employee_id,
      type: 'DEBT',
      amount: 100000,
      reason: 'Kasbon test lifecycle',
      userEmail: 'test-admin@redbox.id',
    });

    assert.equal(adjRes.success, true);
    const adjId = adjRes.adjustment.id;

    // Re-fetch detail to verify item recalculation
    const updatedDetail = await getRegularPayrollRunDetail(supabase, { runId: createdRunId });
    const updatedItem = updatedDetail.items.find(it => it.id === firstItem.id);
    assert.equal(Number(updatedItem.debt_deduction), 100000);
    assert.equal(Number(updatedItem.take_home_pay), initialTakeHome - 100000);
    console.log(`After DEBT: new take-home: ${updatedItem.take_home_pay} (expected: ${initialTakeHome - 100000})`);

    // 4. Lock the run
    console.log('Locking regular payroll run...');
    const lockRes = await lockRegularPayrollRun(supabase, {
      runId: createdRunId,
      userEmail: 'test-admin@redbox.id',
    });
    assert.equal(lockRes.status, 'LOCKED');

    // 5. Verify Immutability: Mutating an item after lock MUST FAIL
    let mutationRejected = false;
    try {
      await supabase
        .from('payroll_regular_items')
        .update({ base_salary: 9999999 })
        .eq('id', firstItem.id);
      // If no error, check if trigger raised error
    } catch (e) {
      mutationRejected = true;
    }

    const { error: postLockUpdateErr } = await supabase
      .from('payroll_regular_items')
      .update({ base_salary: 9999999 })
      .eq('id', firstItem.id);

    assert.ok(postLockUpdateErr, 'Database trigger must reject update on locked regular payroll item');
    assert.match(postLockUpdateErr.message, /LOCKED/);
    console.log('Immutability verified: update on locked item correctly rejected.');

    // 6. Verify Immutability: Adding adjustment after lock MUST FAIL
    const { error: postLockAdjErr } = await supabase
      .from('payroll_adjustments')
      .insert({
        payroll_run_id: createdRunId,
        payroll_regular_item_id: firstItem.id,
        employee_id: firstItem.employee_id,
        type: 'BONUS',
        amount: 50000,
        reason: 'Late bonus',
        created_by: 'test@test.com',
      });
    assert.ok(postLockAdjErr, 'Database trigger must reject adjustment on locked run');
    assert.match(postLockAdjErr.message, /LOCKED/);

  } finally {
    // Cleanup: In a locked state, unlock/delete for clean teardown of test run
    if (createdRunId) {
      console.log(`Cleaning up test run ${createdRunId}...`);
      // Temporarily mark status as DRAFT to clean up test run
      await supabase.from('payroll_runs').update({ status: 'DRAFT' }).eq('id', createdRunId);
      await supabase.from('payroll_runs').delete().eq('id', createdRunId);
    }
  }
});
