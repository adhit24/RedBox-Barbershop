-- Migration: Fingerprint Attendance Import V1
-- Tables: employee_attendance_identity, attendance_import_batches, employee_attendance, attendance_exceptions

-- 1. Identity Mapping Table (Deterministic mapping from fingerprint machine ID to Employee / Barber)
CREATE TABLE IF NOT EXISTS public.employee_attendance_identity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'fingerprint',
  external_employee_id TEXT NOT NULL,
  external_name TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('employee', 'barber')),
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  barber_id TEXT REFERENCES public.barbers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_att_identity UNIQUE (source, external_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_att_identity_source_extid ON public.employee_attendance_identity(source, external_employee_id);

-- 2. Import Batches Table (Audit trail of every imported workbook)
CREATE TABLE IF NOT EXISTS public.attendance_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'importing', 'completed', 'partial', 'failed')),
  rows_detected INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_batches_hash ON public.attendance_import_batches(file_hash);
CREATE INDEX IF NOT EXISTS idx_att_batches_period ON public.attendance_import_batches(period_from, period_to);

-- 3. Regular Employee Attendance Table (Authoritative daily attendance for regular staff)
CREATE TABLE IF NOT EXISTS public.employee_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  first_check_in TEXT,
  last_check_out TEXT,
  status TEXT NOT NULL DEFAULT 'hadir'
    CHECK (status IN ('hadir', 'terlambat', 'izin', 'sakit', 'cuti', 'off', 'absent', 'incomplete')),
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  raw_punches JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'fingerprint',
  import_batch_id UUID REFERENCES public.attendance_import_batches(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_attendance_date UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_emp_att_date ON public.employee_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_emp_att_emp_date ON public.employee_attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_emp_att_batch ON public.employee_attendance(import_batch_id);

-- 4. Attendance Exceptions Table (Feeds backoffice Exception Review)
CREATE TABLE IF NOT EXISTS public.attendance_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID REFERENCES public.attendance_import_batches(id) ON DELETE CASCADE,
  attendance_date DATE,
  external_employee_id TEXT,
  external_name TEXT,
  department TEXT,
  exception_type TEXT NOT NULL
    CHECK (exception_type IN ('unmatched_employee', 'single_punch', 'invalid_date', 'invalid_time', 'duplicate_conflict', 'unresolved_shift')),
  details TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolution_notes TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_exceptions_batch ON public.attendance_exceptions(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_att_exceptions_status ON public.attendance_exceptions(status);

-- 5. Row Level Security & Access Policies
ALTER TABLE public.employee_attendance_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_exceptions ENABLE ROW LEVEL SECURITY;

-- Service Role Full Access
DROP POLICY IF EXISTS "service_role_all_att_identity" ON public.employee_attendance_identity;
CREATE POLICY "service_role_all_att_identity" ON public.employee_attendance_identity FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_att_batches" ON public.attendance_import_batches;
CREATE POLICY "service_role_all_att_batches" ON public.attendance_import_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_emp_att" ON public.employee_attendance;
CREATE POLICY "service_role_all_emp_att" ON public.employee_attendance FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_att_exceptions" ON public.attendance_exceptions;
CREATE POLICY "service_role_all_att_exceptions" ON public.attendance_exceptions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated Read Policies
DROP POLICY IF EXISTS "auth_read_att_identity" ON public.employee_attendance_identity;
CREATE POLICY "auth_read_att_identity" ON public.employee_attendance_identity FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_att_batches" ON public.attendance_import_batches;
CREATE POLICY "auth_read_att_batches" ON public.attendance_import_batches FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_emp_att" ON public.employee_attendance;
CREATE POLICY "auth_read_emp_att" ON public.employee_attendance FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_att_exceptions" ON public.attendance_exceptions;
CREATE POLICY "auth_read_att_exceptions" ON public.attendance_exceptions FOR SELECT TO authenticated USING (true);
