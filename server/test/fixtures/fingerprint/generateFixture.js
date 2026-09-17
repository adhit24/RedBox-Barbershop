'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function buildSampleFingerprintWorkbook() {
  const wb = XLSX.utils.book_new();

  // 1. Stat. Absen sheet
  const statAbsenRows = [
    ['Laporan Statistik Absensi'],
    ['Periode: 2026-08-01 ~ 2026-08-24'],
    [],
    ['No. ID', 'Nama', 'Departemen', 'Jam Kerja Normal', 'Jam Kerja Nyata', 'Terlambat', 'Menit Lambat', 'Pulang Cepat', 'Menit Cepat', 'Lembur', 'Ijin', 'Sakit', 'Cuti', 'Alpa'],
  ];

  const employees = [
    { id: '1', name: 'Refal', dept: 'Perusahaan' },
    { id: '2', name: 'Abi', dept: 'Perusahaan' },
    { id: '3', name: 'Yuda', dept: 'Perusahaan' },
    { id: '7', name: 'Reza', dept: 'Perusahaan' },
    { id: '8', name: 'Sarif', dept: 'Perusahaan' },
    { id: '10', name: 'Husen', dept: 'Perusahaan' },
    { id: '11', name: 'Ragil', dept: 'Perusahaan' },
    { id: '12', name: 'Ega', dept: 'Perusahaan' },
    { id: '13', name: 'Ubay', dept: 'Perusahaan' },
    { id: '16', name: 'Dede', dept: 'Perusahaan' },
    { id: '17', name: 'Jumadi', dept: 'Perusahaan' },
    { id: '18', name: 'Nadi', dept: 'Perusahaan' },
    { id: '21', name: 'Dendi', dept: 'Perusahaan' },
    { id: '22', name: 'RizkiAdi', dept: 'Perusahaan' },
    { id: '24', name: 'Aziz', dept: 'Perusahaan' },
    { id: '69', name: 'Indra', dept: 'Perusahaan' },
  ];

  for (const emp of employees) {
    statAbsenRows.push([
      emp.id,
      emp.name,
      emp.dept,
      '180:00',
      '175:00',
      2,
      15,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ]);
  }

  const wsStatAbsen = XLSX.utils.aoa_to_sheet(statAbsenRows);
  XLSX.utils.book_append_sheet(wb, wsStatAbsen, 'Stat. Absen');

  // 2. Lap. Log Absen sheet
  const logAbsenRows = [
    ['Laporan Log Absensi'],
    ['Periode: 2026-08-01 ~ 2026-08-24'],
    [],
  ];

  // Header row with day numbers 1 to 24
  const dayHeaderRow = ['', '', ''];
  for (let d = 1; d <= 24; d++) {
    dayHeaderRow.push(d);
  }
  logAbsenRows.push(dayHeaderRow);

  for (const emp of employees) {
    // ID row: row[0]='ID:', row[2]=extId, row[10]=extName, row[20]=dept
    const idRow = new Array(25).fill('');
    idRow[0] = 'ID:';
    idRow[2] = emp.id;
    idRow[10] = emp.name;
    idRow[20] = emp.dept;
    logAbsenRows.push(idRow);

    // Punch row
    const punchRow = ['', '', ''];
    for (let d = 1; d <= 24; d++) {
      if (emp.id === '3' && d === 4) {
        punchRow.push('13:57 21:31');
      } else if (d % 7 !== 0) {
        punchRow.push('09:00 18:00');
      } else {
        punchRow.push('');
      }
    }
    logAbsenRows.push(punchRow);
  }

  const wsLogAbsen = XLSX.utils.aoa_to_sheet(logAbsenRows);
  XLSX.utils.book_append_sheet(wb, wsLogAbsen, 'Lap. Log Absen');

  // 3. Exception Stat. sheet
  const excRows = [
    ['Laporan Exception Statistik'],
    ['Periode: 2026-08-01 ~ 2026-08-24'],
    [],
    ['No ID', 'Nama', 'Departemen', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Standar Masuk', 'Standar Pulang', 'Terlambat', 'Cepat', 'Alpa', 'Total Jam', 'Keterangan'],
  ];

  for (const emp of employees) {
    for (let d = 1; d <= 24; d++) {
      const dayStr = String(d).padStart(2, '0');
      const dateStr = `2026-08-${dayStr}`;
      const isYudaSpecial = (emp.id === '3' && d === 4);
      const isWorkday = (d % 7 !== 0);

      if (isYudaSpecial) {
        excRows.push([
          emp.id,
          emp.name,
          emp.dept,
          dateStr,
          '13:57',
          '21:31',
          '09:00',
          '18:00',
          297,
          0,
          0,
          540,
          'Terlambat'
        ]);
      } else if (isWorkday) {
        excRows.push([
          emp.id,
          emp.name,
          emp.dept,
          dateStr,
          '09:00',
          '18:00',
          '09:00',
          '18:00',
          0,
          0,
          0,
          540,
          ''
        ]);
      }
    }
  }

  const wsExc = XLSX.utils.aoa_to_sheet(excRows);
  XLSX.utils.book_append_sheet(wb, wsExc, 'Exception Stat.');

  // 4. Jadwal Info sheet
  const wsJadwal = XLSX.utils.aoa_to_sheet([
    ['Jadwal Kerja Karyawan'],
    ['Shift Normal: 09:00 - 18:00'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsJadwal, 'Jadwal Info');

  return wb;
}

function writeFixtureFile(destPath) {
  const wb = buildSampleFingerprintWorkbook();
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buf = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
  fs.writeFileSync(destPath, buf);
  return buf;
}

module.exports = {
  buildSampleFingerprintWorkbook,
  writeFixtureFile,
};

if (require.main === module) {
  const target = path.join(__dirname, 'sample_standard_report.xls');
  writeFixtureFile(target);
  console.log('Successfully generated fixture:', target);
}
