'use strict';

/**
 * Concurrency regression tests for the Regular Payroll serialization protocol.
 *
 * No PostgreSQL is available to the test runner, so these tests execute a faithful MODEL of the protocol
 * implemented in supabase/migrations/20260921*_serialize_regular_payroll_mutations.sql:
 *
 *   sync object   = the payroll_runs row
 *   lock RPC      = SELECT ... FOR UPDATE  (exclusive) on the run, THEN validates with fresh reads
 *   every writer  = SELECT ... FOR SHARE   on the covering DRAFT run(s) in id order BEFORE writing
 *                   (BEFORE ROW triggers on approvals / attendance overtime / items / adjustments)
 *   PostgreSQL lock rules modelled: SHARE is compatible with SHARE, conflicts with EXCLUSIVE; a waiting
 *   EXCLUSIVE request queues behind current holders and later SHARE requests queue behind it (FIFO);
 *   under READ COMMITTED every statement after the lock is granted sees everything committed before.
 *
 * The lock validations run the real service-side mirror of the RPC invariants
 * (evaluateOvertimeLockInvariants). The migration text itself is asserted structurally in
 * payroll-lock-migration.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateOvertimeLockInvariants } = require('../services/regularPayrollService');

class RowLock {
  constructor() { this.holders = new Map(); this.queue = []; }
  compatible(txn, mode) {
    const others = [...this.holders.entries()].filter(([t]) => t !== txn);
    if (mode === 'X') return others.length === 0;
    return others.every(([, m]) => m === 'S');
  }
  acquire(txn, mode) {
    return new Promise((resolve) => {
      this.queue.push({ txn, mode, resolve });
      this.grant();
    });
  }
  grant() {
    while (this.queue.length) {
      const head = this.queue[0];
      if (!this.compatible(head.txn, head.mode)) break; // FIFO: nobody jumps a waiting request
      this.queue.shift();
      this.holders.set(head.txn, head.mode);
      head.resolve();
    }
  }
  release(txn) { this.holders.delete(txn); this.grant(); }
}

const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { wait: p, open }; };
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms = 1500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('DEADLOCK/HANG')), ms))]);

/** committed database state; writes become visible at commit (= lock release) */
function freshDb() {
  return {
    run: { id: 'R1', status: 'DRAFT' },
    attendance: [{ employee_id: 'e1', attendance_date: '2026-09-02', overtime_minutes: 60 }],
    approvals: [{ employee_id: 'e1', attendance_date: '2026-09-02', raw_overtime_minutes: 60, approved_overtime_minutes: 60, status: 'APPROVED' }],
    item: { employee_id: 'e1', employee_name_snapshot: 'E1', overtime_hours: 1, attendance_summary: { approved_overtime_minutes: 60 } },
  };
}
const validate = (db) => evaluateOvertimeLockInvariants({ items: [db.item], approvals: db.approvals, attendanceRows: db.attendance });

// ---- transactions -------------------------------------------------------------------------------
/** approval writer: BEFORE-trigger SHARE lock -> (status re-read) -> write -> commit */
async function approvalWriter(db, lock, name, { hold, apply }) {
  await lock.acquire(name, 'S');
  if (db.run.status === 'LOCKED') { lock.release(name); return 'REJECTED_LOCKED'; } // trigger raises: run is LOCKED
  if (hold) await hold.wait;                                                        // still holding SHARE
  apply(db);                                                                         // row written
  lock.release(name);                                                                // commit
  return 'COMMITTED';
}
/** attendance-source writer: same lock, but writes are not refused after the lock */
async function attendanceWriter(db, lock, name, { hold, apply }) {
  await lock.acquire(name, 'S');
  if (hold) await hold.wait;
  apply(db);
  lock.release(name);
  return 'COMMITTED';
}
/** lock_payroll_run: FOR UPDATE first, then fresh validation, then commit */
async function lockRpc(db, lock, name, { serialize = true, beforeCommit } = {}) {
  if (serialize) await lock.acquire(name, 'X');
  const violation = validate(db);                    // reads committed state as of now
  if (violation) { if (serialize) lock.release(name); return 'REJECTED:' + violation.code; }
  if (beforeCommit) await beforeCommit.wait;         // window between validation and commit
  db.run.status = 'LOCKED';
  if (serialize) lock.release(name);
  return 'LOCKED';
}

