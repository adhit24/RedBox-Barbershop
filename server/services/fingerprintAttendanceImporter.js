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

const TERMINATED_WORKFORCE_NAMES = new Set(['ajeng', 'reka', 'anggi', 'hardi', 'farhan']);

function isTerminatedWorkforceName(value) {
  return TERMINATED_WORKFORCE_NAMES.has(normalizeAlphanumeric(value));
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
 * Machine scoping. Fingerprint machine IDs are only unique WITHIN a machine
 * (Bypass ID 3 != Samadikun ID 3), so identity rows for a named machine are
 * stored with source = 'fingerprint:<machine>'. The machine is declared by the
 * uploader (never derived from the filename or the employee's business unit).
 * Without a machine the legacy global source 'fingerprint' is used.
 */
const LEGACY_IDENTITY_SOURCE = 'fingerprint';

// Identities that must never receive attendance (terminated). Combined with the
// names of inactive employees/barbers loaded from the DB.
// Off/absent (zero-punch) days are only written for identities that clearly use
// this machine (>= 30% of the period's days have a punch). Sporadic identities
// (e.g. one stray punch from an employee whose real machine is elsewhere) only
// contribute the days that actually have punches, never fabricated absences.
const PRIMARY_MACHINE_MIN_PUNCH_DAY_RATIO = 0.3;

const TERMINATED_NAMES = ['Ajeng', 'Reka', 'Anggi', 'Hardi', 'Farhan'];

function normalizeMachineSource(machineSource) {
  const m = normalizeAlphanumeric(machineSource);
  return m || null;
}

/**
 * Machines that can produce fingerprint exports (the same names as the employee/barber branches). The
 * Backoffice flow MUST name one; it is never derived from the filename, the business unit or the employee
 * branch. Adding a machine is a deliberate code change so a typo cannot create a stray identity namespace.
 */
const FINGERPRINT_MACHINES = ['bypass', 'samadikun', 'csb', 'tegal', 'sumber'];

/** Normalize and validate an explicitly chosen machine; throws MACHINE_SOURCE_REQUIRED / MACHINE_SOURCE_UNKNOWN. */
function requireKnownMachineSource(value) {
  const m = normalizeMachineSource(value);
  if (!m) {
    const err = new Error('machine_source wajib diisi: pilih mesin fingerprint sumber file ini');
    err.code = 'MACHINE_SOURCE_REQUIRED';
    throw err;
  }
  if (!FINGERPRINT_MACHINES.includes(m)) {
    const err = new Error(`machine_source tidak dikenal: ${m}`);
    err.code = 'MACHINE_SOURCE_UNKNOWN';
    throw err;
  }
  return m;
}

/**
 * Identity namespaces of an attendance exception, from ITS OWN raw_data (one canonical derivation):
 *   machine_source present -> identitySource = siblingKey = fingerprint:<machine>
 *   legacy record (no machine_source) -> identitySource stays the legacy global 'fingerprint', and the
 *   sibling key stays the legacy raw_data.source value; a legacy record is never reinterpreted as a machine.
 */
function exceptionNamespaces(rawData) {
  const machine = normalizeMachineSource(rawData && rawData.machine_source);
  if (machine) {
    const scoped = `${LEGACY_IDENTITY_SOURCE}:${machine}`;
    return { identitySource: scoped, siblingKey: scoped, machine };
  }
  return {
    identitySource: LEGACY_IDENTITY_SOURCE,
    siblingKey: String((rawData && rawData.source) || LEGACY_IDENTITY_SOURCE).trim(),
    machine: null,
  };
}

function identitySourceFor(machineSource) {
  const m = normalizeMachineSource(machineSource);
  return m ? `${LEGACY_IDENTITY_SOURCE}:${m}` : LEGACY_IDENTITY_SOURCE;
}

/**
 * 6. Match Employees
 * Deterministic multi-stage matching against existingIdentities, DB employees, and DB barbers.
 * No fuzzy matching: anything not resolved exactly is UNMATCHED (manual review),
 * anything matching a terminated identity is REJECTED (no attendance, no exception).
 */
function matchEmployees({ fileEmployees, dbEmployees = [], dbBarbers = [], existingIdentities = [], machineSource = null, terminatedNames = [] }) {
  const identitySource = identitySourceFor(machineSource);
  const identityMap = new Map();
  for (const idn of existingIdentities) {
    if (idn.source === identitySource && idn.external_employee_id) {
      identityMap.set(String(idn.external_employee_id).trim(), idn);
    }
  }

  const terminatedSet = new Set(
    [...TERMINATED_NAMES, ...terminatedNames].map(normalizeAlphanumeric).filter(Boolean)
  );

  const matched = [];
  const unmatched = [];
  const rejected = [];

  for (const fe of fileEmployees) {
    const extId = fe.external_employee_id;
    const extName = fe.external_name;
    const normExtName = normalizeAlphanumeric(extName);

    // Priority 0: former employees explicitly blocked from attendance import.
    // Keep historical master/attendance references intact, but never remap or re-import them.
    if (isTerminatedWorkforceName(extName)) {
      rejected.push({
        ...fe,
        reason: 'terminated_employee',
        blocked: true,
      });
      continue;
    }

    // Priority 1: Known mapping in identity table (machine-scoped)
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
        business_unit: empByCode.business_unit || null,
        branch: empByCode.branch || null,
      });
      continue;
    }

    // Priority 3/4: Exact deterministic normalized name, then nickname
    const empMatches = dbEmployees.filter(e => {
      const nName = normalizeAlphanumeric(e.name);
      const nNick = normalizeAlphanumeric(e.nickname);
      return nName === normExtName || (nNick && nNick === normExtName);
    });
    const barMatches = dbBarbers.filter(b => normalizeAlphanumeric(b.name) === normExtName);
    const totalMatches = empMatches.length + barMatches.length;
    const candidates = [
      ...empMatches.map(e => ({ type: 'employee', id: e.id, name: e.name, nickname: e.nickname, branch: e.branch })),
      ...barMatches.map(b => ({ type: 'barber', id: b.id, name: b.name, branch: b.branch })),
    ];

    // Terminated guard: exact terminated name with no active counterpart -> REJECT
    if (normExtName && terminatedSet.has(normExtName)) {
      if (totalMatches === 0) {
        rejected.push({ ...fe, reason: 'terminated_employee' });
      } else {
        unmatched.push({ ...fe, reason: 'ambiguous_terminated_name', candidate_matches: candidates });
      }
      continue;
    }

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
          business_unit: emp.business_unit || null,
          branch: emp.branch || null,
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
          branch: bar.branch || null,
        });
      }
      continue;
    }

    // Ambiguous (> 1 match) or 0 match -> UNMATCHED / manual review
    unmatched.push({
      ...fe,
      reason: totalMatches > 1 ? 'ambiguous_name_match' : 'unresolved_employee',
      candidate_matches: candidates,
    });
  }

  return { matched, unmatched, rejected };
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
 * Per-machine-identity activity summary from parsed daily records.
 */
