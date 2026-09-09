'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { BRANCHES, combineRows, createBusinessPerformanceRoutes } = require('../routes/businessPerformance');

const BRANCH_NET_SALES = [30000000, 31000000, 32000000, 33000000, 31722000];
const BRANCH_TRANSACTIONS = [240, 241, 242, 243, 248];
const SEPTEMBER_ROWS = Array.from({ length: 8 }, (_, dayIndex) => (
  BRANCHES.map((branch_slug, branchIndex) => ({
    business_date: `2026-09-${String(dayIndex + 1).padStart(2, '0')}`,
    branch_slug,
    net_sales: dayIndex === 0 ? BRANCH_NET_SALES[branchIndex] : 0,
    transaction_count: dayIndex === 0 ? BRANCH_TRANSACTIONS[branchIndex] : 0,
  }))
)).flat().concat({
  business_date: '2026-09-01', branch_slug: 'parker', net_sales: 999999999, transaction_count: 9999,
});

function createSupabaseMock(rows = SEPTEMBER_ROWS) {
  return {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-supabase-token');
        return { data: { user: { id: 'owner-1', email: 'adhit24@gmail.com' } }, error: null };
      },
    },
    from(table) {
      if (table === 'users') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { id: 'owner-1', name: 'Owner', role: 'owner', branch: null }, error: null };
          },
        };
      }

      assert.equal(table, 'business_performance_daily');
      const query = {
        select() { return this; },
        gte() { return this; },
        lte() { return this; },
        order() { return this; },
        in(_column, branches) {
          assert.deepEqual(branches, BRANCHES);
          return Promise.resolve({ data: rows.filter(row => branches.includes(row.branch_slug)), error: null });
        },
        eq(_column, branch) {
          return Promise.resolve({ data: rows.filter(row => row.branch_slug === branch), error: null });
        },
      };
      return query;
    },
  };
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('all-branch performance is exactly the sum of the five Redbox branches', () => {
  assert.deepEqual(BRANCHES, ['bypass', 'csb', 'samadikun', 'sumber', 'tegal']);
  assert.equal(BRANCHES.includes('parker'), false);
  const rows = BRANCHES.map((branch_slug, index) => ({ business_date: '2026-09-08', branch_slug, net_sales: 100 + index, transaction_count: index + 1 }));
  const grouped = combineRows(rows, row => row.business_date);
  assert.deepEqual(grouped.get('2026-09-08'), { net_sales: 510, transaction_count: 15 });
});

test('Supabase Bearer auth reaches the live yearly route and returns September aggregate', async () => {
  let legacyAuthCalls = 0;
  const legacyAdminAuth = (_req, res) => {
    legacyAuthCalls += 1;
    return res.status(401).json({ error: 'Unauthorized' });
  };
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/admin/business-performance', createBusinessPerformanceRoutes(createSupabaseMock(), legacyAdminAuth));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/business-performance?view=year&year=2026&branch=all`, {
      headers: {
        Authorization: 'Bearer valid-supabase-token',
        'X-Forwarded-Host': 'backoffice.redboxbarbershop.com',
      },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.points, [{
      month: 9,
      month_label: 'Sep',
      net_sales: 157722000,
      transaction_count: 1214,
    }]);
    assert.equal(legacyAuthCalls, 0);
  });
});

test('non-backoffice auth paths remain protected by legacy admin auth', async () => {
  let legacyAuthCalls = 0;
  const legacyAdminAuth = (_req, res) => {
    legacyAuthCalls += 1;
    return res.status(401).json({ error: 'Unauthorized' });
  };
  const app = express();
  app.use('/api/admin/business-performance', createBusinessPerformanceRoutes(createSupabaseMock(), legacyAdminAuth));

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/business-performance?view=year&year=2026&branch=all`);
    assert.equal(response.status, 401);
    assert.equal(legacyAuthCalls, 1);
  });
});
