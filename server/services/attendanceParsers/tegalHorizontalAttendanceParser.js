'use strict';

const XLSX = require('xlsx');

const FORMAT_TEGAL_HORIZONTAL = 'tegal_horizontal_report';

/**
 * Normalizes a time string to HH:mm (e.g. "9:59" -> "09:59").
 */
function normalizeTimeString(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).trim().split(':');
  if (parts.length < 2) return '';
  const hh = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Extracts punch timestamps from a single cell value.
 * Handles \n, \r\n, spaces, ignores words like "OFF", "ABSENT", "-".
 *
 * @param {*} cellValue
 * @returns {string[]} Array of normalized HH:mm strings in order of occurrence
 */
function extractPunchTimes(cellValue) {
  if (cellValue === null || cellValue === undefined) return [];
  const text = String(cellValue).trim();
  if (!text) return [];

  const timeRegex = /\b(\d{1,2}:\d{2})\b/g;
  const matches = text.match(timeRegex);
  if (!matches) return [];

  return matches.map(normalizeTimeString).filter(Boolean);
}

/**
 * Extracts report period (YYYY-MM-DD ~ YYYY-MM-DD) from Tegal Horizontal Report.
 * Handles formats like:
 * - "2026/08/26 ~ 09/19"
 * - "2026/08/26 ~ 2026/09/19"
 * - "2026-08-26 ~ 2026-09-19"
 */
function extractPeriod(workbook) {
  // Regex to match period with full year or short month/day
  // Group 1: Start YYYY/MM/DD
  // Group 2: End (either YYYY/MM/DD or MM/DD)
  const periodPattern = /(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*[~–-]\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})/;

  const searchSheets = ['Logs', 'Summary'];
  const allSheetNames = workbook.SheetNames || [];
  const sheetsToScan = [
    ...searchSheets.filter(s => allSheetNames.includes(s)),
    ...allSheetNames.filter(s => !searchSheets.includes(s)),
  ];

  for (const sheetName of sheetsToScan) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }).slice(0, 10);

    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell || typeof cell !== 'string') continue;
        const match = cell.match(periodPattern);
        if (match) {
          const rawStart = match[1].replace(/\//g, '-');
          const rawEnd = match[2].replace(/\//g, '-');

          // Parse start date: YYYY-MM-DD
          const startParts = rawStart.split('-').map(p => p.padStart(2, '0'));
          const startYear = parseInt(startParts[0], 10);
          const startMonth = parseInt(startParts[1], 10);
          const startDay = parseInt(startParts[2], 10);
          const from = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;

          // Parse end date
          let to = '';
          const endParts = rawEnd.split('-').map(p => p.padStart(2, '0'));
          if (endParts.length === 3) {
            to = `${endParts[0]}-${endParts[1]}-${endParts[2]}`;
          } else if (endParts.length === 2) {
            // "MM-DD": determine year (handles year rollover e.g. Dec -> Jan)
            const endMonth = parseInt(endParts[0], 10);
            const endDay = parseInt(endParts[1], 10);
            const endYear = endMonth < startMonth ? startYear + 1 : startYear;
            to = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
          }

          if (from && to) {
            return { from, to };
          }
        }
      }
    }
  }

  const err = new Error('Periode laporan absensi tidak ditemukan dalam file Tegal');
  err.code = 'REPORT_PERIOD_NOT_FOUND';
  throw err;
}

/**
 * Extracts employees from Summary and Logs sheets.
 * Deduplicates by external_employee_id (handles duplicate blocks for epik & miftah).
 */
function extractEmployees(workbook) {
  const employeesMap = new Map();

  // 1. Read Summary sheet first if present
  const summarySheetName = (workbook.SheetNames || []).find(s => s.toLowerCase() === 'summary');
  if (summarySheetName && workbook.Sheets[summarySheetName]) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[summarySheetName], { header: 1, defval: null });
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row[0] === null || row[0] === undefined || String(row[0]).trim() === '') continue;
      const extId = String(row[0]).trim();
      const extName = String(row[1] || '').trim();
      const dept = row[2] !== null && row[2] !== undefined ? String(row[2]).trim() : null;

      if (extId && extName && !employeesMap.has(extId)) {
        employeesMap.set(extId, {
          external_employee_id: extId,
          external_name: extName,
          department: dept,
        });
      }
    }
  }

  // 2. Read Logs sheet to complement or discover all employees
  const logsSheetName = (workbook.SheetNames || []).find(s => s.toLowerCase() === 'logs');
  if (logsSheetName && workbook.Sheets[logsSheetName]) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[logsSheetName], { header: 1, defval: null });
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const noIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'no :');
      if (noIdx !== -1) {
        // ID is in noIdx + 1 or noIdx + 2
        const rawId = row[noIdx + 1] !== null && row[noIdx + 1] !== undefined && String(row[noIdx + 1]).trim() !== ''
          ? row[noIdx + 1]
          : row[noIdx + 2];
        const extId = String(rawId || '').trim();

        // Name
        const nameIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'name :');
        const rawName = nameIdx !== -1
          ? (row[nameIdx + 1] !== null && row[nameIdx + 1] !== undefined && String(row[nameIdx + 1]).trim() !== ''
              ? row[nameIdx + 1]
              : row[nameIdx + 2])
          : '';
        const extName = String(rawName || '').trim();

        // Department
        const deptIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'dept :');
        const rawDept = deptIdx !== -1
          ? (row[deptIdx + 1] !== null && row[deptIdx + 1] !== undefined && String(row[deptIdx + 1]).trim() !== ''
              ? row[deptIdx + 1]
              : row[deptIdx + 2])
          : null;
        const dept = rawDept ? String(rawDept).trim() : null;

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
 * Extracts daily punches from Tegal Logs sheet.
 * Correctly maps horizontal day columns to dates, accounting for month and year rollover.
 * Preserves raw punches and calculates first_check_in / last_check_out.
 */
