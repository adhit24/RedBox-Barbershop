-- P0 live incident: inbound processing terminalization (Objective B - atomic
-- stale-claim reclamation) + conversation isolation (Objective C).
--
-- NOT APPLIED TO PRODUCTION BY THIS CHANGE - for Aira review only.
-- Task45 idle lifecycle columns (conversation_status, idle_close_due_at, etc.)
-- already exist in production from previous deployments. This migration adds
-- conversation device scope (provider_device_hash), branch routing metadata
-- (branch), and the reclaim_stale_wa_inbound_event RPC.
BEGIN;

-- ============================================================================
-- Objective B: atomic stale-claim reclamation
-- ============================================================================
-- A redelivered provider event (same provider + provider_device_hash +
-- provider_message_id) whose original claim crashed/stalled after claiming
-- (row stuck at processing_status='processing', outbound_attempted=FALSE,
-- past a bounded staleness threshold) may atomically reclaim that SAME row
-- instead of permanently bouncing off the unique-index hit as 'duplicate'
-- forever. A single conditional UPDATE...RETURNING - no SELECT-then-UPDATE
-- race: Postgres row-level locking guarantees only one concurrent caller can
-- ever win (the loser's WHERE clause re-evaluates against the winner's
-- already-committed, now-fresh updated_at and correctly matches zero rows).
-- Never reclaims 'sending'/'sent'/'failed', never a row with
-- outbound_attempted=TRUE, and never touches outbound_attempted itself - the
-- normal single-send guarantee (reserve_wa_automated_send's own conditional
-- UPDATE) still applies exactly once when the reclaimed event proceeds
-- through the normal pipeline. provider_message_id uniqueness / the P0
-- identity scope are entirely unchanged by this function.
CREATE OR REPLACE FUNCTION reclaim_stale_wa_inbound_event(
  p_provider TEXT,
  p_provider_device_hash TEXT,
  p_provider_message_id TEXT,
  p_stale_seconds INTEGER DEFAULT 180
)
RETURNS TABLE(reclaimed BOOLEAN, inbound_event_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF COALESCE(p_provider, '') = '' OR COALESCE(p_provider_device_hash, '') = ''
     OR COALESCE(p_provider_message_id, '') = '' OR p_stale_seconds < 60 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID;
    RETURN;
  END IF;

  UPDATE wa_inbound_events
  SET processing_status = 'processing', updated_at = clock_timestamp()
  WHERE provider = p_provider
    AND provider_device_hash = p_provider_device_hash
    AND provider_message_id = p_provider_message_id
    AND processing_status = 'processing'
    AND outbound_attempted = FALSE
    AND updated_at < clock_timestamp() - make_interval(secs => p_stale_seconds)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID;
  ELSE
    RETURN QUERY SELECT TRUE, v_id;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID;
END;
$$;

REVOKE ALL ON FUNCTION reclaim_stale_wa_inbound_event(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reclaim_stale_wa_inbound_event(TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ============================================================================
-- Objective C: conversation isolation
-- ============================================================================
-- wa_conversations was created ad hoc via manually-run DDL (see the DDL
-- comment at api/wa/webhook.js, right above conversationCache) - no tracked
-- CREATE TABLE migration exists. Recreated here, idempotently, as the
-- self-sufficient base this migration builds on regardless of whether that
-- manual DDL has actually run in production.
CREATE TABLE IF NOT EXISTS wa_conversations (
  sender     TEXT NOT NULL,
  history    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- New isolation authority: sender + trusted provider device, NOT sender
-- alone. provider_device_hash is the exact same one-way SHA-256 hash
-- wa_inbound_events already uses (see server/services/waInboundGuard.js) -
-- device identity is preferred over a branch label as the scope boundary
-- because branch labels can be reassigned to a different device while the
-- provider device identity is the actual authenticated transport channel.
-- Never the raw device string - only ever this existing hash, or the
-- 'legacy-unscoped' sentinel for rows written before this column existed.
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS provider_device_hash TEXT;
UPDATE wa_conversations SET provider_device_hash = 'legacy-unscoped' WHERE provider_device_hash IS NULL;
ALTER TABLE wa_conversations ALTER COLUMN provider_device_hash SET NOT NULL;

-- Bounded channel routing metadata (Blocker 1 fix): nullable TEXT, allowed
-- values only: bypass, samadikun, csb, sumber, tegal. Legacy rows remain NULL.
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS branch TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wa_conversations_branch'
  ) THEN
    ALTER TABLE wa_conversations
      ADD CONSTRAINT chk_wa_conversations_branch
      CHECK (branch IS NULL OR branch IN ('bypass', 'samadikun', 'csb', 'sumber', 'tegal'));
  END IF;
END $$;

-- LEGACY MIXED HISTORY: deliberately NOT copied into every new scope (that
-- would just reproduce the exact cross-branch contamination this migration
-- fixes). A pre-existing sender-only row keeps its original history, backfilled
-- to the 'legacy-unscoped' sentinel scope. A REAL provider_device_hash is
-- always a 64-char SHA-256 hex digest and can therefore never equal that
-- sentinel - so any new, correctly-scoped lookup (which always passes a real
-- hash once a device has been seen at least once) can never match a legacy
-- row by construction. No destructive delete: the legacy row simply becomes
-- unreachable by new scoped queries, and remains available for audit/manual
-- reference if ever needed. If a genuinely-unscoped caller (there should be
-- none in the fixed code, but as a defensive fallback) still queries the bare
-- 'legacy-unscoped' scope, it reads the OLD mixed history verbatim - this is
-- accepted as the deliberate fallback behavior, not a new contamination
-- vector, since it only ever equals what the row already contained before
-- this migration.

-- Composite identity: surrogate PK (a plain TEXT PK cannot become composite
-- without recreating every reference to it) + the actual uniqueness/lookup
-- constraint on (sender, provider_device_hash). No FK anywhere in the
-- codebase references wa_conversations(sender) (verified), so dropping the
-- old sender-only PK is safe.
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wa_conversations_pkey'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'wa_conversations'::regclass AND contype = 'p'
    ) THEN
      EXECUTE (
        SELECT 'ALTER TABLE wa_conversations DROP CONSTRAINT ' || quote_ident(conname)
        FROM pg_constraint
        WHERE conrelid = 'wa_conversations'::regclass AND contype = 'p'
        LIMIT 1
      );
    END IF;
    ALTER TABLE wa_conversations ADD CONSTRAINT wa_conversations_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_wa_conversations_sender_device'
  ) THEN
    ALTER TABLE wa_conversations
      ADD CONSTRAINT uq_wa_conversations_sender_device UNIQUE (sender, provider_device_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_sender ON wa_conversations (sender);

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wa_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wa_conversations TO service_role;

COMMIT;