test('Model sanity: consistent state locks', async () => {
  const db = freshDb();
  assert.equal(await lockRpc(db, new RowLock(), 'L'), 'LOCKED');
});

test('CONTROL (no protocol): validation-then-commit window lets a concurrent approval change be frozen stale', async () => {
  const db = freshDb();
  const window = gate();
  const L = lockRpc(db, null, 'L', { serialize: false, beforeCommit: window });
  await tick();
  // an approval edit commits inside the window because nothing serializes it with the lock
  db.approvals[0].approved_overtime_minutes = 120;
  window.open();
  assert.equal(await L, 'LOCKED');
  assert.equal(db.run.status, 'LOCKED');
  assert.notEqual(db.approvals[0].approved_overtime_minutes * 1, db.item.attendance_summary.approved_overtime_minutes,
    'this is the frozen-stale bug the protocol must prevent');
});

test('Approval starts first -> the lock waits, then rejects the stale snapshot (never freezes it)', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const hold = gate();
  const A = approvalWriter(db, lock, 'A', { hold, apply: (d) => { d.approvals[0].approved_overtime_minutes = 120; } });
  await tick();
  const L = lockRpc(db, lock, 'L');
  await tick();
  assert.equal(db.run.status, 'DRAFT', 'lock is still waiting behind the approval');
  hold.open();

  assert.equal(await withTimeout(A), 'COMMITTED');
  assert.equal(await withTimeout(L), 'REJECTED:OVERTIME_SNAPSHOT_STALE');
  assert.equal(db.run.status, 'DRAFT');
});

test('Lock starts first -> the approval cannot mutate locked payroll and stays unchanged', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const window = gate();
  const L = lockRpc(db, lock, 'L', { beforeCommit: window });
  await tick();
  const A = approvalWriter(db, lock, 'A', { apply: (d) => { d.approvals[0].approved_overtime_minutes = 120; } });
  await tick();
  window.open();

  assert.equal(await withTimeout(L), 'LOCKED');
  assert.equal(await withTimeout(A), 'REJECTED_LOCKED');
  assert.equal(db.approvals[0].approved_overtime_minutes, 60, 'approval untouched');
  assert.equal(db.item.attendance_summary.approved_overtime_minutes, 60, 'frozen snapshot still equals the approvals');
});

test('Attendance source update starts first -> the lock waits, then rejects (source no longer matches the approval)', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const hold = gate();
  const S = attendanceWriter(db, lock, 'S', { hold, apply: (d) => { d.attendance[0].overtime_minutes = 0; } });
  await tick();
  const L = lockRpc(db, lock, 'L');
  await tick();
  hold.open();

  assert.equal(await withTimeout(S), 'COMMITTED');
  assert.equal(await withTimeout(L), 'REJECTED:OVERTIME_SOURCE_MISMATCH');
  assert.equal(db.run.status, 'DRAFT');
});

test('Unsynced attendance overtime committed before the lock -> lock rejects (no reviewed approval)', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const hold = gate();
  const S = attendanceWriter(db, lock, 'S', { hold, apply: (d) => { d.attendance.push({ employee_id: 'e1', attendance_date: '2026-09-03', overtime_minutes: 90 }); } });
  await tick();
  const L = lockRpc(db, lock, 'L');
  await tick();
  hold.open();
  await withTimeout(S);
  assert.equal(await withTimeout(L), 'REJECTED:UNREVIEWED_ATTENDANCE_OVERTIME');
});

