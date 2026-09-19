'use strict';

const crypto = require('crypto');
const XLSX = require('xlsx');
const {
  FORMAT_STANDARD_FLAT,
  FORMAT_TEGAL_HORIZONTAL,
  detectAttendanceFormat,
} = require('./attendanceParsers/attendanceFormatDetector');
const standardParser = require('./attendanceParsers/standardFlatAttendanceParser');
const tegalParser = require('./attendanceParsers/tegalHorizontalAttendanceParser');

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
 * Supports .xls, .xlsx, and .csv.
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
  const isXls = lowerName.endsWith('.xls');
  const isXlsx = lowerName.endsWith('.xlsx');
  const isCsv = lowerName.endsWith('.csv');

  if (!isXls && !isXlsx && !isCsv) {
    const err = new Error('Format file tidak didukung. Harap unggah file laporan absensi .xls, .xlsx, atau .csv');
    err.code = 'INVALID_FILE_EXTENSION';
    throw err;
  }

  const hexHeader = buffer.slice(0, 8).toString('hex').toLowerCase();
  const hasOle2Magic = hexHeader.startsWith(OLE2_MAGIC);
  const hasZipMagic = hexHeader.startsWith(ZIP_MAGIC);

  let verifiedXls = false;
  let verifiedXlsx = false;
  let verifiedCsv = false;

  if (isXls) {
    if (!hasOle2Magic) {
      const err = new Error('File tidak valid atau rusak. Tipe file bukan workbook Excel .xls (BIFF8) yang sah');
      err.code = 'INVALID_FILE_SIGNATURE';
      throw err;
    }
    verifiedXls = true;
  } else if (isXlsx) {
    if (!hasZipMagic) {
      const err = new Error('File tidak valid atau rusak. Tipe file bukan workbook Excel .xlsx yang sah');
      err.code = 'INVALID_FILE_SIGNATURE';
      throw err;
    }
    verifiedXlsx = true;
  } else if (isCsv) {
    // Check first 1KB: must be text, not binary or masqueraded OLE2/ZIP
    const sample = buffer.slice(0, 1024);
    if (sample.includes(0x00) || hasOle2Magic || hasZipMagic) {
      const err = new Error('File tidak valid atau rusak. File CSV berisi format biner tidak sah');
      err.code = 'INVALID_FILE_SIGNATURE';
      throw err;
    }
    verifiedCsv = true;
  }

  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    cleanFilename,
    fileHash,
    isXls: verifiedXls,
    isXlsx: verifiedXlsx,
    isCsv: verifiedCsv,
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

/**
 * Parser selector helper
 */
function getParserForFormat(format) {
  if (format === FORMAT_TEGAL_HORIZONTAL) {
    return tegalParser;
  }
  return standardParser;
}

/**
 * Backward-compatible detectReportFormat
 */
function detectReportFormat(workbook) {
  const detected = detectAttendanceFormat(workbook);
  const sheetNames = workbook.SheetNames || [];

  if (detected.format === FORMAT_TEGAL_HORIZONTAL) {
    return {
      format: FORMAT_TEGAL_HORIZONTAL,
      sheetNames,
      hasSummarySheet: sheetNames.some(s => s.toLowerCase() === 'summary'),
      hasLogsSheet: sheetNames.some(s => s.toLowerCase() === 'logs'),
      hasStatAbsen: false,
      hasLogAbsen: false,
      hasExceptionStat: false,
      hasJadwalInfo: false,
    };
  }

  return {
    format: FORMAT_STANDARD_FLAT,
    sheetNames,
    hasStatAbsen: sheetNames.includes('Stat. Absen'),
    hasLogAbsen: sheetNames.includes('Lap. Log Absen'),
    hasExceptionStat: sheetNames.includes('Exception Stat.'),
    hasJadwalInfo: sheetNames.includes('Jadwal Info'),
  };
}

/**
 * Unified Parser Dispatcher
 */
function parseAttendanceWorkbook(workbook) {
  const detected = detectAttendanceFormat(workbook);
  const parser = getParserForFormat(detected.format);
  const parsed = parser.parse(workbook);
  return {
    ...parsed,
    detected,
  };
}

/**
 * 3. Extract Report Period (YYYY-MM-DD ~ YYYY-MM-DD)
 */
function extractReportPeriod(workbook) {
  const detected = detectAttendanceFormat(workbook);
  return getParserForFormat(detected.format).extractPeriod(workbook);
}

/**
 * 4. Extract Employees
 */
function extractEmployees(workbook) {
  const detected = detectAttendanceFormat(workbook);
  return getParserForFormat(detected.format).extractEmployees(workbook);
}

/**
 * 5. Extract Punches & Daily Records
 */
function extractDailyPunches(workbook, period) {
  const detected = detectAttendanceFormat(workbook);
  if (detected.format === FORMAT_TEGAL_HORIZONTAL) {
    const res = tegalParser.extractDailyPunches(workbook, period);
    return res.dailyRecords;
  }
  return standardParser.extractDailyPunches(workbook, period);
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
  const parsedData = parseAttendanceWorkbook(workbook);

  const period = parsedData.period;
  const fileEmployees = parsedData.employees;
  const dailyRecords = parsedData.dailyRecords;

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
    format: parsedData.format,
    detected_format: parsedData.format,
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
    metadata: parsedData.metadata || {},
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
  const parsedData = parseAttendanceWorkbook(workbook);

  const period = parsedData.period;
  const fileEmployees = parsedData.employees;
  const dailyRecords = parsedData.dailyRecords;

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
        format: parsedData.format,
        employees_detected: fileEmployees.length,
        matched: matched.length,
        unmatched: unmatched.length,
        ...(parsedData.metadata || {}),
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
  FORMAT_STANDARD_FLAT,
  FORMAT_TEGAL_HORIZONTAL,
  normalizeText,
  normalizeAlphanumeric,
  validateFileSafety,
  parseWorkbook,
  detectReportFormat,
  detectAttendanceFormat,
  parseAttendanceWorkbook,
  extractReportPeriod,
  extractEmployees,
  extractDailyPunches,
  matchEmployees,
  deriveAttendanceStatus,
  previewImport,
  commitImport,
};
