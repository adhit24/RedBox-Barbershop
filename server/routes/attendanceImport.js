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

  // 4. GET /exceptions — Exception Review list
  router.get('/exceptions', adminAuth, async (req, res) => {
    try {
      const status = req.query.status || 'pending';
      const batchId = req.query.batch_id;

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

      const { data: exceptions, error } = await query.limit(100);
      if (error) throw error;

      return res.json({
        ok: true,
        exceptions: exceptions || [],
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

        // 8. Propagate resolution to sibling pending exceptions with the same external_employee_id
        if (exc.external_employee_id) {
          const { data: siblings } = await supabase
            .from('attendance_exceptions')
            .select('*')
            .eq('external_employee_id', exc.external_employee_id)
            .eq('status', 'pending')
            .neq('id', exceptionId);

          if (siblings && siblings.length > 0) {
            for (const sib of siblings) {
              await linkAttendanceRecord(sib, finalTargetType, finalPersonId, supabase);
            }
            await supabase
              .from('attendance_exceptions')
              .update({
                status: 'resolved',
                resolution_notes: `Auto-resolved via identity mapping confirmed for ID ${exc.external_employee_id} (${resolution_notes || 'Resolved by manager'})`.trim(),
                resolved_by: userEmail,
                resolved_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('external_employee_id', exc.external_employee_id)
              .eq('status', 'pending');
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

  // 6. GET /employees — Regular employee attendance for branch / date
  router.get('/employees', adminAuth, async (req, res) => {
    try {
      const date = String(req.query.date || '').trim() || new Date().toISOString().slice(0, 10);
      const branch = String(req.query.branch || '').trim().toLowerCase();

      let empQuery = supabase
        .from('employees')
        .select('id, name, nickname, position, branch, branch_name, business_unit, is_active')
        .eq('is_active', true)
        .eq('employment_type', 'regular');

      if (branch && branch !== 'all') {
        empQuery = empQuery.eq('branch', branch);
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
        branch: branch || 'all',
        stats,
        employees: results,
      });
    } catch (err) {
      console.error('[AttendanceImport] Employee attendance query error:', err);
      return res.status(500).json({ error: 'Gagal memuat presensi karyawan reguler' });
    }
  });

  return router;
}

module.exports = {
  createAttendanceImportRoutes,
};