function summarizeActivity(dailyRecords) {
  const byId = new Map();
  for (const r of dailyRecords) {
    const s = byId.get(r.external_employee_id) || { days_with_punch: 0, total_punches: 0, records: 0 };
    const n = (r.raw_punches || []).length;
    s.records++;
    if (n > 0) s.days_with_punch++;
    s.total_punches += n;
    byId.set(r.external_employee_id, s);
  }
  return byId;
}

/**
 * Identity mapping report: one row per machine identity with status
 * AUTO_MATCH_SAFE | MANUAL_REVIEW | REJECTED_TERMINATED.
 */
function buildIdentityReport({ machineSource, matched, unmatched, rejected, dailyRecords }) {
  const activity = summarizeActivity(dailyRecords);
  const machine = normalizeMachineSource(machineSource);
  const base = (fe) => ({
    machine_id: fe.external_employee_id,
    machine_name: fe.external_name,
    machine_source: machine,
    machine_department: fe.department || null,
    ...(activity.get(fe.external_employee_id) || { days_with_punch: 0, total_punches: 0, records: 0 }),
  });
  const none = { matched_employee: null, target_type: null, business_unit: null, branch: null, confidence: 'NONE' };
  return [
    ...matched.map(m => ({
      ...base(m),
      matched_employee: m.target_name,
      target_type: m.target_type,
      business_unit: m.business_unit || null,
      branch: m.branch || null,
      match_method: m.match_type,
      confidence: m.match_type === 'identity_mapping' || m.match_type === 'employee_code' ? 'HIGH' : 'HIGH_EXACT_NAME',
      status: 'AUTO_MATCH_SAFE',
    })),
    ...unmatched.map(u => ({
      ...base(u), ...none,
      match_method: u.reason,
      status: 'MANUAL_REVIEW',
      candidates: u.candidate_matches || [],
    })),
    ...rejected.map(r => ({
      ...base(r), ...none,
      match_method: r.reason,
      status: 'REJECTED_TERMINATED',
    })),
  ];
}

