'use strict';

const fs = require('fs');
const path = require('path');

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

async function importRedboxKasir() {
  const filePath = path.resolve(__dirname, '../Laporan_Gaji_GAJI_KASIR_REDBOX_BARBERSHOP.csv');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  // Line index 0 is Unnamed..., Line 1 is headers:
  // ,No,Full Nama,Nick Nama,Jabatan,Gaji Pokok,...,Alamat Outlet,Outlet,Periode
  // Rows start at index 2 (No: 1..16)
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
    const outletCity = cols[26];
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
      source: 'Laporan_Gaji_GAJI_KASIR_REDBOX_BARBERSHOP.csv',
      source_period: period,
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Parsed ${records.length} Redbox regular employee records.`);
  return records;
}

async function importSundaze() {
  const filePath = path.resolve(__dirname, '../Laporan_Gaji_GAJI_SUNDAZE_AGUSTUS_2025.csv');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  // Line index 1 is headers:
  // ,No,Full Nama,Jabatan,Nick Nama,Gaji Pokok,...,Alamat,Outlet,Outlet
  // Rows start at index 2 (No: 1..23)
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
      source: 'Laporan_Gaji_GAJI_SUNDAZE_AGUSTUS_2025.csv',
      source_period: period,
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Parsed ${records.length} Sundaze regular employee records.`);
  return records;
}

async function main() {
  console.log('=== IMPORT REGULAR EMPLOYEES INTO SUPABASE ===');
  const redboxEmployees = await importRedboxKasir();
  const sundazeEmployees = await importSundaze();
  const allEmployees = [...redboxEmployees, ...sundazeEmployees];

  console.log(`Total regular employees to upsert: ${allEmployees.length}`);

  for (const emp of allEmployees) {
    const { data, error } = await supabase
      .from('employees')
      .upsert(emp, { onConflict: 'employee_code' })
      .select('id, employee_code, name, business_unit, branch, position');

    if (error) {
      console.error(`Error upserting ${emp.employee_code} (${emp.name}):`, error.message);
    } else {
      console.log(`Upserted: [${emp.employee_code}] ${emp.name} | ${emp.business_unit} | ${emp.position} | ${emp.branch}`);
    }
  }

  // Verification counts from database
  console.log('\n--- VERIFYING FROM SUPABASE DATABASE ---');
  const { data: dbRecords, error: dbError } = await supabase
    .from('employees')
    .select('id, employee_code, name, business_unit, branch, is_active');

  if (dbError) {
    console.error('Failed to query employees table:', dbError.message);
    process.exit(1);
  }

  const activeRecords = dbRecords.filter(r => r.is_active);
  const redboxCount = activeRecords.filter(r => r.business_unit === 'Redbox').length;
  const sundazeCount = activeRecords.filter(r => r.business_unit === 'Sundaze').length;

  console.log(`Total employees in DB: ${dbRecords.length}`);
  console.log(`Active regular employees: ${activeRecords.length}`);
  console.log(`  - Redbox: ${redboxCount}`);
  console.log(`  - Sundaze: ${sundazeCount}`);

  // Query barbers for comparison
  const { data: barbers } = await supabase
    .from('barbers')
    .select('id, name, branch, is_active')
    .eq('is_active', true);

  const activeBarbers = barbers || [];
  const barberBranches = new Set(activeBarbers.map(b => b.branch));

  console.log(`Active kapster: ${activeBarbers.length}`);
  console.log(`Cabang dengan kapster: ${barberBranches.size} (${[...barberBranches].join(', ')})`);
  console.log(`Total overall workforce: ${activeRecords.length + activeBarbers.length}`);
  console.log('=== IMPORT COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal error during import:', err);
  process.exit(1);
});
