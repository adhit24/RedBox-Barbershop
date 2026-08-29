'use strict';

/**
 * Correction Round 1 — Blocker 2 (branch access is not scoped) and
 * Correction 3 (priority sort is lexical, not deterministic business order).
 *
 * Branch authority follows the same model already enforced for stock
 * transfers in routes/stockist.js (access.role === 'manager' && access.branch):
 * owner is always global; a manager is scoped to access.branch only when one
 * is actually assigned, otherwise global; branch_admin is always strictly
 * scoped to access.branch. access.branch always comes from the verified
 * admin session (never request input).
 */

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

const { createHumanHandoffRoutes, resolveHandoffBranchScope } = require('../routes/humanHandoff');
const { listWaitingCases, claimCase, resolveCase, PRIORITIES, TRIGGER_TYPES } = require('../services/humanHandoff');

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 };

function fakeHandoffSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ priority_rank: PRIORITY_RANK[row.priority] ?? 2, ...row }));
  let seq = rows.length;

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => (
      f.op === 'eq' ? row[f.field] === f.value : f.value.includes(row[f.field])
    )));
  }

  function from(table) {
    if (table !== 'human_handoff_cases') throw new Error(`unexpected table ${table}`);
    const filters = [];
    const orders = [];
    let limitN = null;
    let updatePayload = null;

    const api = {
      select() { return api; },
      eq(field, value) { filters.push({ field, op: 'eq', value }); return api; },
      in(field, values) { filters.push({ field, op: 'in', value: values }); return api; },
      order(field, opts = {}) { orders.push({ field, ascending: opts.ascending !== false }); return api; },
      limit(n) { limitN = n; return api; },
      update(payload) { updatePayload = payload; return api; },
      async maybeSingle() { return resolveSingle(); },
      async single() { return resolveSingle(); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolveList()).then(onFulfilled, onRejected); },
    };

    function resolveSingle() {
      if (updatePayload) {
        const matches = applyFilters(rows, filters);
        matches.forEach((row) => Object.assign(row, updatePayload));
        return { data: matches[0] || null, error: null };
      }
      const matches = applyFilters(rows, filters);
      return { data: matches[0] || null, error: null };
    }

    function resolveList() {
      let matches = applyFilters(rows, filters);
      matches = [...matches].sort((a, b) => {
        for (const o of orders) {
          const av = a[o.field]; const bv = b[o.field];
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return o.ascending ? cmp : -cmp;
        }
        return 0;
      });
      if (limitN != null) matches = matches.slice(0, limitN);
      return { data: matches, error: null };
    }

    return api;
  }

  return { from, _rows: rows };
}

function seedCase(overrides = {}) {
  return {
    id: overrides.id || `case-${Math.random().toString(36).slice(2, 8)}`,
    customer_phone: '628111', customer_id: null, channel: 'whatsapp',
    branch: 'bypass', reason: 'customer_requested_human', trigger_type: TRIGGER_TYPES.EXPLICIT,
    intent: 'human_request', priority: PRIORITIES.NORMAL, conversation_summary: null,
    latest_customer_message: 'halo', booking_reference: null, status: 'waiting_human',
    assigned_to: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    resolved_at: null, ...overrides,
  };
}

async function withServer(supabase, fn, { staffId = 'owner-1', role = 'owner', branch = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/handoff', createHumanHandoffRoutes(supabase, (req, _res, next) => {
    req.adminAuth = { staffId, role, branch, sessionVerified: true };
    next();
  }, { clearHumanTakeover: async () => true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

// ── resolveHandoffBranchScope: the model itself ───────────────────────────

test('resolveHandoffBranchScope: owner is always global, branch_admin always scoped, manager scoped only if assigned', () => {
  assert.equal(resolveHandoffBranchScope({ role: 'owner', branch: null }), null);
  assert.equal(resolveHandoffBranchScope({ role: 'owner', branch: 'bypass' }), null);
  assert.equal(resolveHandoffBranchScope({ role: 'branch_admin', branch: 'bypass' }), 'bypass');
  assert.equal(resolveHandoffBranchScope({ role: 'manager', branch: 'csb' }), 'csb');
  assert.equal(resolveHandoffBranchScope({ role: 'manager', branch: null }), null);
});

// ── A1: branch admin sees only their own branch's cases ──────────────────

test('A1. branch admin Bypass sees the Bypass case, does NOT see the Samadikun case', async () => {
  const supabase = fakeHandoffSupabase([
    seedCase({ id: 'case-bypass', branch: 'bypass' }),
    seedCase({ id: 'case-samadikun', branch: 'samadikun' }),
  ]);
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.cases.length, 1);
    assert.equal(body.cases[0].id, 'case-bypass');
  }, { role: 'branch_admin', branch: 'bypass' });
});

