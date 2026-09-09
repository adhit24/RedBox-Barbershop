'use strict';

const express = require('express');

const BRANCHES = Object.freeze(['bypass', 'csb', 'samadikun', 'sumber', 'tegal']);
const SCOPES = new Set(['all', ...BRANCHES]);
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function combineRows(rows, keyForRow) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = keyForRow(row);
    const current = grouped.get(key) || { net_sales: 0, transaction_count: 0 };
    current.net_sales += Number(row.net_sales) || 0;
    current.transaction_count += Number(row.transaction_count) || 0;
    grouped.set(key, current);
  }
  return grouped;
}

function createBusinessPerformanceRoutes(supabase, adminAuth) {
  const router = express.Router();

  router.get('/', adminAuth, async (req, res) => {
    const branch = String(req.query.branch || 'all').toLowerCase();
    const view = String(req.query.view || 'year').toLowerCase();
    const year = parsePositiveInt(req.query.year, new Date().getUTCFullYear());
    if (!SCOPES.has(branch)) return res.status(400).json({ error: 'Invalid branch' });
    if (!['year', 'month'].includes(view)) return res.status(400).json({ error: 'Invalid view' });

    const month = parsePositiveInt(req.query.month, 0);
    if (view === 'month' && (month < 1 || month > 12)) return res.status(400).json({ error: 'Invalid month' });
    const start = view === 'year'
      ? `${year}-01-01`
      : `${year}-${String(month).padStart(2, '0')}-01`;
    const end = view === 'year'
      ? `${year}-12-31`
      : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    let query = supabase.from('business_performance_daily')
      .select('business_date,branch_slug,net_sales,transaction_count,source,imported_at')
      .gte('business_date', start).lte('business_date', end).order('business_date');
    query = branch === 'all' ? query.in('branch_slug', BRANCHES) : query.eq('branch_slug', branch);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Unable to load business performance' });

    if (view === 'month') {
      const grouped = combineRows(data, row => row.business_date);
      const points = [...grouped.entries()].map(([date, metrics]) => ({
        date, day: Number(date.slice(8, 10)), ...metrics,
      }));
      return res.json({ source: 'database', branch, year, month, points });
    }

    const grouped = combineRows(data, row => Number(row.business_date.slice(5, 7)));
    const points = [...grouped.entries()].map(([monthNumber, metrics]) => ({
      month: monthNumber, month_label: MONTH_LABELS[monthNumber - 1], ...metrics,
    }));
    return res.json({ source: 'database', branch, year, points });
  });

  return router;
}

module.exports = { createBusinessPerformanceRoutes, BRANCHES, SCOPES, combineRows };
