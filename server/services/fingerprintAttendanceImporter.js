'use strict';

const crypto = require('crypto');
const XLSX = require('xlsx');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
const OLE2_MAGIC = 'd0cf11e0a1b11ae1'; // .xls legacy BIFF8
const ZIP_MAGIC = '504b0304';         // .xlsx modern OpenXML

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAlphanumeric(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

/**
 * 1. Validate File Safety
 * Checks size, extension, magic bytes, and computes sha256 hash.
 */
function validateFileSafety(buffer, filename) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('File buffer is required');
    err.code = 'INVALID_BUFFER';
    throw err;
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    const err = new Error(`Ukuran file melebihi batas 10MB (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const cleanFilename = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const lowerName = cleanFilename.toLowerCase();
  if (!lowerName.endsWith('.xls') && !lowerName.endsWith('.xlsx')) {
    const err = new Error('Format file tidak didukung. Harap unggah file laporan absensi .xls atau .xlsx');
    err.code = 'INVALID_FILE_EXTENSION';
    throw err;
  }

  const hexHeader = buffer.slice(0, 8).toString('hex').toLowerCase();
  const isXls = hexHeader.startsWith(OLE2_MAGIC);
  const isXlsx = hexHeader.startsWith(ZIP_MAGIC);

  if (!isXls && !isXlsx) {
    const err = new Error('File tidak valid atau rusak. Tipe file bukan workbook Excel yang sah');
    err.code = 'INVALID_FILE_SIGNATURE';
    throw err;
  }

  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    cleanFilename,
    fileHash,
    isXls,
    isXlsx,
    size: buffer.length,
  };
}

/**
 * 2. Parse Workbook & Detect Report Format
 */
function parseWorkbook(buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer' });
  } catch (parseErr) {
    const err = new Error('Gagal membaca workbook Excel: ' + parseErr.message);
    err.code = 'WORKBOOK_PARSE_FAILED';
    throw err;
  }
}

function detectReportFormat(workbook) {
  const sheetNames = workbook.SheetNames || [];
  const knownSheets = ['Stat. Absen', 'Lap. Log Absen', 'Exception Stat.', 'Jadwal Info'];
  const hasKnownSheet = knownSheets.some(s => sheetNames.includes(s));

  if (!hasKnownSheet) {
    // Scan sheet contents for signature labels
    let foundSignature = false;
    for (const name of sheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const text = JSON.stringify(XLSX.utils.sheet_to_json(ws, { header: 1 })).toLowerCase();
      if (
        text.includes('lap. statistik absensi') ||
        text.includes('lap. detail absensi') ||
        text.includes('waktu absen') ||
        text.includes('stat. tgl')
      ) {
        foundSignature = true;
        break;
      }
    }
    if (!foundSignature) {
      const err = new Error('Format laporan fingerprint tidak dikenali (signature tidak cocok)');
      err.code = 'UNSUPPORTED_FINGERPRINT_FORMAT';
      throw err;
    }
  }

  return {
    sheetNames,
    hasStatAbsen: sheetNames.includes('Stat. Absen'),
    hasLogAbsen: sheetNames.includes('Lap. Log Absen'),
    hasExceptionStat: sheetNames.includes('Exception Stat.'),
    hasJadwalInfo: sheetNames.includes('Jadwal Info'),
  };
}

/**
 * 3. Extract Report Period (YYYY-MM-DD ~ YYYY-MM-DD)
 */
function extractReportPeriod(workbook) {
  const periodRegex = /(\d{4}-\d{2}-\d{2})\s*[~–-]\s*(\d{4}-\d{2}-\d{2})/;

  // Check Stat. Absen, Lap. Log Absen, Exception Stat.
  for (const name of ['Stat. Absen', 'Lap. Log Absen', 'Exception Stat.', 'Jadwal Info']) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r] || [];
      for (const cell of row) {
        const str = String(cell || '');
        const match = str.match(periodRegex);
        if (match) {
          return { from: match[1], to: match[2] };
        }
      }
    }
  }

  // Fallback: Scan dates in Exception Stat. column 3
  if (workbook.Sheets['Exception Stat.']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Exception Stat.'], { header: 1 });
    const dates = [];
    for (let r = 4; r < rows.length; r++) {
      const d = String(rows[r]?.[3] || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
    }
    if (dates.length > 0) {
      dates.sort();
      return { from: dates[0], to: dates[dates.length - 1] };
    }
  }

  const err = new Error('Periode laporan absensi tidak ditemukan dalam file');
  err.code = 'REPORT_PERIOD_NOT_FOUND';
  throw err;
}

/**
 * 4. Extract Employees
 * Reads employee list from Stat. Absen and Lap. Log Absen.
 */
function extractEmployees(workbook) {
  const employeesMap = new Map();

  // Try Stat. Absen first
  if (workbook.Sheets['Stat. Absen']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Stat. Absen'], { header: 1 });
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row[0] === undefined || row[0] === null || String(row[0]).trim() === '') continue;
      const extId = String(row[0]).trim();
      const extName = String(row[1] || '').trim();
      const dept = String(row[2] || '').trim();
      if (!extId || !extName) continue;

      employeesMap.set(extId, {
        external_employee_id: extId,
        external_name: extName,
        department: dept,
        normal_hours: String(row[3] || '0:00'),
        real_hours: String(row[4] || '0:00'),
        late_count: parseInt(row[5] || '0', 10),
        late_minutes: parseInt(row[6] || '0', 10),
        early_leave_count: parseInt(row[7] || '0', 10),
        early_leave_minutes: parseInt(row[8] || '0', 10),
        absent_days: parseInt(row[13] || '0', 10),
      });
    }
  }

  // Complement or fallback with Lap. Log Absen
  if (workbook.Sheets['Lap. Log Absen']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Lap. Log Absen'], { header: 1 });
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      if (String(row[0] || '').trim() === 'ID:') {
        const extId = String(row[2] || '').trim();
        const extName = String(row[10] || '').trim();
        const dept = String(row[20] || row[18] || '').trim();
        if (extId && extName && !employeesMap.has(extId)) {
          employeesMap.set(extId, {
            external_employee_id: extId,
            external_name: extName,
            department: dept,
          });
        }
      }
    }
  }

  return [...employeesMap.values()];
}

/**
 * 5. Extract Punches & Daily Records
 */
function extractDailyPunches(workbook, period) {
  const dailyPunches = []; // { external_employee_id, date, raw_punches: [] }
  const timeRegex = /(\d{1,2}:\d{2})/g;

  if (workbook.Sheets['Lap. Log Absen']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Lap. Log Absen'], { header: 1 });
    // Find header row with day numbers
    let dayCols = [];
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const row = rows[r] || [];
      if (row.some(c => typeof c === 'number' && c >= 1 && c <= 31)) {
        dayCols = row;
        break;
      }
    }

    const yearMonth = period.from.slice(0, 7); // e.g. "2026-08"

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      if (String(row[0] || '').trim() === 'ID:') {
        const extId = String(row[2] || '').trim();
        const punchRow = rows[r + 1] || [];
        for (let c = 0; c < punchRow.length; c++) {
          const cellVal = String(punchRow[c] || '').trim();
          if (!cellVal) continue;
          const dayNum = parseInt(dayCols[c], 10);
          if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;
          const dayStr = String(dayNum).padStart(2, '0');
          const dateStr = `${yearMonth}-${dayStr}`;

          const matches = cellVal.match(timeRegex);
          if (matches && matches.length > 0) {
            dailyPunches.push({
              external_employee_id: extId,
              attendance_date: dateStr,
              raw_punches: matches,
            });
          }
        }
      }
    }
  }

  // Index daily punches by `${extId}|${date}`
  const punchIndex = new Map();
  for (const dp of dailyPunches) {
    const key = `${dp.external_employee_id}|${dp.attendance_date}`;
    punchIndex.set(key, dp.raw_punches);
  }

  // Read daily records from Exception Stat.
  const dailyRecords = [];
  if (workbook.Sheets['Exception Stat.']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Exception Stat.'], { header: 1 });
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r] || [];
      const extId = String(row[0] || '').trim();
      const extName = String(row[1] || '').trim();
      const dept = String(row[2] || '').trim();
      const dateStr = String(row[3] || '').trim();
      if (!extId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

      const masuk = String(row[4] || '').trim() || null;
      const keluar = String(row[5] || '').trim() || null;
      const lateMin = parseInt(row[8] || '0', 10) || 0;
      const earlyMin = parseInt(row[9] || '0', 10) || 0;
      const absentMin = parseInt(row[10] || '0', 10) || 0;
      const totalMin = parseInt(row[11] || '0', 10) || 0;
      const notes = String(row[12] || '').trim() || null;

      const key = `${extId}|${dateStr}`;
      const punchesFromLog = punchIndex.get(key) || [];

      // Combine punches
      const punchSet = new Set(punchesFromLog);
      if (masuk) punchSet.add(masuk);
      if (keluar) punchSet.add(keluar);
      const combinedPunches = [...punchSet].sort();

      dailyRecords.push({
        external_employee_id: extId,
        external_name: extName,
        department: dept,
        attendance_date: dateStr,
        first_check_in: masuk || (combinedPunches[0] || null),
        last_check_out: keluar || (combinedPunches.length > 1 ? combinedPunches[combinedPunches.length - 1] : null),
        late_minutes: lateMin,
        early_leave_minutes: earlyMin,
        absent_minutes: absentMin,
        total_minutes: totalMin,
        raw_punches: combinedPunches,
        notes,
      });
      // Mark as processed in punchIndex
      punchIndex.delete(key);
    }
  }

  // Any remaining punches in punchIndex without Exception Stat. rows
  for (const [key, punches] of punchIndex.entries()) {
    const [extId, dateStr] = key.split('|');
    const sorted = [...new Set(punches)].sort();
    dailyRecords.push({
      external_employee_id: extId,
      attendance_date: dateStr,
      first_check_in: sorted[0] || null,
      last_check_out: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      late_minutes: 0,
      early_leave_minutes: 0,
      absent_minutes: 0,
      total_minutes: 0,
      raw_punches: sorted,
      notes: null,
    });
  }

  return dailyRecords;
}

/**
 * 6. Match Employees
 * Deterministic multi-stage matching against existingIdentities, DB employees, and DB barbers.
 */
function matchEmployees({ fileEmployees, dbEmployees = [], dbBarbers = [], existingIdentities = [] }) {
  const identityMap = new Map();
  for (const idn of existingIdentities) {
    if (idn.source === 'fingerprint' && idn.external_employee_id) {
      identityMap.set(String(idn.external_employee_id).trim(), idn);
    }
  }

  const matched = [];
  const unmatched = [];

  for (const fe of fileEmployees) {
    const extId = fe.external_employee_id;
    const extName = fe.external_name;
    const normExtName = normalizeAlphanumeric(extName);

    // Priority 1: Known mapping in identity table
    if (identityMap.has(extId)) {
      const idn = identityMap.get(extId);
      matched.push({
        ...fe,
        match_type: 'identity_mapping',
        target_type: idn.target_type,
        employee_id: idn.employee_id || null,
        barber_id: idn.barber_id || null,
        target_name: idn.external_name || extName,
      });
      continue;
    }

    // Priority 2: Match employees.employee_code
    const empByCode = dbEmployees.find(e => String(e.employee_code || '').trim() === extId);
    if (empByCode) {
      matched.push({
        ...fe,
        match_type: 'employee_code',
        target_type: 'employee',
        employee_id: empByCode.id,
        barber_id: null,
        target_name: empByCode.name,
      });
      continue;
    }

    // Priority 3: Exact deterministic normalized name or nickname
    // Check DB employees
    const empMatches = dbEmployees.filter(e => {
      const nName = normalizeAlphanumeric(e.name);
      const nNick = normalizeAlphanumeric(e.nickname);
      return nName === normExtName || (nNick && nNick === normExtName);
    });

    // Check DB barbers
    const barMatches = dbBarbers.filter(b => {
      const nName = normalizeAlphanumeric(b.name);
      return nName === normExtName;
    });

    const totalMatches = empMatches.length + barMatches.length;

    if (totalMatches === 1) {
      if (empMatches.length === 1) {
        const emp = empMatches[0];
        matched.push({
          ...fe,
          match_type: 'normalized_exact_employee',
          target_type: 'employee',
          employee_id: emp.id,
          barber_id: null,
          target_name: emp.name,
        });
      } else {
        const bar = barMatches[0];
        matched.push({
          ...fe,
          match_type: 'normalized_exact_barber',
          target_type: 'barber',
          employee_id: null,
          barber_id: bar.id,
          target_name: bar.name,
        });
      }
      continue;
    }

    // Priority 4: Ambiguous (> 1 match) or 0 match -> Flag UNMATCHED
    unmatched.push({
      ...fe,
      reason: totalMatches > 1 ? 'ambiguous_name_match' : 'unresolved_employee',
      candidate_matches: [
        ...empMatches.map(e => ({ type: 'employee', id: e.id, name: e.name, nickname: e.nickname, branch: e.branch })),
        ...barMatches.map(b => ({ type: 'barber', id: b.id, name: b.name, branch: b.branch })),
      ],
    });
  }

  return { matched, unmatched };
}

/**
 * 7. Derive Attendance Status
 */
function deriveAttendanceStatus(record) {
  const punches = record.raw_punches || [];
  const lateMin = record.late_minutes || 0;
  const absentMin = record.absent_minutes || 0;

  if (punches.length === 0) {
    if (absentMin > 0) return 'absent';
    return 'off';
  }

  if (punches.length === 1) {
    return lateMin > 0 ? 'terlambat' : 'incomplete';
  }

  if (lateMin > 0) return 'terlambat';
  return 'hadir';
}

/**
 * 8. Preview Import (Stage B) — ZERO DB Mutation
 */
async function previewImport({ buffer, filename, uploadedBy, supabase }) {
  const fileMeta = validateFileSafety(buffer, filename);
  const workbook = parseWorkbook(buffer);
  detectReportFormat(workbook);
  const period = extractReportPeriod(workbook);
  const fileEmployees = extractEmployees(workbook);
  const dailyRecords = extractDailyPunches(workbook, period);

  // Check if hash already exists in DB
  let isDuplicate = false;
  let existingBatch = null;
  if (supabase) {
    const { data: b } = await supabase
      .from('attendance_import_batches')
      .select('id, filename, uploaded_at, status, rows_imported')
      .eq('file_hash', fileMeta.fileHash)
      .maybeSingle();
    if (b) {
      isDuplicate = true;
      existingBatch = b;
    }
  }

  // Load active DB employees, barbers, and existing identities
  let dbEmployees = [];
  let dbBarbers = [];
  let existingIdentities = [];

  if (supabase) {
    const [empRes, barRes, idnRes] = await Promise.all([
      supabase.from('employees').select('id, employee_code, name, nickname, position, branch, business_unit').eq('is_active', true),
      supabase.from('barbers').select('id, name, branch').eq('is_active', true),
      supabase.from('employee_attendance_identity').select('*').eq('source', 'fingerprint'),
    ]);
    dbEmployees = empRes.data || [];
    dbBarbers = barRes.data || [];
    existingIdentities = idnRes.data || [];
  }

  const { matched, unmatched } = matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers,
    existingIdentities,
  });

  const warnings = [];

  if (isDuplicate) {
    warnings.push({
      type: 'duplicate_batch',
      message: `File ini pernah diunggah sebelumnya pada ${new Date(existingBatch.uploaded_at).toLocaleString('id-ID')} (Status: ${existingBatch.status}). Mengimpor ulang akan memperbarui data secara aman tanpa duplikasi.`,
    });
  }

  if (unmatched.length > 0) {
    warnings.push({
      type: 'unmatched_employees',
      message: `${unmatched.length} karyawan mesin tidak dapat dicocokkan otomatis dengan database. Record mereka akan diarahkan ke Exception Review.`,
      unmatched_ids: unmatched.map(u => u.external_employee_id),
    });
  }

  // Check single punches
  const singlePunchRecords = dailyRecords.filter(r => (r.raw_punches || []).length === 1);
  if (singlePunchRecords.length > 0) {
    warnings.push({
      type: 'single_punches',
      message: `Ditemukan ${singlePunchRecords.length} record presensi yang hanya memiliki 1 punch (missing check-in atau check-out).`,
      count: singlePunchRecords.length,
    });
  }

  return {
    filename: fileMeta.cleanFilename,
    file_hash: fileMeta.fileHash,
    period,
    employees_detected: fileEmployees.length,
    matched_count: matched.length,
    unmatched_count: unmatched.length,
    punch_records_count: dailyRecords.length,
    warnings_count: warnings.length,
    is_duplicate: isDuplicate,
    existing_batch: existingBatch,
    matched,
    unmatched,
    warnings,
    sample_records: dailyRecords.slice(0, 20).map(r => ({
      external_employee_id: r.external_employee_id,
      name: r.external_name,
      date: r.attendance_date,
      first_check_in: r.first_check_in,
      last_check_out: r.last_check_out,
      punches: r.raw_punches,
      late_minutes: r.late_minutes,
      derived_status: deriveAttendanceStatus(r),
    })),
  };
}

/**
 * 9. Commit Import (Stage C) — Write to Database Idempotently
 */
async function commitImport({ buffer, filename, uploadedBy, userAuth, supabase, manualMappings = [] }) {
  if (!supabase) {
    const err = new Error('Supabase client is required for commit');
    err.code = 'SUPABASE_REQUIRED';
    throw err;
  }

  const fileMeta = validateFileSafety(buffer, filename);
  const workbook = parseWorkbook(buffer);
  detectReportFormat(workbook);
  const period = extractReportPeriod(workbook);
  const fileEmployees = extractEmployees(workbook);
  const dailyRecords = extractDailyPunches(workbook, period);

  // Apply any manualMappings passed by manager
  if (Array.isArray(manualMappings) && manualMappings.length > 0) {
    for (const mapping of manualMappings) {
      if (mapping.external_employee_id && (mapping.employee_id || mapping.barber_id)) {
        await supabase
          .from('employee_attendance_identity')
          .upsert({
            source: 'fingerprint',
            external_employee_id: String(mapping.external_employee_id).trim(),
            external_name: mapping.external_name || null,
            target_type: mapping.target_type || (mapping.employee_id ? 'employee' : 'barber'),
            employee_id: mapping.employee_id || null,
            barber_id: mapping.barber_id || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'source,external_employee_id' });
      }
    }
  }

  // Fetch updated identities & workforce
  const [empRes, barRes, idnRes] = await Promise.all([
    supabase.from('employees').select('id, employee_code, name, nickname, position, branch, business_unit').eq('is_active', true),
    supabase.from('barbers').select('id, name, branch').eq('is_active', true),
    supabase.from('employee_attendance_identity').select('*').eq('source', 'fingerprint'),
  ]);
  const dbEmployees = empRes.data || [];
  const dbBarbers = barRes.data || [];
  const existingIdentities = idnRes.data || [];

  const { matched, unmatched } = matchEmployees({
    fileEmployees,
    dbEmployees,
    dbBarbers,
    existingIdentities,
  });

  const matchedMap = new Map();
  for (const m of matched) {
    matchedMap.set(m.external_employee_id, m);
  }

  // Create or update import batch
  const { data: batch, error: batchErr } = await supabase
    .from('attendance_import_batches')
    .insert({
      filename: fileMeta.cleanFilename,
      file_hash: fileMeta.fileHash,
      period_from: period.from,
      period_to: period.to,
      uploaded_by: uploadedBy || userAuth?.email || 'manager',
      status: 'importing',
      rows_detected: dailyRecords.length,
      metadata: {
        employees_detected: fileEmployees.length,
        matched: matched.length,
        unmatched: unmatched.length,
      },
    })
    .select()
    .single();

  if (batchErr || !batch) {
    const err = new Error('Gagal membuat batch impor: ' + (batchErr?.message || 'unknown'));
    err.code = 'BATCH_CREATION_FAILED';
    throw err;
  }

  const batchId = batch.id;
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let exceptionsCount = 0;

  const employeeAttendanceRows = [];
  const barberAttendanceRows = [];
  const exceptionRows = [];

  for (const record of dailyRecords) {
    const match = matchedMap.get(record.external_employee_id);

    // Case 1: Unmatched Employee -> goes to Exception Review
    if (!match) {
      exceptionRows.push({
        import_batch_id: batchId,
        attendance_date: record.attendance_date,
        external_employee_id: record.external_employee_id,
        external_name: record.external_name || null,
        department: record.department || null,
        exception_type: 'unmatched_employee',
        details: `Karyawan mesin ID ${record.external_employee_id} (${record.external_name}) belum terhubung ke database.`,
        raw_data: record,
        status: 'pending',
      });
      exceptionsCount++;
      continue;
    }

    const derivedStatus = deriveAttendanceStatus(record);

    // Check for single punch anomaly
    const punches = record.raw_punches || [];
    if (punches.length === 1) {
      exceptionRows.push({
        import_batch_id: batchId,
        attendance_date: record.attendance_date,
        external_employee_id: record.external_employee_id,
        external_name: match.target_name || record.external_name,
        department: record.department || null,
        exception_type: 'single_punch',
        details: `Hanya ditemukan 1 punch jam ${punches[0]}. Missing check-in / check-out.`,
        raw_data: record,
        status: 'pending',
      });
      exceptionsCount++;
    }

    if (match.target_type === 'employee') {
      employeeAttendanceRows.push({
        employee_id: match.employee_id,
        attendance_date: record.attendance_date,
        first_check_in: record.first_check_in,
        last_check_out: record.last_check_out,
        status: derivedStatus,
        late_minutes: record.late_minutes || 0,
        early_leave_minutes: record.early_leave_minutes || 0,
        overtime_minutes: 0,
        raw_punches: record.raw_punches || [],
        source: 'fingerprint',
        import_batch_id: batchId,
        notes: record.notes || null,
        updated_at: new Date().toISOString(),
      });
    } else if (match.target_type === 'barber') {
      // Barbers: check existing terminal check-in to protect live floor authority
      barberAttendanceRows.push({
        barber_id: match.barber_id,
        date: record.attendance_date,
        status: derivedStatus === 'terlambat' ? 'terlambat' : 'hadir',
        note: `Fingerprint ${record.first_check_in || ''}-${record.last_check_out || ''}`.trim(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Write regular employee attendance (idempotent upsert)
  if (employeeAttendanceRows.length > 0) {
    const { error: empAttErr } = await supabase
      .from('employee_attendance')
      .upsert(employeeAttendanceRows, { onConflict: 'employee_id,attendance_date' });
    if (empAttErr) {
      console.error('Error upserting employee_attendance:', empAttErr);
      throw empAttErr;
    }
    importedCount += employeeAttendanceRows.length;
  }

  // Write barber attendance if date doesn't exist
  if (barberAttendanceRows.length > 0) {
    const barberDates = barberAttendanceRows.map(r => r.date);
    const barberIds = [...new Set(barberAttendanceRows.map(r => r.barber_id))];
    const { data: existingBarberAtt } = await supabase
      .from('barber_attendance')
      .select('barber_id, date')
      .in('barber_id', barberIds)
      .in('date', barberDates);

    const existingSet = new Set((existingBarberAtt || []).map(r => `${r.barber_id}|${r.date}`));
    const newBarberRows = barberAttendanceRows.filter(r => !existingSet.has(`${r.barber_id}|${r.date}`));

    if (newBarberRows.length > 0) {
      await supabase.from('barber_attendance').insert(newBarberRows);
      importedCount += newBarberRows.length;
    }
  }

  // Write exceptions
  if (exceptionRows.length > 0) {
    await supabase.from('attendance_exceptions').insert(exceptionRows);
  }

  const finalStatus = exceptionRows.length > 0 ? 'partial' : 'completed';

  await supabase
    .from('attendance_import_batches')
    .update({
      status: finalStatus,
      rows_imported: importedCount,
      rows_skipped: skippedCount,
      rows_failed: exceptionsCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  return {
    batch_id: batchId,
    status: finalStatus,
    period,
    employees_detected: fileEmployees.length,
    matched_count: matched.length,
    unmatched_count: unmatched.length,
    rows_imported: importedCount,
    rows_exceptions: exceptionsCount,
    message: finalStatus === 'completed'
      ? 'Impor absensi fingerprint berhasil diselesaikan.'
      : `Impor selesai sebagian: ${importedCount} baris tersimpan, ${exceptionsCount} exception memerlukan review.`,
  };
}

module.exports = {
  OLE2_MAGIC,
  ZIP_MAGIC,
  normalizeText,
  normalizeAlphanumeric,
  validateFileSafety,
  parseWorkbook,
  detectReportFormat,
  extractReportPeriod,
  extractEmployees,
  extractDailyPunches,
  matchEmployees,
  deriveAttendanceStatus,
  previewImport,
  commitImport,
};
