-- server/migrations/2026-09-07-system-event-logs.sql
-- Additive only. Central, structured, searchable Redbox system event log.
-- Does NOT replace or duplicate sync_logs, reddy_evaluation_events, or
-- wa_inbound_events/wa_outbound_sends — those remain module-specific.

CREATE TABLE IF NOT EXISTS system_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  request_id TEXT,

  module TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_type TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  status TEXT CHECK (status IS NULL OR status IN ('started', 'success', 'failed', 'partial', 'skipped', 'retrying', 'blocked')),

  message TEXT,
  error_code TEXT,
  error_message TEXT,

  source TEXT,
  entity_type TEXT,
  entity_id TEXT,

  booking_id TEXT,
  schedule_id TEXT,
  customer_id TEXT,
  outlet_id TEXT,
  barber_id TEXT,
  external_id TEXT,

  http_method TEXT,
  http_path TEXT,
  http_status INTEGER,
  duration_ms INTEGER,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_created_at
  ON system_event_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_module_created_at
  ON system_event_logs (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_severity_created_at
  ON system_event_logs (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_event_name_created_at
  ON system_event_logs (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_correlation_id
  ON system_event_logs (correlation_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_booking_id
  ON system_event_logs (booking_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_customer_id
  ON system_event_logs (customer_id);

CREATE INDEX IF NOT EXISTS idx_system_event_logs_external_id
  ON system_event_logs (external_id);

ALTER TABLE system_event_logs ENABLE ROW LEVEL SECURITY;

-- Same access model as reddy_evaluation_events: service-role only. Backoffice
-- reads go through the server API (service-role client), never direct client
-- access to this table.
DROP POLICY IF EXISTS system_event_logs_service_role_all ON system_event_logs;
CREATE POLICY system_event_logs_service_role_all ON system_event_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