function extractDailyPunches(workbook, period) {
  const logsSheetName = (workbook.SheetNames || []).find(s => s.toLowerCase() === 'logs');
  if (!logsSheetName || !workbook.Sheets[logsSheetName]) {
    const err = new Error('Lembar kerja "Logs" tidak ditemukan pada format Tegal.');
    err.code = 'TEGAL_LOGS_SHEET_MISSING';
    throw err;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[logsSheetName], { header: 1, defval: null });
  const employees = extractEmployees(workbook);
  const employeeMetaMap = new Map(employees.map(e => [e.external_employee_id, e]));

  const dailyRecords = [];
  const seenEmployeeBlocks = new Set();

  // Parse start year & month from period.from (e.g. 2026-08-26)
  const periodStartParts = period.from.split('-').map(x => parseInt(x, 10));
  const baseYear = periodStartParts[0];
  const baseMonth = periodStartParts[1];

  let totalRawPunchesCount = 0;
  let totalDistinctPunchesCount = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const noIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'no :');
    if (noIdx === -1) continue;

    // Extract employee ID
    const rawId = row[noIdx + 1] !== null && row[noIdx + 1] !== undefined && String(row[noIdx + 1]).trim() !== ''
      ? row[noIdx + 1]
      : row[noIdx + 2];
    const extId = String(rawId || '').trim();
    if (!extId) continue;

    // Deduplicate duplicate employee blocks in machine file
    if (seenEmployeeBlocks.has(extId)) {
      continue;
    }
    seenEmployeeBlocks.add(extId);

    const empMeta = employeeMetaMap.get(extId) || {
      external_employee_id: extId,
      external_name: '',
      department: null,
    };

    // Day numbers row is r - 1
    const dayRow = rows[r - 1] || [];
    // Punch cells row is r + 1
    const punchRow = rows[r + 1] || [];

    let currentYear = baseYear;
    let currentMonth = baseMonth;
    let prevDay = null;

    for (let c = 0; c < dayRow.length; c++) {
      const dayVal = dayRow[c];
      if (typeof dayVal !== 'number' || isNaN(dayVal) || dayVal < 1 || dayVal > 31) continue;

      // Handle month rollover (e.g. 31 -> 1)
      if (prevDay !== null && dayVal < prevDay) {
        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
      }
      prevDay = dayVal;

      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dayVal).padStart(2, '0')}`;
      const cellVal = punchRow[c];
      if (cellVal === null || cellVal === undefined) continue;

      const extractedPunches = extractPunchTimes(cellVal);
      if (extractedPunches.length === 0) continue;

      totalRawPunchesCount += extractedPunches.length;

      // Deduplicate exact same-minute punch in the same cell (e.g. double-tap 21:00, 21:00)
      const distinctSorted = [...new Set(extractedPunches)].sort();
      totalDistinctPunchesCount += distinctSorted.length;

      const firstCheckIn = distinctSorted[0] || null;
      const lastCheckOut = distinctSorted.length > 1 ? distinctSorted[distinctSorted.length - 1] : null;

      dailyRecords.push({
        external_employee_id: extId,
        external_name: empMeta.external_name,
        department: empMeta.department,
        attendance_date: dateStr,
        first_check_in: firstCheckIn,
        last_check_out: lastCheckOut,
        late_minutes: 0,
        early_leave_minutes: 0,
        absent_minutes: 0,
        total_minutes: 0,
        raw_punches: distinctSorted,
        raw_scans_count: extractedPunches.length,
        notes: null,
      });
    }
  }

  // Sort dailyRecords chronologically by date then employee ID
  dailyRecords.sort((a, b) => {
    if (a.attendance_date !== b.attendance_date) {
      return a.attendance_date.localeCompare(b.attendance_date);
    }
    return a.external_employee_id.localeCompare(b.external_employee_id);
  });

  return {
    dailyRecords,
    stats: {
      totalRawPunchesCount,
      totalDistinctPunchesCount,
      employeeDaysWithAttendance: dailyRecords.length,
    },
  };
}

/**
 * Tegal Horizontal Parser adapter
 */
function parse(workbook) {
  const period = extractPeriod(workbook);
  const employees = extractEmployees(workbook);
  const { dailyRecords, stats } = extractDailyPunches(workbook, period);

  return {
    format: FORMAT_TEGAL_HORIZONTAL,
    period,
    employees,
    dailyRecords,
    metadata: {
      format: FORMAT_TEGAL_HORIZONTAL,
      employees_detected: employees.length,
      records_detected: dailyRecords.length,
      total_raw_punches: stats.totalRawPunchesCount,
      total_distinct_punches: stats.totalDistinctPunchesCount,
      employee_days_with_attendance: stats.employeeDaysWithAttendance,
    },
  };
}

module.exports = {
  FORMAT_TEGAL_HORIZONTAL,
  normalizeTimeString,
  extractPunchTimes,
  extractPeriod,
  extractEmployees,
  extractDailyPunches,
  parse,
};
