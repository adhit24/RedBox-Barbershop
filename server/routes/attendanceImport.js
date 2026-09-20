'use strict';

const express = require('express');
const { createBackofficeSupabaseAuth } = require('../middleware/backofficeSupabaseAuth');
const {
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
} = require('../services/fingerprintAttendanceImporter');
const { logSystemEvent } = require('../services/systemEventLog');

function createAttendanceImportRoutes(supabase, legacyAdminAuth) {
  const router = express.Router();
  const adminAuth = createBackofficeSupabaseAuth(supabase, legacyAdminAuth);

  // Helper to extract file buffer from request body
  function extractBuffer(req) {
    if (req.body?.file_base64) {
      const cleanBase64 = String(req.body.file_base64).replace(/^data:.*?;base64,/, '');
      return {
        buffer: Buffer.from(cleanBase64, 'base64'),
        filename: req.body.filename || 'attendance_import.xls',
      };
    }
    if (Buffer.isBuffer(req.body)) {
      return {
        buffer: req.body,
        filename: req.query.filename || 'attendance_import.xls',
      };
    }
    return null;
  }

  // 1. POST /import/preview — Stage B: Zero mutation preview
  router.post('/import/preview', adminAuth, async (req, res) => {
    try {
      const fileData = extractBuffer(req);
      if (!fileData || !fileData.buffer || fileData.buffer.length === 0) {
        return res.status(400).json({ error: 'File absensi (.xls / .xlsx) harus diunggah' });
      }

      const userRole = req.adminAuth?.role;
      const userBranch = req.adminAuth?.branch;
      const userEmail = req.adminAuth?.email || 'manager';

      const preview = await previewImport({
        buffer: fileData.buffer,
        filename: fileData.filename,
        uploadedBy: userEmail,
        supabase,
        machineSource: req.body?.machine_source || req.query?.machine_source || null,
      });

      // Role branch scoping check: if manager is bound to a specific branch,
      // warn if employees detected belong to other branches
      if (userRole === 'manager' && userBranch) {
        const outOfBranchMatches = preview.matched.filter(m => {
          if (m.target_type === 'employee' && m.branch && m.branch !== userBranch) return true;
          if (m.target_type === 'barber' && m.branch && m.branch !== userBranch) return true;
          return false;
        });
        if (outOfBranchMatches.length > 0) {
          preview.warnings.push({
            type: 'branch_scope_warning',
            message: `File ini terdeteksi memuat ${outOfBranchMatches.length} karyawan di luar cabang yang Anda kelola (${userBranch.toUpperCase()}).`,
          });
          preview.warnings_count = preview.warnings.length;
        }
      }

      return res.json({
        ok: true,
        data: preview,
      });
    } catch (err) {
      console.error('[AttendanceImport] Preview error:', err);
      const status = ['FILE_TOO_LARGE', 'INVALID_FILE_EXTENSION', 'INVALID_FILE_SIGNATURE', 'UNSUPPORTED_FINGERPRINT_FORMAT'].includes(err.code)
        ? 400
        : 500;
      return res.status(status).json({
        error: err.message || 'Gagal memproses file fingerprint',
        code: err.code || 'PREVIEW_FAILED',
      });
    }
  });

  // 2. POST /import/commit — Stage C: Write verified attendance to database
  router.post('/import/commit', adminAuth, async (req, res) => {
    try {
      const fileData = extractBuffer(req);
      if (!fileData || !fileData.buffer || fileData.buffer.length === 0) {
        return res.status(400).json({ error: 'File absensi (.xls / .xlsx) harus diunggah untuk commit' });
      }

      const userRole = req.adminAuth?.role;
      const userBranch = req.adminAuth?.branch;
      const userEmail = req.adminAuth?.email || 'manager';

      const manualMappings = Array.isArray(req.body.manual_mappings) ? req.body.manual_mappings : [];

      const result = await commitImport({
        buffer: fileData.buffer,
        filename: fileData.filename,
        uploadedBy: userEmail,
        userAuth: req.adminAuth,
        supabase,
        manualMappings,
        machineSource: req.body?.machine_source || req.query?.machine_source || null,
      });

      return res.json({
        ok: true,
        data: result,
      });
    } catch (err) {
      console.error('[AttendanceImport] Commit error:', err);
      return res.status(500).json({
        error: err.message || 'Gagal menyimpan data absensi ke database',
        code: err.code || 'COMMIT_FAILED',
      });
    }
  });

  // 3. GET /import/batches — Riwayat Impor
  router.get('/import/batches', adminAuth, async (req, res) => {
    try {
      const { data: batches, error } = await supabase
        .from('attendance_import_batches')
        .select('*')
        .order('uploaded_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return res.json({
        ok: true,
        batches: batches || [],
      });
    } catch (err) {
      console.error('[AttendanceImport] Batches error:', err);
      return res.status(500).json({ error: 'Gagal memuat riwayat impor absensi' });
    }
  });

  // Classification helper for business unit isolation
  function classifyExceptionBusinessUnit(exc) {
    const dept = String(exc.department || '').toLowerCase().trim();
    const name = String(exc.external_name || '').toLowerCase().trim();
    const extId = String(exc.external_employee_id || '').trim();

    // 1. Sundaze markers
    if (
      dept.includes('sundaze') ||
      dept.includes('barista') ||
      ['abi', 'dendi', 'karnadi'].some(x => name.includes(x)) ||
      extId === '2' || extId === '21'
    ) {
      return 'Sundaze';
    }

    // 2. Redbox markers
    if (
      dept.includes('barber') ||
      dept.includes('kasir') ||
      dept.includes('csb') ||
      dept.includes('sumber') ||
      dept.includes('tegal') ||
      dept.includes('samadikun') ||
      dept.includes('bypass') ||
      ['yuda', 'yudha', 'ragil', 'jumadi', 'sarif', 'aziz', 'dede kumaedi', 'reza budiman', 'rizki adi nugroho', 'muhammad indra hadikusuma'].some(x => name.includes(x)) ||
      extId === '3'
    ) {
      return 'Redbox';
    }

    // 3. Corporate / unclassified
    return 'Unclassified';
  }

  // 4. GET /exceptions — Exception Review list with Business Unit Isolation
  router.get('/exceptions', adminAuth, async (req, res) => {
    try {
      const status = req.query.status || 'pending';
      const batchId = req.query.batch_id;
      const requestedBU = String(req.query.business_unit || 'redbox').toLowerCase().trim();

      let query = supabase
        .from('attendance_exceptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (status !== 'all') {
        query = query.eq('status', status);
      }
      if (batchId) {
        query = query.eq('import_batch_id', batchId);
      }

      const { data: rawExceptions, error } = await query.limit(200);
      if (error) throw error;

      const classified = (rawExceptions || []).map(exc => ({
        ...exc,
        business_unit: classifyExceptionBusinessUnit(exc),
      }));

      const counts = {
        redbox: classified.filter(x => x.business_unit === 'Redbox').length,
        sundaze: classified.filter(x => x.business_unit === 'Sundaze').length,
        unclassified: classified.filter(x => x.business_unit === 'Unclassified').length,
        total: classified.length,
      };

      let filtered = classified;
      if (requestedBU === 'redbox') {
        filtered = classified.filter(x => x.business_unit === 'Redbox');
      } else if (requestedBU === 'sundaze') {
        filtered = classified.filter(x => x.business_unit === 'Sundaze');
      } else if (requestedBU === 'unclassified') {
        filtered = classified.filter(x => x.business_unit === 'Unclassified');
      }

      return res.json({
        ok: true,
        business_unit: requestedBU,
        counts,
        exceptions: filtered,
      });
    } catch (err) {
      console.error('[AttendanceImport] Exceptions error:', err);
      return res.status(500).json({ error: 'Gagal memuat data attendance exception' });
    }
  });

  // Helper to link attendance record atomically
  async function linkAttendanceRecord(exc, targetType, personId, dbClient) {
    if (!exc.raw_data || !exc.attendance_date) return;
    const derivedStatus = deriveAttendanceStatus(exc.raw_data);

    if (targetType === 'employee') {
      await dbClient
        .from('employee_attendance')
        .upsert({
          employee_id: personId,
          attendance_date: exc.attendance_date,
          first_check_in: exc.raw_data.first_check_in || null,
          last_check_out: exc.raw_data.last_check_out || null,
          status: derivedStatus,
          late_minutes: exc.raw_data.late_minutes || 0,
          early_leave_minutes: exc.raw_data.early_leave_minutes || 0,
          overtime_minutes: 0,
          raw_punches: exc.raw_data.raw_punches || [],
          source: 'fingerprint',
          import_batch_id: exc.import_batch_id || null,
          notes: exc.raw_data.notes || `Resolved from exception ${exc.id}`,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'employee_id,attendance_date' });
    } else if (targetType === 'barber') {
      const { data: existing } = await dbClient
        .from('barber_attendance')
        .select('id')
        .eq('barber_id', personId)
        .eq('date', exc.attendance_date)
        .maybeSingle();

      if (!existing) {
        await dbClient.from('barber_attendance').insert({
          barber_id: personId,
          date: exc.attendance_date,
          status: derivedStatus === 'terlambat' ? 'terlambat' : 'hadir',
          note: `Fingerprint ${exc.raw_data.first_check_in || ''}-${exc.raw_data.last_check_out || ''}`.trim(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  // 5. POST /exceptions/:id/resolve — Resolve single exception & create identity mapping
  router.post('/exceptions/:id/resolve', adminAuth, async (req, res) => {
    try {
      // 1. Session verification check
      if (!req.adminAuth?.sessionVerified) {
        return res.status(401).json({ error: 'Sesi backoffice belum terverifikasi' });
      }

      // 2. Role authorization check (Owner & Manager only)
      const userRole = req.adminAuth?.role;
      if (userRole !== 'owner' && userRole !== 'manager') {
        return res.status(403).json({ error: 'Akses ditolak: Hanya Owner dan Manager yang berwenang menyelesaikan exception' });
      }

      const userBranch = req.adminAuth?.branch;
      const userEmail = req.adminAuth?.email || 'manager';
      const exceptionId = req.params.id;
      const { employee_id, barber_id, target_type, resolution_notes } = req.body || {};

      // 3. Validate exception exists
      const { data: exc, error: excErr } = await supabase
        .from('attendance_exceptions')
        .select('*')
        .eq('id', exceptionId)
        .maybeSingle();

      if (excErr || !exc) {
        return res.status(404).json({ error: 'Record exception tidak ditemukan' });
      }

      // 4. Idempotency: return success if already resolved
      if (exc.status === 'resolved') {
        return res.json({
          ok: true,
          message: 'Exception presensi ini sudah diselesaikan sebelumnya (idempotent).',
          exception: exc,
        });
      }

      const isIdentityException = exc.exception_type === 'unmatched_employee';
      let finalTargetType = null;
      let finalPersonId = null;
      let targetPerson = null;

      if (isIdentityException) {
        // Enforce either employee_id OR barber_id (mutual exclusion)
        if (!employee_id && !barber_id) {
          return res.status(400).json({ error: 'Target person (karyawan atau barber) wajib ditentukan untuk exception identitas' });
        }
        if (employee_id && barber_id) {
          return res.status(400).json({ error: 'Hanya boleh memilih salah satu antara employee_id atau barber_id' });
        }

        if (employee_id) {
          finalTargetType = 'employee';
          finalPersonId = employee_id;
          const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id, name, branch, is_active')
            .eq('id', employee_id)
            .maybeSingle();

          if (empErr || !emp) {
            return res.status(404).json({ error: 'Target karyawan tidak ditemukan di database' });
          }
          targetPerson = emp;
        } else {
          finalTargetType = 'barber';
          finalPersonId = barber_id;
          const { data: bar, error: barErr } = await supabase
            .from('barbers')
            .select('id, name, branch, is_active')
            .eq('id', barber_id)
            .maybeSingle();

          if (barErr || !bar) {
            return res.status(404).json({ error: 'Target barber/kapster tidak ditemukan di database' });
          }
          targetPerson = bar;
        }

        // 5. Server-side branch scope enforcement: Manager cannot map outside their branch
        if (userRole === 'manager' && userBranch) {
          const normUserBranch = String(userBranch).trim().toLowerCase();
          const personBranch = String(targetPerson.branch || '').trim().toLowerCase();

          if (personBranch && personBranch !== normUserBranch) {
            return res.status(403).json({
              error: `Akses ditolak: Manager hanya berwenang untuk person di cabangnya (${userBranch.toUpperCase()}). Target person berada di cabang '${targetPerson.branch}'.`,
            });
          }
        }

        // 6. Write identity mapping atomically into employee_attendance_identity
        if (exc.external_employee_id) {
          const { error: idnErr } = await supabase
            .from('employee_attendance_identity')
            .upsert({
              source: 'fingerprint',
              external_employee_id: String(exc.external_employee_id).trim(),
              external_name: exc.external_name || null,
              target_type: finalTargetType,
              employee_id: finalTargetType === 'employee' ? finalPersonId : null,
              barber_id: finalTargetType === 'barber' ? finalPersonId : null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'source,external_employee_id' });

          if (idnErr) {
            console.error('[AttendanceImport] Failed to upsert employee_attendance_identity:', idnErr);
            throw idnErr;
          }
        }

        // 7. Reprocess & link attendance record for current exception
        await linkAttendanceRecord(exc, finalTargetType, finalPersonId, supabase);

        // 8. Propagate resolution to sibling pending exceptions with the same canonical identity (source + external_employee_id)
        const excExtId = String(exc.external_employee_id || '').trim();
        const excSource = String(exc.raw_data?.source || 'fingerprint').trim();

        if (excExtId) {
          const { data: rawSiblings } = await supabase
            .from('attendance_exceptions')
            .select('*')
            .eq('external_employee_id', excExtId)
            .eq('status', 'pending')
            .neq('id', exceptionId);

          // Verify both external_employee_id AND source match exactly
          const validSiblings = (rawSiblings || []).filter(sib => {
            const sibExtId = String(sib.external_employee_id || '').trim();
            const sibSource = String(sib.raw_data?.source || 'fingerprint').trim();
            return sibExtId === excExtId && sibSource === excSource;
          });

          if (validSiblings.length > 0) {
            for (const sib of validSiblings) {
              await linkAttendanceRecord(sib, finalTargetType, finalPersonId, supabase);
            }
            const sibIds = validSiblings.map(s => s.id);
            await supabase
              .from('attendance_exceptions')
              .update({
                status: 'resolved',
                resolution_notes: `Auto-resolved via identity mapping confirmed for ID ${excExtId} (${resolution_notes || 'Resolved by manager'})`.trim(),
                resolved_by: userEmail,
                resolved_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .in('id', sibIds);
          }
        }
      }

      // 9. Update the primary exception state
      const { data: updated, error: updateErr } = await supabase
        .from('attendance_exceptions')
        .update({
          status: 'resolved',
          resolution_notes: resolution_notes || (isIdentityException ? `Dipetakan ke ${finalTargetType} ${targetPerson?.name || finalPersonId}` : 'Resolved by manager'),
          resolved_by: userEmail,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', exceptionId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // 10. Audit trail via logSystemEvent
      await logSystemEvent({
        module: 'attendance',
        eventName: 'attendance_exception_resolved',
        severity: 'INFO',
        status: 'success',
        message: `Attendance exception ${exc.id} resolved (${exc.exception_type})`,
        entityType: 'attendance_exception',
        entityId: exc.id,
        barberId: finalTargetType === 'barber' ? finalPersonId : null,
        outletId: targetPerson?.branch || null,
        metadata: {
          exception_id: exc.id,
          exception_type: exc.exception_type,
          external_employee_id: exc.external_employee_id,
          external_name: exc.external_name,
          mapped_person_type: finalTargetType,
          mapped_person_id: finalPersonId,
          target_person_name: targetPerson?.name || null,
          target_branch: targetPerson?.branch || null,
          resolved_by: userEmail,
          resolved_at: new Date().toISOString(),
        },
      }, { supabase });

      return res.json({
        ok: true,
        message: isIdentityException
          ? `Exception berhasil diselesaikan dan identity mapping (ID ${exc.external_employee_id} -> ${targetPerson?.name}) disimpan permanen.`
          : 'Exception berhasil diselesaikan.',
        exception: updated,
      });
    } catch (err) {
      console.error('[AttendanceImport] Resolve exception error:', err);
      return res.status(500).json({ error: 'Gagal menyelesaikan exception presensi' });
    }
  });

  // 6. GET /employees — Regular Redbox employee attendance for branch / date
  router.get('/employees', adminAuth, async (req, res) => {
    try {
      const userRole = req.adminAuth?.role;
      const userBranch = req.adminAuth?.branch;
      const date = String(req.query.date || '').trim() || new Date().toISOString().slice(0, 10);
      let requestedBranch = String(req.query.branch || '').trim().toLowerCase();

      // Server-side branch scope enforcement: Manager is restricted to their branch only!
      let effectiveBranch = requestedBranch;
      if (userRole === 'manager') {
        effectiveBranch = userBranch ? String(userBranch).trim().toLowerCase() : 'none';
      }

      let empQuery = supabase
        .from('employees')
        .select('id, name, nickname, position, branch, branch_name, business_unit, is_active')
        .eq('is_active', true)
        .eq('employment_type', 'regular')
        .eq('business_unit', 'Redbox');

      if (effectiveBranch && effectiveBranch !== 'all') {
        empQuery = empQuery.eq('branch', effectiveBranch);
      }

      const { data: employees, error: empErr } = await empQuery.order('name');
      if (empErr) throw empErr;

      const employeeIds = (employees || []).map(e => e.id);
      let attendanceMap = {};

      if (employeeIds.length > 0) {
        const { data: attList, error: attErr } = await supabase
          .from('employee_attendance')
          .select('*')
          .in('employee_id', employeeIds)
          .eq('attendance_date', date);

        if (!attErr && attList) {
          for (const a of attList) {
            attendanceMap[a.employee_id] = a;
          }
        }
      }

      const results = (employees || []).map(emp => {
        const att = attendanceMap[emp.id] || null;
        return {
          employee_id: emp.id,
          name: emp.name,
          nickname: emp.nickname,
          position: emp.position,
          branch: emp.branch,
          business_unit: emp.business_unit,
          attendance_date: date,
          status: att ? att.status : 'belum_check_in',
          first_check_in: att?.first_check_in || null,
          last_check_out: att?.last_check_out || null,
          late_minutes: att?.late_minutes || 0,
          raw_punches: att?.raw_punches || [],
        };
      });

      const stats = {
        total: results.length,
        hadir: results.filter(r => ['hadir', 'terlambat'].includes(r.status)).length,
        terlambat: results.filter(r => r.status === 'terlambat').length,
        belum_check_in: results.filter(r => r.status === 'belum_check_in').length,
        tidak_hadir: results.filter(r => ['absent', 'izin', 'sakit', 'cuti'].includes(r.status)).length,
      };

      return res.json({
        ok: true,
        date,
        branch: effectiveBranch || 'all',
        stats,
        employees: results,
      });
    } catch (err) {
      console.error('[AttendanceImport] Employee attendance query error:', err);
      return res.status(500).json({ error: 'Gagal memuat presensi karyawan reguler' });
    }
  });

  // 7. GET /overview — Canonical Attendance Overview (Redbox employees + barbers)
  router.get('/overview', adminAuth, async (req, res) => {
    try {
      const userRole = req.adminAuth?.role;
      const userBranch = req.adminAuth?.branch;
      const date = String(req.query.date || '').trim() || new Date().toISOString().slice(0, 10);
      let requestedBranch = String(req.query.branch || 'all').trim().toLowerCase();

      // Server-side branch scope enforcement: Manager is restricted to their branch only!
      let effectiveBranch = requestedBranch;
      if (userRole === 'manager') {
        effectiveBranch = userBranch ? String(userBranch).trim().toLowerCase() : 'none';
      }

      const personTypeFilter = String(req.query.person_type || 'all').trim().toLowerCase();
      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();

      // 1. Fetch Redbox regular employees
      let empQuery = supabase
        .from('employees')
        .select('id, name, nickname, position, branch, branch_name, business_unit, is_active')
        .eq('is_active', true)
        .eq('employment_type', 'regular')
        .eq('business_unit', 'Redbox');

      if (effectiveBranch && effectiveBranch !== 'all') {
        empQuery = empQuery.eq('branch', effectiveBranch);
      }
      const { data: dbEmployees, error: empErr } = await empQuery.order('name');
      if (empErr) throw empErr;

      // 2. Fetch Redbox active barbers
      let barQuery = supabase
        .from('barbers')
        .select('id, name, branch, is_active')
        .eq('is_active', true);

      if (effectiveBranch && effectiveBranch !== 'all') {
        barQuery = barQuery.eq('branch', effectiveBranch);
      }
      const { data: dbBarbers, error: barErr } = await barQuery.order('name');
      if (barErr) throw barErr;

      // 3. Fetch employee_attendance for requested date
      const employeeIds = (dbEmployees || []).map(e => e.id);
      let empAttMap = new Map();
      if (employeeIds.length > 0) {
        const { data: empAttList, error: empAttErr } = await supabase
          .from('employee_attendance')
          .select('*')
          .in('employee_id', employeeIds)
          .eq('attendance_date', date);
        if (!empAttErr && empAttList) {
          for (const a of empAttList) {
            empAttMap.set(a.employee_id, a);
          }
        }
      }

      // 4. Fetch barber_attendance for requested date
      const barberIds = (dbBarbers || []).map(b => b.id);
      let barberAttMap = new Map();
      if (barberIds.length > 0) {
        const { data: bAttList, error: bAttErr } = await supabase
          .from('barber_attendance')
          .select('*')
          .in('barber_id', barberIds)
          .eq('date', date);
        if (!bAttErr && bAttList) {
          for (const b of bAttList) {
            barberAttMap.set(b.barber_id, b);
          }
        }
      }

      // 5. Fetch exceptions on this date
      const { data: dayExceptions } = await supabase
        .from('attendance_exceptions')
        .select('*')
        .eq('attendance_date', date);

      const records = [];

      function calcHours(inTime, outTime) {
        if (!inTime || !outTime) return null;
        const [inH, inM] = inTime.split(':').map(Number);
        const [outH, outM] = outTime.split(':').map(Number);
        if (Number.isNaN(inH) || Number.isNaN(outH)) return null;
        let diffMin = (outH * 60 + outM) - (inH * 60 + inM);
        if (diffMin < 0) diffMin += 24 * 60;
        const hours = (diffMin / 60).toFixed(1);
        return `${hours} jam`;
      }

      // Process Redbox regular employees
      if (personTypeFilter === 'all' || personTypeFilter === 'employee') {
        for (const emp of dbEmployees || []) {
          const att = empAttMap.get(emp.id) || null;
          const status = att ? att.status : 'belum_check_in';
          const punches = att?.raw_punches || [];

          records.push({
            id: `emp-${emp.id}`,
            person_type: 'employee',
            person_id: emp.id,
            name: emp.name,
            nickname: emp.nickname || null,
            position: emp.position || 'Staff',
            branch: emp.branch || 'Pusat',
            business_unit: 'Redbox',
            date,
            status,
            first_check_in: att?.first_check_in || null,
            last_check_out: att?.last_check_out || null,
            total_hours: calcHours(att?.first_check_in, att?.last_check_out),
            late_minutes: att?.late_minutes || 0,
            overtime_minutes: att?.overtime_minutes || 0,
            raw_punches: punches,
            has_single_punch: punches.length === 1 || (att?.first_check_in && !att?.last_check_out),
            notes: att?.notes || null,
          });
        }
      }

      // Process Redbox barbers
      if (personTypeFilter === 'all' || personTypeFilter === 'barber') {
        for (const barb of dbBarbers || []) {
          const bAtt = barberAttMap.get(barb.id) || null;
          let inTime = null;
          let outTime = null;
          if (bAtt?.note) {
            const m = bAtt.note.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            if (m) {
              inTime = m[1];
              outTime = m[2];
            }
          }
          const status = bAtt ? bAtt.status : 'belum_check_in';

          records.push({
            id: `barber-${barb.id}`,
            person_type: 'barber',
            person_id: barb.id,
            name: barb.name,
            nickname: null,
            position: 'Kapster',
            branch: barb.branch || 'Pusat',
            business_unit: 'Redbox',
            date,
            status,
            first_check_in: inTime,
            last_check_out: outTime,
            total_hours: calcHours(inTime, outTime),
            late_minutes: status === 'terlambat' ? 15 : 0,
            overtime_minutes: 0,
            raw_punches: inTime ? [inTime, ...(outTime ? [outTime] : [])] : [],
            has_single_punch: (inTime && !outTime) || (!inTime && outTime),
            notes: bAtt?.note || null,
          });
        }
      }

      records.sort((a, b) => {
        if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
        if (a.person_type !== b.person_type) return a.person_type.localeCompare(b.person_type);
        return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
      });

      let filteredRecords = records;
      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'hadir') {
          filteredRecords = records.filter(r => ['hadir', 'terlambat'].includes(r.status));
        } else if (statusFilter === 'terlambat') {
          filteredRecords = records.filter(r => r.status === 'terlambat');
        } else if (statusFilter === 'tidak_hadir') {
          filteredRecords = records.filter(r => ['absent', 'izin', 'sakit', 'cuti', 'off'].includes(r.status));
        } else if (statusFilter === 'belum_check_in') {
          filteredRecords = records.filter(r => r.status === 'belum_check_in');
        } else if (statusFilter === 'missing_punch') {
          filteredRecords = records.filter(r => r.has_single_punch);
        } else {
          filteredRecords = records.filter(r => r.status === statusFilter);
        }
      }

      const stats = {
        total_workforce: records.length,
        hadir: records.filter(r => ['hadir', 'terlambat'].includes(r.status)).length,
        terlambat: records.filter(r => r.status === 'terlambat').length,
        belum_check_in: records.filter(r => r.status === 'belum_check_in').length,
        tidak_hadir: records.filter(r => ['absent', 'izin', 'sakit', 'cuti', 'off'].includes(r.status)).length,
        missing_clock_in: records.filter(r => !r.first_check_in && r.last_check_out).length,
        missing_clock_out: records.filter(r => (r.first_check_in && !r.last_check_out) || r.has_single_punch).length,
        exceptions_count: (dayExceptions || []).filter(x => {
          if (effectiveBranch && effectiveBranch !== 'all') {
            return String(x.department || '').toLowerCase() === effectiveBranch;
          }
          return true;
        }).length,
      };

      return res.json({
        ok: true,
        date,
        branch: effectiveBranch || 'all',
        filter: {
          person_type: personTypeFilter,
          status: statusFilter,
        },
        stats,
        records: filteredRecords,
      });
    } catch (err) {
      console.error('[AttendanceImport] Attendance overview error:', err);
      return res.status(500).json({ error: 'Gagal memuat ringkasan presensi harian' });
    }
  });

  return router;
}

module.exports = {
  createAttendanceImportRoutes,
};