test('Lock starts first -> a source update waits, then applies without altering the frozen payroll', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const window = gate();
  const L = lockRpc(db, lock, 'L', { beforeCommit: window });
  await tick();
  const S = attendanceWriter(db, lock, 'S', { apply: (d) => { d.attendance[0].overtime_minutes = 0; } });
  await tick();
  assert.equal(db.attendance[0].overtime_minutes, 60, 'source write is waiting behind the lock');
  window.open();

  assert.equal(await withTimeout(L), 'LOCKED');
  assert.equal(await withTimeout(S), 'COMMITTED');
  assert.equal(db.run.status, 'LOCKED');
  assert.equal(db.item.attendance_summary.approved_overtime_minutes, 60, 'frozen snapshot unchanged (immutable)');
});

test('Writers do not block each other (SHARE is compatible with SHARE)', async () => {
  const db = freshDb();
  const lock = new RowLock();
  const h1 = gate();
  const h2 = gate();
  const W1 = approvalWriter(db, lock, 'W1', { hold: h1, apply: () => {} });
  const W2 = attendanceWriter(db, lock, 'W2', { hold: h2, apply: () => {} });
  await tick();
  assert.equal(lock.holders.size, 2, 'both hold SHARE concurrently');
  h1.open(); h2.open();
  assert.equal(await withTimeout(W1), 'COMMITTED');
  assert.equal(await withTimeout(W2), 'COMMITTED');
});

test('No deadlock: writers take run locks in id order while an RPC holds the later run', async () => {
  const locks = { R1: new RowLock(), R2: new RowLock() };
  // RPC locks R2 exclusively; a writer covering both runs takes R1 then R2 (ORDER BY id), waits on R2 only
  const windowL = gate();
  const L = (async () => { await locks.R2.acquire('L', 'X'); await windowL.wait; locks.R2.release('L'); return 'LOCKED'; })();
  await tick();
  const W = (async () => { for (const id of ['R1', 'R2']) await locks[id].acquire('W', 'S'); for (const id of ['R2', 'R1']) locks[id].release('W'); return 'DONE'; })();
  await tick();
  // an RPC on R1 needs R1 exclusively: it waits for the writer, and the writer only waits for the RPC on R2
  const L1 = (async () => { await locks.R1.acquire('L1', 'X'); locks.R1.release('L1'); return 'LOCKED1'; })();
  windowL.open();
  assert.equal(await withTimeout(L), 'LOCKED');
  assert.equal(await withTimeout(W), 'DONE');
  assert.equal(await withTimeout(L1), 'LOCKED1');
});

// ---------------------------------------------------------------------------------------------
// Adjustments: the adjustment write and its snapshot follow-up are separate steps; the lock must never
// freeze between them (dirty marker written in the SAME transaction + lock-time aggregate check).
// ---------------------------------------------------------------------------------------------
const { evaluateAdjustmentLockInvariants } = require('../services/regularPayrollService');

function adjDb() {
  return {
    run: { id: 'R1', status: 'DRAFT' },
    adjustments: [],
    item: { id: 'i1', employee_id: 'e1', employee_name_snapshot: 'E1', manual_bonus: 0, debt_deduction: 0, manual_deduction: 0, adjustments_total: 0, attendance_summary: {} },
  };
}
const validateAdj = (db) => evaluateAdjustmentLockInvariants({ items: [db.item], adjustments: db.adjustments });

