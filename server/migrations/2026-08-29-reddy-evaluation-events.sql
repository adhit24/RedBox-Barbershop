-- Task 16: append-only, privacy-minimized Reddy/Orchestrator evaluation events.
-- This is monitoring only. It is not an authority for booking, CRM, handoff,
-- inbound idempotency, outbound sending, or the REDDY_ENABLED kill switch.

BEGIN;

CREATE TABLE IF NOT EXISTS reddy_evaluation_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type           TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 96),
  severity             TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  branch               TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (branch IN ('bypass', 'csb', 'sumber', 'samadikun', 'tegal', 'unknown')),
  provider             TEXT NOT NULL DEFAULT 'unknown' CHECK (char_length(provider) <= 32),
  intent               TEXT CHECK (intent IS NULL OR char_length(intent) <= 64),
  route                TEXT CHECK (route IS NULL OR char_length(route) <= 64),
  issue_code           TEXT NOT NULL CHECK (char_length(issue_code) BETWEEN 1 AND 64),
  source_layer         TEXT NOT NULL CHECK (char_length(source_layer) BETWEEN 1 AND 64),
  message_id           TEXT CHECK (message_id IS NULL OR message_id ~ '^[a-f0-9]{64}$'),
  conversation_id      TEXT CHECK (conversation_id IS NULL OR conversation_id ~ '^[a-f0-9]{64}$'),
  handoff_case_id      TEXT CHECK (handoff_case_id IS NULL OR char_length(handoff_case_id) <= 64),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddy_evaluation_created_at
  ON reddy_evaluation_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddy_evaluation_branch_created
  ON reddy_evaluation_events (branch, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddy_evaluation_severity_created
  ON reddy_evaluation_events (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reddy_evaluation_issue_created
  ON reddy_evaluation_events (issue_code, created_at DESC);

ALTER TABLE reddy_evaluation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE reddy_evaluation_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE reddy_evaluation_events TO service_role;

COMMIT;
