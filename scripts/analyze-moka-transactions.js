'use strict';
// One-time historical analysis of the Moka CSV exports in Transaksi/ (Jan-Aug
// 2026). Produces the MonthlyPerformance[] dataset consumed by Command
// Center's Yearly Performance Chart. NOT a production pipeline — see
// backoffice/src/services/performance.ts for the reusable aggregation
// function this same shape will eventually be fed by real Supabase
// `transactions` rows instead of a CSV file.

const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const REDBOX_OUTLETS = new Set([
  'Redbox Barbershop ByPass',
  'Redbox Barbershop CSB',
  'Redbox Barbershop Samadikun',
  'Redbox Barbershop Sumber',
  'Redbox Barbershop Tegal',
]);

const OUTLET_TO_SLUG = {
  'Redbox Barbershop ByPass': 'bypass',
  'Redbox Barbershop CSB': 'csb',
  'Redbox Barbershop Samadikun': 'samadikun',
  'Redbox Barbershop Sumber': 'sumber',
  'Redbox Barbershop Tegal': 'tegal',
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FILES = [
  { file: '01.January.csv', month: 1 },
  { file: '02.February.csv', month: 2 },
  { file: '03..csv', month: 3 },
  { file: '04..csv', month: 4 },
  { file: '05.Mei.csv', month: 5 },
  { file: '06.Juni.csv', month: 6 },
  { file: '07.July.csv', month: 7 },
  { file: '08.agustus.csv', month: 8 },
];

const dir = path.join(__dirname, '..', 'Transaksi');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

const monthly = [];
const excludedOutletCounts = {};
const eventTypeCounts = {};
const perBranchMonthly = {}; // slug -> [{month, net_sales, transaction_count}]

for (const { file, month } of FILES) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  let netSales = 0;
  let grossSales = 0;
  let discounts = 0;
  let refunds = 0;
  let paymentCount = 0;
  let paymentNetSalesSum = 0; // for average transaction value (Payment rows only)
  const branchAgg = {}; // slug -> {net_sales, count}

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length !== header.length) continue;
    const outlet = row[idx['Outlet']];
    const eventType = row[idx['Event Type']];

    if (!REDBOX_OUTLETS.has(outlet)) {
      excludedOutletCounts[outlet] = (excludedOutletCounts[outlet] || 0) + 1;
      continue;
    }
    eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;

    const rowNet = num(row[idx['Net Sales']]);
    const rowGross = num(row[idx['Gross Sales']]);
    const rowDiscount = num(row[idx['Discounts']]);
    const rowRefund = num(row[idx['Refunds']]);

    // Net Sales already carries the refund correction (Refund rows are
    // negative), so summing Net Sales across every Redbox row — Payment and
    // Refund alike — is the correct, already-netted total. Gross/discount are
    // summed as reported for transparency; Payment-only figures are tracked
    // separately for the transaction count and average transaction value so
    // a rare refund correction doesn't distort "typical sale size."
    netSales += rowNet;
    grossSales += rowGross;
    discounts += rowDiscount;
    refunds += rowRefund;

    if (eventType === 'Payment') {
      paymentCount++;
      paymentNetSalesSum += rowNet;

      const slug = OUTLET_TO_SLUG[outlet];
      if (!branchAgg[slug]) branchAgg[slug] = { net_sales: 0, count: 0 };
      branchAgg[slug].net_sales += rowNet;
      branchAgg[slug].count++;
    } else {
      // Refund rows still belong to a branch for the branch-level dataset.
      const slug = OUTLET_TO_SLUG[outlet];
      if (!branchAgg[slug]) branchAgg[slug] = { net_sales: 0, count: 0 };
      branchAgg[slug].net_sales += rowNet;
    }
  }

  monthly.push({
    month,
    month_label: MONTH_LABELS[month - 1],
    net_sales: Math.round(netSales),
    gross_sales: Math.round(grossSales),
    discounts: Math.round(discounts),
    refunds: Math.round(refunds),
    transaction_count: paymentCount,
    average_transaction_value: paymentCount > 0 ? Math.round(paymentNetSalesSum / paymentCount) : 0,
  });

  for (const [slug, agg] of Object.entries(branchAgg)) {
    if (!perBranchMonthly[slug]) perBranchMonthly[slug] = [];
    perBranchMonthly[slug].push({
      month,
      month_label: MONTH_LABELS[month - 1],
      net_sales: Math.round(agg.net_sales),
      transaction_count: agg.count,
    });
  }
}

