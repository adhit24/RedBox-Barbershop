'use strict';

const fs = require('fs');
const path = require('path');

// Parse CLI arguments for private input file paths
// Example usage:
// node scripts/import-employees.js --redbox "C:/path/to/redbox.csv" --sundaze "C:/path/to/sundaze.csv"
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    redbox: process.env.REDBOX_PAYROLL_CSV || null,
    sundaze: process.env.SUNDAZE_PAYROLL_CSV || null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--redbox' || arg === '-r') && i + 1 < args.length) {
      result.redbox = args[++i];
    } else if ((arg === '--sundaze' || arg === '-s') && i + 1 < args.length) {
      result.sundaze = args[++i];
    }
  }

  // Fallback to Downloads folder if exists
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const defaultRedbox = path.join(homeDir, 'Downloads', 'Laporan_Gaji_GAJI_KASIR_REDBOX_BARBERSHOP.csv');
  const defaultSundaze = path.join(homeDir, 'Downloads', 'Laporan_Gaji_GAJI_SUNDAZE_AGUSTUS_2025.csv');

  if (!result.redbox && fs.existsSync(defaultRedbox)) {
    result.redbox = defaultRedbox;
  }
  if (!result.sundaze && fs.existsSync(defaultSundaze)) {
    result.sundaze = defaultSundaze;
  }

  return result;
}

// Load environment variables from server/.env
const envPath = path.resolve(__dirname, '../server/.env');
const envText = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    envVars[k] = v;
  }
}

const { createClient } = require(path.resolve(__dirname, '../node_modules/@supabase/supabase-js'));
const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_KEY);

function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result;
}

function resolveBranch(outletAddress) {
  const addr = (outletAddress || '').toLowerCase();
  if (addr.includes('cakrabuana') || addr.includes('sumber')) return { slug: 'sumber', name: 'Sumber' };
  if (addr.includes('csb')) return { slug: 'csb', name: 'CSB' };
  if (addr.includes('samadikun')) return { slug: 'samadikun', name: 'Samadikun' };
  if (addr.includes('soetomo') || addr.includes('tegal')) return { slug: 'tegal', name: 'Tegal' };
  return { slug: 'bypass', name: 'Bypass' };
}

function cleanPosition(pos) {
  const p = (pos || '').trim();
  if (!p || p === '-') return 'Staff';
  return p;
}

async function importRedboxKasir(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Redbox payroll file not found at: ${filePath}. Specify with --redbox <path>`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  const records = [];
  for (let i = 2; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const no = parseInt(cols[1], 10);
    if (isNaN(no)) continue;

    const fullName = cols[2];
    const nickName = cols[3];
    const position = cleanPosition(cols[4]);
    const baseSalary = parseFloat(cols[5]) || 0;
    const outletAddress = cols[25];
    const periodRaw = cols[27] || '';
    const period = periodRaw.replace(/[()]/g, '').replace(/^Periode\s*/i, '').trim();

    const branch = resolveBranch(outletAddress);
    const employeeCode = `RB-REG-${String(no).padStart(3, '0')}`;

    records.push({
      employee_code: employeeCode,
      name: fullName,
      nickname: nickName || null,
      business_unit: 'Redbox',
      branch: branch.slug,
      branch_name: branch.name,
      position: position,
      employment_type: 'regular',
      payroll_type: 'salary',
      is_active: true,
      base_salary: baseSalary,
      source: path.basename(filePath),
      source_period: period,
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Parsed ${records.length} Redbox regular employee records from ${filePath}.`);
  return records;
}

async function importSundaze(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Sundaze payroll file not found at: ${filePath}. Specify with --sundaze <path>`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  const records = [];
  for (let i = 2; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const no = parseInt(cols[1], 10);
    if (isNaN(no)) continue;

    const fullName = cols[2];
    const position = cleanPosition(cols[3]);
    const nickName = cols[4];
    const baseSalary = parseFloat(cols[5]) || 0;
    const outletAddress = cols[24];
    const periodRaw = cols[26] || '';
    const period = periodRaw.replace(/[()]/g, '').replace(/^Periode\s*/i, '').trim();

    const branch = resolveBranch(outletAddress);
    const employeeCode = `SD-REG-${String(no).padStart(3, '0')}`;

    records.push({
      employee_code: employeeCode,
      name: fullName,
      nickname: nickName || null,
      business_unit: 'Sundaze',
      branch: branch.slug,
      branch_name: branch.name,
      position: position,
      employment_type: 'regular',
      payroll_type: 'salary',
      is_active: true,
      base_salary: baseSalary,
      source: path.basename(filePath),
      source_period: period,
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Parsed ${records.length} Sundaze regular employee records from ${filePath}.`);
  return records;
}

async function main() {
  const { redbox: redboxPath, sundaze: sundazePath } = parseArgs();

  console.log('=== IMPORT REGULAR EMPLOYEES (DRY RUN / CLI SOURCE) ===');
  console.log('Redbox payroll file:', redboxPath || 'NOT SPECIFIED');
  console.log('Sundaze payroll file:', sundazePath || 'NOT SPECIFIED');

  if (!redboxPath || !sundazePath) {
    console.error('\nUsage: node scripts/import-employees.js --redbox <path-to-redbox.csv> --sundaze <path-to-sundaze.csv>');
    console.error('Do NOT commit payroll CSV files into the repository.');
    process.exit(1);
  }

  const redboxEmployees = await importRedboxKasir(redboxPath);
  const sundazeEmployees = await importSundaze(sundazePath);
  const allEmployees = [...redboxEmployees, ...sundazeEmployees];

  console.log(`Total regular employees parsed: ${allEmployees.length}`);

  // Upsert into Supabase
  for (const emp of allEmployees) {
    const { error } = await supabase
      .from('employees')
      .upsert(emp, { onConflict: 'employee_code' });

    if (error) {
      console.error(`Error upserting ${emp.employee_code}:`, error.message);
    }
  }

  console.log('=== IMPORT COMPLETE ===');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { parseCsvLine, resolveBranch, cleanPosition };