// ── A2: branch admin cannot claim another branch's case ───────────────────

test('A2. branch admin Bypass attempting to claim a Samadikun case gets 409, case unchanged', async () => {
  const supabase = fakeHandoffSupabase([seedCase({ id: 'case-samadikun', branch: 'samadikun' })]);
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases/case-samadikun/claim`, { method: 'POST' });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'bypass' });
  assert.equal(supabase._rows[0].status, 'waiting_human');
  assert.equal(supabase._rows[0].assigned_to, null);
});

// ── A3: branch admin cannot resolve another branch's case ─────────────────

test('A3. branch admin Bypass attempting to resolve a Samadikun case gets 409, case unchanged', async () => {
  const supabase = fakeHandoffSupabase([seedCase({ id: 'case-samadikun', branch: 'samadikun', status: 'human_active' })]);
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases/case-samadikun/resolve`, { method: 'POST' });
    assert.equal(res.status, 409);
  }, { role: 'branch_admin', branch: 'bypass' });
  assert.equal(supabase._rows[0].status, 'human_active');
  assert.equal(supabase._rows[0].resolved_at, null);
});

// Same-branch claim/resolve must still work for a branch_admin (the strict
// scope is a restriction, not a total block).
test('A2b/A3b. branch admin Bypass can claim and resolve their OWN branch case', async () => {
  const supabase = fakeHandoffSupabase([seedCase({ id: 'case-bypass', branch: 'bypass' })]);
  await withServer(supabase, async (base) => {
    const claimRes = await fetch(`${base}/api/handoff/cases/case-bypass/claim`, { method: 'POST' });
    assert.equal(claimRes.status, 200);
  }, { role: 'branch_admin', branch: 'bypass', staffId: 'admin-bypass-1' });
  assert.equal(supabase._rows[0].status, 'human_active');
  assert.equal(supabase._rows[0].assigned_to, 'admin-bypass-1');

  await withServer(supabase, async (base) => {
    const resolveRes = await fetch(`${base}/api/handoff/cases/case-bypass/resolve`, { method: 'POST' });
    assert.equal(resolveRes.status, 200);
  }, { role: 'branch_admin', branch: 'bypass' });
  assert.equal(supabase._rows[0].status, 'resolved');
});

// ── A4: owner has global access across branches ────────────────────────────

test('A4. owner sees, claims, and resolves cases across every branch', async () => {
  const supabase = fakeHandoffSupabase([
    seedCase({ id: 'case-bypass', branch: 'bypass' }),
    seedCase({ id: 'case-samadikun', branch: 'samadikun' }),
  ]);
  await withServer(supabase, async (base) => {
    const listRes = await fetch(`${base}/api/handoff/cases`);
    const listBody = await listRes.json();
    assert.equal(listBody.cases.length, 2);

    const claimRes = await fetch(`${base}/api/handoff/cases/case-samadikun/claim`, { method: 'POST' });
    assert.equal(claimRes.status, 200);
  }, { role: 'owner' });
  assert.equal(supabase._rows.find((r) => r.id === 'case-samadikun').status, 'human_active');

  await withServer(supabase, async (base) => {
    const resolveRes = await fetch(`${base}/api/handoff/cases/case-samadikun/resolve`, { method: 'POST' });
    assert.equal(resolveRes.status, 200);
  }, { role: 'owner' });
  assert.equal(supabase._rows.find((r) => r.id === 'case-samadikun').status, 'resolved');
});

// ── A5: manager follows the verified existing manager scope ───────────────