// ---- Report ----
console.log('=== Excluded (non-Redbox) outlet row counts ===');
console.log(excludedOutletCounts);

console.log('\n=== Event Type counts (Redbox rows only) ===');
console.log(eventTypeCounts);

console.log('\n=== Monthly Performance (Redbox, all 5 branches combined) ===');
console.table(monthly.map(m => ({
  Month: m.month_label,
  'Net Sales': m.net_sales.toLocaleString('id-ID'),
  'Gross Sales': m.gross_sales.toLocaleString('id-ID'),
  Discounts: m.discounts.toLocaleString('id-ID'),
  Refunds: m.refunds.toLocaleString('id-ID'),
  Transactions: m.transaction_count,
  'Avg Transaction': m.average_transaction_value.toLocaleString('id-ID'),
})));

console.log('\n=== Month-over-month change (Net Sales) ===');
for (let i = 1; i < monthly.length; i++) {
  const prev = monthly[i - 1];
  const cur = monthly[i];
  const pct = ((cur.net_sales - prev.net_sales) / prev.net_sales) * 100;
  console.log(`${prev.month_label} -> ${cur.month_label}: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%  (${prev.net_sales.toLocaleString('id-ID')} -> ${cur.net_sales.toLocaleString('id-ID')})`);
}

const best = monthly.reduce((a, b) => (b.net_sales > a.net_sales ? b : a));
const worst = monthly.reduce((a, b) => (b.net_sales < a.net_sales ? b : a));
const avgMonthly = monthly.reduce((s, m) => s + m.net_sales, 0) / monthly.length;
const ytdTotal = monthly.reduce((s, m) => s + m.net_sales, 0);

let biggestIncrease = null;
let biggestDecrease = null;
for (let i = 1; i < monthly.length; i++) {
  const prev = monthly[i - 1];
  const cur = monthly[i];
  const pct = ((cur.net_sales - prev.net_sales) / prev.net_sales) * 100;
  const entry = { from: prev.month_label, to: cur.month_label, pct };
  if (!biggestIncrease || pct > biggestIncrease.pct) biggestIncrease = entry;
  if (!biggestDecrease || pct < biggestDecrease.pct) biggestDecrease = entry;
}

console.log('\n=== Summary ===');
console.log('Best month:', best.month_label, best.net_sales.toLocaleString('id-ID'));
console.log('Worst month:', worst.month_label, worst.net_sales.toLocaleString('id-ID'));
console.log('Biggest increase:', `${biggestIncrease.from}->${biggestIncrease.to}`, `${biggestIncrease.pct.toFixed(1)}%`);
console.log('Biggest decrease:', `${biggestDecrease.from}->${biggestDecrease.to}`, `${biggestDecrease.pct.toFixed(1)}%`);
console.log('YTD total (Jan-Aug):', ytdTotal.toLocaleString('id-ID'));
console.log('Average monthly:', Math.round(avgMonthly).toLocaleString('id-ID'));

// ---- Write output data files ----
const outDir = path.join(__dirname, '..', 'scripts', 'output');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'monthly-performance.json'), JSON.stringify(monthly, null, 2));
fs.writeFileSync(path.join(outDir, 'monthly-performance-by-branch.json'), JSON.stringify(perBranchMonthly, null, 2));
console.log('\nWrote scripts/output/monthly-performance.json and monthly-performance-by-branch.json');
