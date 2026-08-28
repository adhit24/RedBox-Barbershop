-- server/migrations/2026-08-28-human-handoff-cases.sql
-- Task 15 — Human Handoff foundation. One row per escalation from Reddy to a
-- human RedBox staff member. Stores references (customer_id, booking_reference)
-- rather than duplicating CRM/booking facts. Full conversation transcript
-- continues to live in wa_conversations; this table tracks handoff STATE only.
-- Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS human_handoff_cases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID,
  customer_phone           TEXT NOT NULL,
  channel                  TEXT NOT NULL DEFAULT 'whatsapp',
  branch                   TEXT,
  reason                   TEXT,
  trigger_type             TEXT NOT NULL CHECK (trigger_type IN ('explicit_customer_request', 'policy_escalation')),
  intent                   TEXT,
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  conversation_summary     TEXT,
  latest_customer_message  TEXT,
  booking_reference        TEXT,
  status                   TEXT NOT NULL DEFAULT 'waiting_human'
                              CHECK (status IN ('requested', 'waiting_human', 'human_active', 'resolved', 'cancelled')),
  assigned_to              TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ
);

-- At most one open case per customer phone at a time (duplicate-case protection
-- enforced at the database level, not just in application logic).
CREATE UNIQUE INDEX IF NOT EXISTS uq_human_handoff_cases_active_customer
  ON human_handoff_cases (customer_phone)
  WHERE status IN ('requested', 'waiting_human', 'human_active');

CREATE INDEX IF NOT EXISTS idx_human_handoff_cases_status_created
  ON human_handoff_cases (status, created_at DESC);

ALTER TABLE human_handoff_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE human_handoff_cases FROM anon, authenticated;

COMMIT;