test('A5. branch-assigned manager is scoped like a branch_admin; a manager with no branch assigned is global', async () => {
  const supabase = fakeHandoffSupabase([
    seedCase({ id: 'case-bypass', branch: 'bypass' }),
    seedCase({ id: 'case-samadikun', branch: 'samadikun' }),
  ]);
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases`);
    const body = await res.json();
    assert.equal(body.cases.length, 1);
    assert.equal(body.cases[0].branch, 'bypass');
  }, { role: 'manager', branch: 'bypass' });

  const claimOtherBranch = await withServer(supabase, (base) => fetch(`${base}/api/handoff/cases/case-samadikun/claim`, { method: 'POST' }), { role: 'manager', branch: 'bypass' });
  assert.equal(claimOtherBranch.status, 409);

  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases`);
    const body = await res.json();
    assert.equal(body.cases.length, 2, 'a manager with no branch assigned is global, like an owner');
  }, { role: 'manager', branch: null });
});

// ── request-supplied branch must never widen scope ─────────────────────────

test('branch scope comes only from the verified admin session, never from request input', async () => {
  const supabase = fakeHandoffSupabase([seedCase({ id: 'case-samadikun', branch: 'samadikun' })]);
  await withServer(supabase, async (base) => {
    const res = await fetch(`${base}/api/handoff/cases?branch=samadikun`, {
      headers: { 'X-Branch-Override': 'samadikun' },
    });
    const body = await res.json();
    assert.equal(body.cases.length, 0, 'query params/headers must not override the session-derived branch scope');
  }, { role: 'branch_admin', branch: 'bypass' });
});

// ── Correction 3: deterministic priority ordering ──────────────────────────

test('Correction 3: listWaitingCases orders urgent, then high, then normal, each oldest-first — not lexical', async () => {
  const t0 = new Date('2026-08-28T10:00:00Z').toISOString();
  const t1 = new Date('2026-08-28T10:05:00Z').toISOString();
  const t2 = new Date('2026-08-28T10:10:00Z').toISOString();
  const t3 = new Date('2026-08-28T10:15:00Z').toISOString();
  const supabase = fakeHandoffSupabase([
    seedCase({ id: 'normal-old', priority: PRIORITIES.NORMAL, created_at: t0 }),
    seedCase({ id: 'urgent-new', priority: PRIORITIES.URGENT, created_at: t3 }),
    seedCase({ id: 'high-old', priority: PRIORITIES.HIGH, created_at: t1 }),
    seedCase({ id: 'urgent-old', priority: PRIORITIES.URGENT, created_at: t2 }),
  ]);
  const cases = await listWaitingCases({ supabase });
  assert.deepEqual(cases.map((c) => c.id), ['urgent-old', 'urgent-new', 'high-old', 'normal-old']);
});

test('Correction 3: priority ordering composes with branch scoping', async () => {
  const supabase = fakeHandoffSupabase([
    seedCase({ id: 'bypass-normal', branch: 'bypass', priority: PRIORITIES.NORMAL }),
    seedCase({ id: 'bypass-urgent', branch: 'bypass', priority: PRIORITIES.URGENT }),
    seedCase({ id: 'samadikun-urgent', branch: 'samadikun', priority: PRIORITIES.URGENT }),
  ]);
  const cases = await listWaitingCases({ supabase, branchScope: 'bypass' });
  assert.deepEqual(cases.map((c) => c.id), ['bypass-urgent', 'bypass-normal']);
});

// ── service-level branch scope enforcement (defense in depth vs. the route) ──

test('claimCase/resolveCase branchScope enforces at the query itself, not after fetching globally', async () => {
  const supabase = fakeHandoffSupabase([seedCase({ id: 'case-x', branch: 'samadikun' })]);
  const claimResult = await claimCase('case-x', 'staff-1', { supabase, branchScope: 'bypass' });
  assert.equal(claimResult.status, 'not_claimable');
  assert.equal(supabase._rows[0].status, 'waiting_human');

  const withinScope = await claimCase('case-x', 'staff-1', { supabase, branchScope: 'samadikun' });
  assert.equal(withinScope.status, 'claimed');

  const resolveResult = await resolveCase('case-x', { supabase, branchScope: 'bypass' });
  assert.equal(resolveResult.status, 'not_resolvable');
  assert.equal(supabase._rows[0].status, 'human_active');
});