async function safeSelect(buildQuery) {
  try {
    const res = await buildQuery();
    return res && res.data ? res.data : [];
  } catch (_) {
    return [];
  }
}

/**
 * Read every row of a query page by page (PostgREST caps a response at 1000 rows). buildQuery must
 * return a fresh query with a deterministic order each call. A failed read throws: callers use the
 * result to avoid overwriting/duplicating data, so treating a failure as "no rows" would be unsafe.
 * (Only exceptions thrown by incomplete test doubles are tolerated; a real client reports errors
 * via res.error.)
 */
async function readAllPages(buildQuery, { pageSize = 1000, failMessage, failCode } = {}) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    let res;
    let pageable = false;
    try {
      const q = buildQuery();
      pageable = typeof q.range === 'function';
      res = await (pageable ? q.range(offset, offset + pageSize - 1) : q);
    } catch (_) {
      return out;
    }
    if (res && res.error) {
      const err = new Error(`${failMessage}: ${res.error.message}`);
      err.code = failCode;
      throw err;
    }
    const rows = (res && res.data) || [];
    out.push(...rows);
    if (!pageable || rows.length < pageSize) break;
  }
  return out;
}

/**
 * Existing attendance rows for the imported employees, restricted to the imported period. A row
 * missed here would be treated as new and its prior punch evidence overwritten.
 */
function fetchExistingAttendance(supabase, employeeIds, dateFrom, dateTo, pageSize = 1000) {
  return readAllPages(() => supabase
    .from('employee_attendance')
    .select('employee_id, attendance_date, first_check_in, last_check_out, status, late_minutes, early_leave_minutes, raw_punches, notes')
    .in('employee_id', employeeIds)
    .gte('attendance_date', dateFrom)
    .lte('attendance_date', dateTo)
    .order('employee_id')
    .order('attendance_date'), {
    pageSize,
    failMessage: 'Gagal membaca presensi existing untuk merge',
    failCode: 'EXISTING_ATTENDANCE_READ_FAILED',
  });
}

/**
 * Pending exceptions relevant to this import (import period + the identities being written), used to
 * de-duplicate on re-import. Bounded and paged so history beyond the first page cannot hide a duplicate.
 */
function fetchPendingExceptions(supabase, externalIds, dateFrom, dateTo, pageSize = 1000) {
  return readAllPages(() => supabase
    .from('attendance_exceptions')
    .select('id, external_employee_id, attendance_date, exception_type, raw_data')
    .eq('status', 'pending')
    .in('external_employee_id', externalIds)
    .gte('attendance_date', dateFrom)
    .lte('attendance_date', dateTo)
    .order('attendance_date')
    .order('external_employee_id')
    .order('id'), {
    pageSize,
    failMessage: 'Gagal membaca exception pending untuk deduplikasi',
    failCode: 'EXISTING_EXCEPTIONS_READ_FAILED',
  });
}

/**
 * Load active workforce, machine-scoped identities and terminated names.
 */
async function loadMatchingContext(supabase, machineSource) {
  const identitySource = identitySourceFor(machineSource);
  const [empRes, barRes, idnRes] = await Promise.all([
    supabase.from('employees').select('id, employee_code, name, nickname, position, branch, business_unit').eq('is_active', true),
    supabase.from('barbers').select('id, name, branch').eq('is_active', true),
    supabase.from('employee_attendance_identity').select('*').eq('source', identitySource),
  ]);

  const terminatedNames = [];
  const [inactiveEmp, inactiveBar] = await Promise.all([
    safeSelect(() => supabase.from('employees').select('name, nickname').eq('is_active', false)),
    safeSelect(() => supabase.from('barbers').select('name').eq('is_active', false)),
  ]);
  for (const e of inactiveEmp) terminatedNames.push(e.name, e.nickname);
  for (const b of inactiveBar) terminatedNames.push(b.name);

  return {
    dbEmployees: empRes.data || [],
    dbBarbers: barRes.data || [],
    existingIdentities: idnRes.data || [],
    terminatedNames: terminatedNames.filter(Boolean),
  };
}

