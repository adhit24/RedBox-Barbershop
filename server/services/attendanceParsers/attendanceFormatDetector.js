'use strict';

const XLSX = require('xlsx');

const FORMAT_STANDARD_FLAT = 'standard_flat_report';
const FORMAT_TEGAL_HORIZONTAL = 'tegal_horizontal_report';

/**
 * Detects the attendance report format from an XLSX workbook.
 *
 * @param {Object} workbook - Parsed XLSX workbook
 * @returns {{ format: string, confidence: number, details: Object }}
 */
function detectAttendanceFormat(workbook) {
  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    const err = new Error('Workbook tidak valid atau tidak memiliki lembar kerja (sheets).');
    err.code = 'INVALID_WORKBOOK';
    throw err;
  }

  const sheetNames = workbook.SheetNames;
  const sheetNamesLower = sheetNames.map(s => String(s).toLowerCase().trim());

  // 1. Check for Tegal Horizontal Format
  // Characteristics:
  // - Sheets include 'Logs' and 'Summary' (or variations like 'summary', 'list of logs')
  // - Or 'Logs' sheet contains 'Period :', 'No :', 'Name :' with horizontal day numbers in row above
  const hasSummarySheet = sheetNamesLower.includes('summary');
  const hasLogsSheet = sheetNamesLower.includes('logs');

  if (hasLogsSheet) {
    const logsSheet = workbook.Sheets[sheetNames[sheetNamesLower.indexOf('logs')]];
    if (logsSheet) {
      const sampleRows = XLSX.utils.sheet_to_json(logsSheet, { header: 1, defval: null }).slice(0, 15);
      const isTegalLogs = sampleRows.some(row => {
        if (!Array.isArray(row)) return false;
        const joined = row.map(c => String(c || '').toLowerCase()).join(' ');
        return joined.includes('no :') && joined.includes('name :');
      });

      if (isTegalLogs || hasSummarySheet) {
        return {
          format: FORMAT_TEGAL_HORIZONTAL,
          confidence: 1.0,
          details: {
            detectedBy: 'sheet_structure_tegal_logs',
            hasSummarySheet,
            hasLogsSheet,
          },
        };
      }
    }
  }

  // 2. Check for Standard Flat Report (Existing Redbox Format)
  // Characteristics:
  // - Known sheets: 'Stat. Absen', 'Lap. Log Absen', 'Exception Stat.', 'Jadwal Info'
  const standardKnownSheets = ['stat. absen', 'lap. log absen', 'exception stat.', 'jadwal info'];
  const matchedStandardSheets = standardKnownSheets.filter(s => sheetNamesLower.includes(s));

  if (matchedStandardSheets.length > 0) {
    return {
      format: FORMAT_STANDARD_FLAT,
      confidence: 1.0,
      details: {
        detectedBy: 'sheet_names_standard',
        matchedSheets: matchedStandardSheets,
      },
    };
  }

  // Fallback: Scan text content across all sheets for standard or tegal signatures
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
      return {
        format: FORMAT_STANDARD_FLAT,
        confidence: 0.9,
        details: {
          detectedBy: 'text_signature_standard',
          matchedSheet: name,
        },
      };
    }

    if (
      (text.includes('summary of attendance') || text.includes('list of logs')) &&
      text.includes('no :') &&
      text.includes('name :')
    ) {
      return {
        format: FORMAT_TEGAL_HORIZONTAL,
        confidence: 0.9,
        details: {
          detectedBy: 'text_signature_tegal',
          matchedSheet: name,
        },
      };
    }
  }

  const err = new Error(
    'Format mesin fingerprint ini belum didukung. File tidak diubah. Silakan kirim contoh file ini untuk ditambahkan ke parser.'
  );
  err.code = 'UNSUPPORTED_FINGERPRINT_FORMAT';
  throw err;
}

module.exports = {
  FORMAT_STANDARD_FLAT,
  FORMAT_TEGAL_HORIZONTAL,
  detectAttendanceFormat,
};
