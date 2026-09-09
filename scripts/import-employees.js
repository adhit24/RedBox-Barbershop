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

function getSupabaseClient(clientOverride = null) {
  if (clientOverride) return clientOverride;

  const envVars = {};
  const envPath = path.resolve(__dirname, '../server/.env');
  if (fs.existsSync(envPath)) {
    try {
      const envText = fs.readFileSync(envPath, 'utf8');
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
    } catch {
      // ignore
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL || envVars.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || envVars.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required to run employee import');
  }

  const { createClient } = require(path.resolve(__dirname, '../node_modules/@supabase/supabase-js'));
  return createClient(supabaseUrl, serviceKey);
}

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

async function reconcileBusinessUnit(supabaseClient, businessUnit, snapshotEmployees) {
  const snapshotCodes = new Set(snapshotEmployees.map(e => e.employee_code).filter(Boolean));

  // 1. Fetch current active employees in DB for this business_unit only
  const { data: dbActiveEmployees, error: fetchErr } = await supabaseClient
    .from('employees')
    .select('id, employee_code, name, business_unit, is_active')
    .eq('business_unit', businessUnit)
    .eq('is_active', true);

  if (fetchErr) {
    console.error(`Failed to fetch active employees for ${businessUnit} reconciliation:`, fetchErr.message);
    return {
      success: false,
      deactivationsAttempted: 0,
      deactivationsSuccess: 0,
      deactivationsFailed: 1,
      errors: [fetchErr.message],
    };
  }

  // 2. Identify employees in DB that are absent from snapshot
  const toDeactivate = (dbActiveEmployees || []).filter(
    (emp) => !snapshotCodes.has(emp.employee_code)
  );

  console.log(
    `Reconciling ${businessUnit}: ${dbActiveEmployees?.length || 0} currently active in DB, ` +
    `${snapshotEmployees.length} in snapshot. Missing/Departed to deactivate: ${toDeactivate.length}`
  );

  let deactivationsSuccess = 0;
  let deactivationsFailed = 0;
  const errors = [];

  for (const emp of toDeactivate) {
    console.log(`Deactivating departed employee: [${emp.employee_code}] ${emp.name} (${businessUnit})`);
    const { error: updateErr } = await supabaseClient
      .from('employees')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', emp.id);

    if (updateErr) {
      console.error(`Error deactivating ${emp.employee_code}:`, updateErr.message);
      deactivationsFailed++;
      errors.push(`Deactivation failed for ${emp.employee_code}: ${updateErr.message}`);
    } else {
      deactivationsSuccess++;
    }
  }

  return {
    success: deactivationsFailed === 0,
    deactivationsAttempted: toDeactivate.length,
    deactivationsSuccess,
    deactivationsFailed,
    errors,
  };
}

async function executeImport({
  redboxPath = null,
  sundazePath = null,
  supabaseClient = null,
  assertProductionSafety = true,
} = {}) {
  const client = getSupabaseClient(supabaseClient);

  if (assertProductionSafety) {
    const { assertSafeTestEnvironment } = require('../server/utils/testSafety');
    assertSafeTestEnvironment({
      operation: 'IMPORT_EMPLOYEES_UPSERT_AND_DEACTIVATE',
      allowOverride: true,
    });
  }

  console.log('=== IMPORT REGULAR EMPLOYEES (LIVE UPSERT & RECONCILIATION) ===');
  console.log('Redbox payroll file:', redboxPath || 'NOT SPECIFIED');
  console.log('Sundaze payroll file:', sundazePath || 'NOT SPECIFIED');

  if (!redboxPath && !sundazePath) {
    throw new Error('At least one payroll file (--redbox or --sundaze) must be specified.');
  }

  let redboxEmployees = [];
  if (redboxPath) {
    redboxEmployees = await importRedboxKasir(redboxPath);
  }

  let sundazeEmployees = [];
  if (sundazePath) {
    sundazeEmployees = await importSundaze(sundazePath);
  }

  const allEmployees = [...redboxEmployees, ...sundazeEmployees];
  console.log(`Total regular employees parsed from snapshot: ${allEmployees.length}`);

  let upsertSuccess = 0;
  let upsertFailed = 0;
  const failureDetails = [];

  // 1. Upsert snapshot employees
  for (const emp of allEmployees) {
    const { error } = await client
      .from('employees')
      .upsert(emp, { onConflict: 'employee_code' });

    if (error) {
      console.error(`Error upserting ${emp.employee_code}:`, error.message);
      upsertFailed++;
      failureDetails.push(`Upsert ${emp.employee_code}: ${error.message}`);
    } else {
      upsertSuccess++;
    }
  }

  // 2. Reconcile scoped business units (soft-deactivates missing employees in that unit only)
  let deactivationsSuccess = 0;
  let deactivationsFailed = 0;

  if (redboxEmployees.length > 0) {
    const recon = await reconcileBusinessUnit(client, 'Redbox', redboxEmployees);
    deactivationsSuccess += recon.deactivationsSuccess;
    deactivationsFailed += recon.deactivationsFailed;
    failureDetails.push(...recon.errors);
  }

  if (sundazeEmployees.length > 0) {
    const recon = await reconcileBusinessUnit(client, 'Sundaze', sundazeEmployees);
    deactivationsSuccess += recon.deactivationsSuccess;
    deactivationsFailed += recon.deactivationsFailed;
    failureDetails.push(...recon.errors);
  }

  const totalSuccess = upsertSuccess + deactivationsSuccess;
  const totalFailed = upsertFailed + deactivationsFailed;

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`Upserts Success: ${upsertSuccess}`);
  console.log(`Upserts Failed: ${upsertFailed}`);
  console.log(`Deactivations Success: ${deactivationsSuccess}`);
  console.log(`Deactivations Failed: ${deactivationsFailed}`);
  console.log(`Total Succeeded Operations: ${totalSuccess}`);
  console.log(`Total Failed Operations: ${totalFailed}`);

  if (totalFailed > 0) {
    console.error(`\n[IMPORT FAILED] Encountered ${totalFailed} failure(s) during import / reconciliation.`);
    const err = new Error(`Import failed with ${totalFailed} errors.`);
    err.details = failureDetails;
    throw err;
  }

  console.log('\n=== IMPORT COMPLETE: ALL RECORDS PROCESSED SUCCESSFULLY ===');
  return {
    success: true,
    upsertSuccess,
    upsertFailed,
    deactivationsSuccess,
    deactivationsFailed,
    totalSuccess,
    totalFailed,
  };
}

async function main() {
  const { redbox: redboxPath, sundaze: sundazePath } = parseArgs();

  if (!redboxPath && !sundazePath) {
    console.error('\nUsage: node scripts/import-employees.js --redbox <path-to-redbox.csv> --sundaze <path-to-sundaze.csv>');
    console.error('Do NOT commit payroll CSV files into the repository.');
    process.exit(1);
  }

  try {
    await executeImport({ redboxPath, sundazePath });
  } catch (err) {
    process.exitCode = 1;
    throw err;
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseCsvLine,
  resolveBranch,
  cleanPosition,
  importRedboxKasir,
  importSundaze,
  reconcileBusinessUnit,
  executeImport,
  getSupabaseClient,
};
