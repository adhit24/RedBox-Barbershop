'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BRANCHES, combineRows } = require('../routes/businessPerformance');

test('all-branch performance is exactly the sum of the five Redbox branches', () => {
  assert.deepEqual(BRANCHES, ['bypass', 'csb', 'samadikun', 'sumber', 'tegal']);
  assert.equal(BRANCHES.includes('parker'), false);
  const rows = BRANCHES.map((branch_slug, index) => ({ business_date: '2026-09-08', branch_slug, net_sales: 100 + index, transaction_count: index + 1 }));
  const grouped = combineRows(rows, row => row.business_date);
  assert.deepEqual(grouped.get('2026-09-08'), { net_sales: 510, transaction_count: 15 });
});
