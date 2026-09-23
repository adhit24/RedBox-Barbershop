'use strict';

const XLSX = require('xlsx');

const FORMAT_STANDARD_FLAT = 'standard_flat_report';

/**
 * Extracts report period (YYYY-MM-DD ~ YYYY-MM-DD) from Standard Flat Report.
 */
function extractPeriod(workbook) {
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
 * Extracts employee list from Standard Flat Report.
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
 * Maps day-of-month -> full date for the report period. Periods may span two
 * months (e.g. 2026-08-26 ~ 2026-09-20), so the month cannot be taken from
 * period.from alone. Days outside the period are absent from the map.
 */
function buildDayToDateMap(period) {
  const map = new Map();
  const start = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(`${period.to}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const day = parseInt(iso.slice(8, 10), 10);
    if (!map.has(day)) map.set(day, iso);
  }
  return map;
}

/**
 * Extracts daily records & punches from Standard Flat Report.
 */
function extractDailyPunches(workbook, period) {
  const dailyPunches = []; // { external_employee_id, date, raw_punches: [] }
  const timeRegex = /(\d{1,2}:\d{2})/g;

  if (workbook.Sheets['Lap. Log Absen']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Lap. Log Absen'], { header: 1 });
    let dayCols = [];
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const row = rows[r] || [];
      if (row.some(c => typeof c === 'number' && c >= 1 && c <= 31)) {
        dayCols = row;
        break;
      }
    }

    const dateByDay = buildDayToDateMap(period);

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
          const dateStr = dateByDay.get(dayNum);
          if (!dateStr) continue;

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
 * Standard Flat Parser adapter
 */
function parse(workbook) {
  const period = extractPeriod(workbook);
  const employees = extractEmployees(workbook);
  const dailyRecords = extractDailyPunches(workbook, period);

  return {
    format: FORMAT_STANDARD_FLAT,
    period,
    employees,
    dailyRecords,
    metadata: {
      format: FORMAT_STANDARD_FLAT,
      employees_detected: employees.length,
      records_detected: dailyRecords.length,
    },
  };
}

module.exports = {
  FORMAT_STANDARD_FLAT,
  extractPeriod,
  extractEmployees,
  extractDailyPunches,
  parse,
};
