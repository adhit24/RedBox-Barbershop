'use strict';

// Generates the PII-free daily Business Performance dataset from local Moka
// exports. Raw files under Transaksi/ are gitignored and must never be printed
// or committed. Net Sales includes every Moka event (including negative refund
// rows); transaction_count counts Payment events only, matching the monthly
// dataset in backoffice/src/data/moka2026Performance.ts.

const fs = require('fs');
const path = require('path');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const OUTLET_TO_BRANCH = new Map([
  ['Redbox Barbershop ByPass', 'bypass'],
  ['Redbox Barbershop CSB', 'csb'],
  ['Redbox Barbershop Samadikun', 'samadikun'],
  ['Redbox Barbershop Sumber', 'sumber'],
  ['Redbox Barbershop Tegal', 'tegal'],
]);
const BRANCHES = ['all', 'bypass', 'csb', 'samadikun', 'sumber', 'tegal'];
const FILES = [
  ['01.January.csv', 1],
  ['02.February.csv', 2],
  ['03..csv', 3],
  ['04..csv', 4],
  ['05.Mei.csv', 5],
  ['06.Juni.csv', 6],
  ['07.July.csv', 7],
  ['08.agustus.csv', 8],
];

const aggregates = Object.fromEntries(BRANCHES.map((branch) => [branch, new Map()]));
const sourceDir = path.join(__dirname, '..', 'Transaksi');

function numberOrZero(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addPoint(branch, date, netSales, isPayment) {
  const current = aggregates[branch].get(date) ?? { net_sales: 0, transaction_count: 0 };
  current.net_sales += netSales;
  if (isPayment) current.transaction_count++;
  aggregates[branch].set(date, current);
}

for (const [fileName] of FILES) {
  const rows = parseCsv(fs.readFileSync(path.join(sourceDir, fileName), 'utf8'));
  const header = rows[0];
  const index = Object.fromEntries(header.map((column, columnIndex) => [column, columnIndex]));
  for (const required of ['Outlet', 'Date', 'Net Sales', 'Event Type']) {
    if (index[required] === undefined) throw new Error(`${fileName}: missing required column ${required}`);
  }

  for (const row of rows.slice(1)) {
    if (row.length !== header.length) continue;
    const branch = OUTLET_TO_BRANCH.get(row[index.Outlet]);
    if (!branch) continue; // Excludes Parker and any unknown outlet by allowlist.

    const [day, month, year] = row[index.Date].split('-');
    if (!day || !month || !year) continue;
    const date = `${year}-${month}-${day}`;
    const netSales = numberOrZero(row[index['Net Sales']]);
    const isPayment = row[index['Event Type']] === 'Payment';
    addPoint('all', date, netSales, isPayment);
    addPoint(branch, date, netSales, isPayment);
  }
}

const lines = [
  '// PII-free daily aggregates derived from local Moka POS exports in Transaksi/.',
  '// Raw exports are gitignored. Net Sales includes refund effects; transaction_count',
  '// counts Payment events only. Parker is excluded through an exact Redbox allowlist.',
  '// Future source: Moka POS -> Supabase transactions -> aggregation -> performance service.',
  '',
  'export interface DailyPerformancePoint {',
  '  date: string;',
  '  day: number;',
  '  net_sales: number | null;',
  '  transaction_count: number | null;',
  '}',
  '',
  "export type DailyPerformanceBranch = 'all' | 'bypass' | 'csb' | 'samadikun' | 'sumber' | 'tegal';",
  '',
  'export const MOKA_2026_DAILY_PERFORMANCE: Record<DailyPerformanceBranch, Record<number, DailyPerformancePoint[]>> = {',
];

for (const branch of BRANCHES) {
  lines.push(`  ${branch}: {`);
  for (const [, month] of FILES) {
    const prefix = `2026-${String(month).padStart(2, '0')}-`;
    const points = [...aggregates[branch].entries()]
      .filter(([date]) => date.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    lines.push(`    ${month}: [`);
    for (const [date, point] of points) {
      const day = Number.parseInt(date.slice(-2), 10);
      lines.push(`      { date: '${date}', day: ${day}, net_sales: ${Math.round(point.net_sales)}, transaction_count: ${point.transaction_count} },`);
    }
    lines.push('    ],');
  }
  lines.push('  },');
}
lines.push('};', '');

const outputPath = path.join(__dirname, '..', 'backoffice', 'src', 'data', 'moka2026DailyPerformance.ts');
fs.writeFileSync(outputPath, lines.join('\n'));

// Aggregate-only output: safe for local verification and CI logs.
for (const [, month] of FILES) {
  const prefix = `2026-${String(month).padStart(2, '0')}-`;
  const points = [...aggregates.all.entries()].filter(([date]) => date.startsWith(prefix));
  const netSales = points.reduce((sum, [, point]) => sum + point.net_sales, 0);
  const transactionCount = points.reduce((sum, [, point]) => sum + point.transaction_count, 0);
  console.log(`${prefix.slice(0, 7)} net_sales=${Math.round(netSales)} transaction_count=${transactionCount}`);
}