/** adjustment writer: SHARE lock (check_payroll_run_not_locked), write + dirty marker in ONE commit */
async function adjustmentWriter(db, lock, name, { hold, apply }) {
  await lock.acquire(name, 'S');
  if (db.run.status === 'LOCKED') { lock.release(name); return 'REJECTED_LOCKED'; }
  if (hold) await hold.wait;
  apply(db);
  db.item.attendance_summary = { ...db.item.attendance_summary, adjustments_dirty: true }; // trg_payroll_adjustment_mark_dirty
  lock.release(name);
  return 'COMMITTED';
}
async function adjLockRpc(db, lock, name) {
  await lock.acquire(name, 'X');
  const v = validateAdj(db);
  if (v) { lock.release(name); return 'REJECTED:' + v.code; }
  db.run.status = 'LOCKED';
  lock.release(name);
  return 'LOCKED';
}
/** the Node recalculation that follows (runs later, its own transaction) */
async function recalcAdj(db, lock) {
  await lock.acquire('RECALC', 'S');
  if (db.run.status === 'LOCKED') { lock.release('RECALC'); return 'REJECTED_LOCKED'; }
  const bonus = db.adjustments.reduce((s, a) => s + a.amount, 0);
  db.item = { ...db.item, manual_bonus: bonus, adjustments_total: bonus, attendance_summary: {} }; // dirty cleared
  lock.release('RECALC');
  return 'RECALCULATED';
}

test('Adjustment insert committed, recalculation pending -> the lock (starting in between) is rejected; after recalc it locks', async () => {
  const db = adjDb();
  const lock = new RowLock();
  assert.equal(await withTimeout(adjustmentWriter(db, lock, 'A', { apply: (d) => d.adjustments.push({ payroll_regular_item_id: 'i1', type: 'BONUS', amount: 50000 }) })), 'COMMITTED');
  // owner locks BEFORE the recalculation transaction runs
  assert.equal(await withTimeout(adjLockRpc(db, lock, 'L')), 'REJECTED:ADJUSTMENT_SNAPSHOT_STALE');
  assert.equal(db.run.status, 'DRAFT');
  assert.equal(await withTimeout(recalcAdj(db, lock)), 'RECALCULATED');
  assert.equal(await withTimeout(adjLockRpc(db, lock, 'L2')), 'LOCKED');
});

test('Adjustment delete committed, recalculation pending -> lock rejected; after recalc it locks', async () => {
  const db = adjDb();
  db.adjustments.push({ payroll_regular_item_id: 'i1', type: 'BONUS', amount: 50000 });
  db.item = { ...db.item, manual_bonus: 50000, adjustments_total: 50000 };
  const lock = new RowLock();
  assert.equal(await withTimeout(adjustmentWriter(db, lock, 'A', { apply: (d) => { d.adjustments.length = 0; } })), 'COMMITTED');
  assert.equal(await withTimeout(adjLockRpc(db, lock, 'L')), 'REJECTED:ADJUSTMENT_SNAPSHOT_STALE');
  assert.equal(await withTimeout(recalcAdj(db, lock)), 'RECALCULATED');
  assert.equal(db.item.manual_bonus, 0);
  assert.equal(await withTimeout(adjLockRpc(db, lock, 'L2')), 'LOCKED');
});

test('Lock first -> an adjustment write waits and is refused; the frozen payroll is unchanged', async () => {
  const db = adjDb();
  const lock = new RowLock();
  const L = adjLockRpc(db, lock, 'L');
  const A = adjustmentWriter(db, lock, 'A', { apply: (d) => d.adjustments.push({ payroll_regular_item_id: 'i1', type: 'BONUS', amount: 1 }) });
  assert.equal(await withTimeout(L), 'LOCKED');
  assert.equal(await withTimeout(A), 'REJECTED_LOCKED');
  assert.deepEqual(db.adjustments, []);
});

test('Adjustment writer holding SHARE makes the lock wait; the lock then sees the dirty snapshot', async () => {
  const db = adjDb();
  const lock = new RowLock();
  const hold = gate();
  const A = adjustmentWriter(db, lock, 'A', { hold, apply: (d) => d.adjustments.push({ payroll_regular_item_id: 'i1', type: 'DEBT', amount: 10 }) });
  await tick();
  const L = adjLockRpc(db, lock, 'L');
  await tick();
  assert.equal(db.run.status, 'DRAFT');
  hold.open();
  assert.equal(await withTimeout(A), 'COMMITTED');
  assert.equal(await withTimeout(L), 'REJECTED:ADJUSTMENT_SNAPSHOT_STALE');
});
