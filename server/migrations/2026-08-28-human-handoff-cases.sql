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

-- Correction Round 1, Correction 3: `priority` is a TEXT enum, so ordering a
-- case queue by it directly is lexical ('high' < 'normal' < 'urgent') and
-- does not produce the required urgent-first business order. This generated
-- column stays in sync with `priority` automatically (no application code
-- can let it drift) and is what listWaitingCases() actually orders by.
ALTER TABLE human_handoff_cases
  ADD COLUMN IF NOT EXISTS priority_rank SMALLINT
    GENERATED ALWAYS AS (
      CASE priority
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 1
        ELSE 2
      END
    ) STORED;

-- At most one open case per customer phone at a time (duplicate-case protection
-- enforced at the database level, not just in application logic).
CREATE UNIQUE INDEX IF NOT EXISTS uq_human_handoff_cases_active_customer
  ON human_handoff_cases (customer_phone)
  WHERE status IN ('requested', 'waiting_human', 'human_active');

-- Serves listWaitingCases()'s status + priority_rank + created_at ordering,
-- with or without a branch filter applied on top (Correction Round 1,
-- Blocker 2 — branch-scoped queue for branch_admin / branch-assigned manager).
CREATE INDEX IF NOT EXISTS idx_human_handoff_cases_status_priority_created
  ON human_handoff_cases (status, priority_rank, created_at);

CREATE INDEX IF NOT EXISTS idx_human_handoff_cases_branch_status_priority_created
  ON human_handoff_cases (branch, status, priority_rank, created_at);

ALTER TABLE human_handoff_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE human_handoff_cases FROM anon, authenticated;

COMMIT;