/**
 * Merge two attendance records for the same employee+date (e.g. same person
 * enrolled on two machines, or an existing row from another import). Punch
 * evidence is unioned, never lost; a zero-punch record never overrides one
 * that has punches.
 */
function mergeAttendanceRecords(a, b) {
  const pa = a.raw_punches || [];
  const pb = b.raw_punches || [];
  if (pa.length === 0 && pb.length === 0) return { ...b };
  if (pa.length === 0) return { ...b };
  if (pb.length === 0) return { ...a };
  const punches = [...new Set([...pa, ...pb])].sort();
  // Late minutes belong to whichever record holds the earliest check-in.
  const earliest = pa[0] <= pb[0] ? a : b;
  const merged = {
    ...earliest,
    raw_punches: punches,
    first_check_in: punches[0] || null,
    last_check_out: punches.length > 1 ? punches[punches.length - 1] : null,
  };
  merged.status = deriveAttendanceStatus(merged);
  return merged;
}

/**
 * 8. Preview Import (Stage B) — ZERO DB Mutation
 */
async function previewImport({ buffer, filename, uploadedBy, supabase, machineSource = null }) {
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

  let ctx = { dbEmployees: [], dbBarbers: [], existingIdentities: [], terminatedNames: [] };
  if (supabase) ctx = await loadMatchingContext(supabase, machineSource);
  const { matched, unmatched, rejected } = matchEmployees({
    fileEmployees,
    ...ctx,
    machineSource,
  });

  const activity = summarizeActivity(dailyRecords);
  const relevantUnmatched = unmatched.filter(u => (activity.get(u.external_employee_id)?.total_punches || 0) > 0);

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
      relevant_unmatched_ids: relevantUnmatched.map(u => u.external_employee_id),
    });
  }

  if (rejected.length > 0) {
    warnings.push({
      type: 'rejected_terminated',
      message: `${rejected.length} identitas mesin ditolak karena karyawan terminated (tidak ada presensi & tidak ada exception).`,
      rejected_ids: rejected.map(r => r.external_employee_id),
    });
  }

  if (rejected.length > 0) {
    warnings.push({
      type: 'terminated_employees_rejected',
      message: `${rejected.length} nama mantan karyawan ditolak dan tidak akan diimpor ke attendance.`,
      rejected_names: rejected.map(r => r.external_name),
      rejected_ids: rejected.map(r => r.external_employee_id),
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
    machine_source: normalizeMachineSource(machineSource),
    period,
    employees_detected: fileEmployees.length,
    matched_count: matched.length,
    unmatched_count: unmatched.length,
    rejected_count: rejected.length,
    punch_records_count: dailyRecords.length,
    warnings_count: warnings.length,
    is_duplicate: isDuplicate,
    existing_batch: existingBatch,
    matched,
    unmatched,
    rejected,
    identity_report: buildIdentityReport({ machineSource, matched, unmatched, rejected, dailyRecords }),
    warnings,
    metadata: parsedData.metadata || {},
    sample_records: dailyRecords
      .filter(r => !new Set(rejected.map(x => x.external_employee_id)).has(r.external_employee_id))
      .slice(0, 20)
      .map(r => ({
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
async function commitImport({ buffer, filename, uploadedBy, userAuth, supabase, manualMappings = [], machineSource = null }) {
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
  const identitySource = identitySourceFor(machineSource);

  // Apply any manualMappings passed by manager.
  // Explicitly block former employees even if a manager attempts to remap them manually.
  const fileEmployeeById = new Map(fileEmployees.map(e => [String(e.external_employee_id || '').trim(), e]));
  if (Array.isArray(manualMappings) && manualMappings.length > 0) {
    for (const mapping of manualMappings) {
      const sourceEmployee = fileEmployeeById.get(String(mapping.external_employee_id || '').trim());
      if (sourceEmployee && isTerminatedWorkforceName(sourceEmployee.external_name)) {
        const err = new Error(`Nama ${sourceEmployee.external_name} sudah tidak aktif dan ditolak dari attendance import.`);
        err.code = 'TERMINATED_EMPLOYEE_MAPPING_BLOCKED';
        throw err;
      }
      if (mapping.external_employee_id && (mapping.employee_id || mapping.barber_id)) {
        await supabase
          .from('employee_attendance_identity')
          .upsert({
            source: identitySource,
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
  const ctx = await loadMatchingContext(supabase, machineSource);

  const { matched, unmatched, rejected } = matchEmployees({
    fileEmployees,
    ...ctx,
    machineSource,
  });

  const matchedMap = new Map();
  for (const m of matched) {
    matchedMap.set(m.external_employee_id, m);
  }
  const rejectedIds = new Set(rejected.map(r => r.external_employee_id));
  const activity = summarizeActivity(dailyRecords);
  const hasPunches = (id) => (activity.get(id)?.total_punches || 0) > 0;
  const isPrimaryMachineUser = (id) => {
    const a = activity.get(id);
    return !!a && a.records > 0 && a.days_with_punch / a.records >= PRIMARY_MACHINE_MIN_PUNCH_DAY_RATIO;
  };

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
        machine_source: normalizeMachineSource(machineSource),
        employees_detected: fileEmployees.length,
        matched: matched.length,
        unmatched: unmatched.length,
        rejected_terminated: rejected.length,
        rejected_terminated_names: rejected.map(r => r.external_name),
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
  let rowsInserted = 0;
  let rowsUpdated = 0;

  const employeeAttendanceMap = new Map(); // employee_id|date -> row
  const barberAttendanceRows = [];
  const exceptionRows = [];

  for (const record of dailyRecords) {
    // Terminated identities: reject silently (no attendance, no exception)
    if (rejectedIds.has(record.external_employee_id)) {
      skippedCount++;
      continue;
    }

    const match = matchedMap.get(record.external_employee_id);
    const punches = record.raw_punches || [];

    // Case 1: Unmatched -> Exception Review, only for days that have punch evidence
    if (!match) {
      if (punches.length === 0) {
        skippedCount++;
        continue;
      }
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

    // No punch at all in the period, or a sporadic identity's zero-punch day: no
    // evidence, do not fabricate absent/off rows (the person likely uses another source).
    if (!hasPunches(record.external_employee_id) || (punches.length === 0 && !isPrimaryMachineUser(record.external_employee_id))) {
      skippedCount++;
      continue;
    }

    const derivedStatus = deriveAttendanceStatus(record);

    // Check for single punch anomaly
    if (punches.length === 1) {
      exceptionRows.push({
        import_batch_id: batchId,
        attendance_date: record.attendance_date,
        external_employee_id: record.external_employee_id,
        external_name: match.target_name || record.external_name,
        department: record.department || null,
        exception_type: 'single_punch',
        details: `Hanya ditemukan 1 punch jam ${punches[0]}. Missing check-in / check-out.`,
        raw_data: { ...record, employee_id: match.employee_id || null, barber_id: match.barber_id || null },
        status: 'pending',
      });
      exceptionsCount++;
    }

    if (match.target_type === 'employee') {
      const row = {
        employee_id: match.employee_id,
        attendance_date: record.attendance_date,
        first_check_in: record.first_check_in,
        last_check_out: record.last_check_out,
        status: derivedStatus,
        late_minutes: record.late_minutes || 0,
        early_leave_minutes: record.early_leave_minutes || 0,
        overtime_minutes: 0,
        raw_punches: punches,
        source: 'fingerprint',
        import_batch_id: batchId,
        notes: record.notes || null,
        updated_at: new Date().toISOString(),
      };
      const key = `${row.employee_id}|${row.attendance_date}`;
      const prev = employeeAttendanceMap.get(key);
      if (prev) {
        // Same person enrolled twice on this machine: union the evidence.
        const merged = mergeAttendanceRecords(prev, row);
        employeeAttendanceMap.set(key, { ...row, ...merged, employee_id: row.employee_id, attendance_date: row.attendance_date });
      } else {
        employeeAttendanceMap.set(key, row);
      }
    } else if (match.target_type === 'barber' && punches.length > 0) {
      barberAttendanceRows.push({
        barber_id: match.barber_id,
        date: record.attendance_date,
        status: derivedStatus === 'terlambat' ? 'terlambat' : 'hadir',
        note: `Fingerprint ${record.first_check_in || ''}-${record.last_check_out || ''}`.trim(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Merge with rows already in DB (other machines / earlier imports) so real
  // punch evidence is never degraded. Idempotent: re-importing the same file
  // unions identical punches.
  let employeeAttendanceRows = [...employeeAttendanceMap.values()];
  if (employeeAttendanceRows.length > 0) {
    const empIds = [...new Set(employeeAttendanceRows.map(r => r.employee_id))];
    const existingRows = await fetchExistingAttendance(supabase, empIds, period.from, period.to);
    const existingMap = new Map(existingRows.map(r => [`${r.employee_id}|${r.attendance_date}`, r]));
    employeeAttendanceRows = employeeAttendanceRows.map(row => {
      const ex = existingMap.get(`${row.employee_id}|${row.attendance_date}`);
      if (!ex) { rowsInserted++; return row; }
      rowsUpdated++;
      const merged = mergeAttendanceRecords({ ...ex, raw_punches: ex.raw_punches || [] }, row);
      return {
        ...row,
        first_check_in: merged.first_check_in ?? row.first_check_in,
        last_check_out: merged.last_check_out ?? row.last_check_out,
        status: merged.status || row.status,
        late_minutes: merged.late_minutes ?? row.late_minutes,
        raw_punches: merged.raw_punches || row.raw_punches,
      };
    });
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
    const seen = new Set();
    const newBarberRows = barberAttendanceRows.filter(r => {
      const k = `${r.barber_id}|${r.date}`;
      if (existingSet.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (newBarberRows.length > 0) {
      await supabase.from('barber_attendance').insert(newBarberRows);
      importedCount += newBarberRows.length;
    }
  }

  // Persist deterministic machine-scoped identities (audit + stable future imports)
  let identitiesSaved = 0;
  if (normalizeMachineSource(machineSource)) {
    const newIdentities = matched
      .filter(m => m.match_type !== 'identity_mapping' && hasPunches(m.external_employee_id))
      .map(m => ({
        source: identitySource,
        external_employee_id: m.external_employee_id,
        external_name: m.external_name || null,
        target_type: m.target_type,
        employee_id: m.employee_id || null,
        barber_id: m.barber_id || null,
        updated_at: new Date().toISOString(),
      }));
    if (newIdentities.length > 0) {
      const { error: idnErr } = await supabase
        .from('employee_attendance_identity')
        .upsert(newIdentities, { onConflict: 'source,external_employee_id' });
      if (!idnErr) identitiesSaved = newIdentities.length;
    }
  }

  // Write exceptions (idempotent: skip ones already pending for the same machine identity/day/type)
  const machineKey = normalizeMachineSource(machineSource);
  const excKey = (e, machine) => `${machine || ''}|${e.external_employee_id}|${e.attendance_date}|${e.exception_type}`;
  let newExceptionRows = exceptionRows.map(e => ({ ...e, raw_data: { ...(e.raw_data || {}), machine_source: machineKey } }));
  if (newExceptionRows.length > 0) {
    const externalIds = [...new Set(newExceptionRows.map(e => e.external_employee_id))];
    const existingExc = await fetchPendingExceptions(supabase, externalIds, period.from, period.to);
    const existingKeys = new Set(existingExc.map(e => excKey(e, e.raw_data?.machine_source)));
    newExceptionRows = newExceptionRows.filter(e => !existingKeys.has(excKey(e, machineKey)));
  }
  if (newExceptionRows.length > 0) {
    await supabase.from('attendance_exceptions').insert(newExceptionRows);
  }
  exceptionsCount = newExceptionRows.length;

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
    machine_source: normalizeMachineSource(machineSource),
    employees_detected: fileEmployees.length,
    matched_count: matched.length,
    unmatched_count: unmatched.length,
    rejected_count: rejected.length,
    rows_imported: importedCount,
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    rows_skipped: skippedCount,
    rows_exceptions: exceptionsCount,
    identities_saved: identitiesSaved,
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
  TERMINATED_WORKFORCE_NAMES,
  isTerminatedWorkforceName,
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
  mergeAttendanceRecords,
  fetchExistingAttendance,
  fetchPendingExceptions,
  buildIdentityReport,
  identitySourceFor,
  exceptionNamespaces,
  normalizeMachineSource,
  requireKnownMachineSource,
  FINGERPRINT_MACHINES,
  TERMINATED_NAMES,
  PRIMARY_MACHINE_MIN_PUNCH_DAY_RATIO,
  previewImport,
  commitImport,
};
