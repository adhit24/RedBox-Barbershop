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
-- wa_conversations base table creation (if not present)
CREATE TABLE IF NOT EXISTS public.wa_conversations (
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
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS provider_device_hash TEXT;
UPDATE public.wa_conversations SET provider_device_hash = 'legacy-unscoped' WHERE provider_device_hash IS NULL;
ALTER TABLE public.wa_conversations ALTER COLUMN provider_device_hash SET NOT NULL;

-- Bounded channel routing metadata (Blocker 1 fix): nullable TEXT, allowed
-- values only: bypass, samadikun, csb, sumber, tegal. Legacy rows remain NULL.
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS branch TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wa_conversations'::regclass
      AND conname = 'chk_wa_conversations_branch'
  ) THEN
    ALTER TABLE public.wa_conversations
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

-- Surrogate primary key (id UUID PRIMARY KEY):
-- Production currently has wa_conversations_pkey PRIMARY KEY (sender).
-- Checking constraint name alone (e.g. IF NOT EXISTS 'wa_conversations_pkey')
-- fails because production already has that constraint name on column 'sender'.
-- We inspect the actual PK column(s) via pg_attribute/pg_constraint. If a PK
-- constraint exists and is NOT on column 'id', we dynamically drop it regardless
-- of its constraint name, then add id UUID NOT NULL DEFAULT gen_random_uuid()
-- and PRIMARY KEY (id).
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
DECLARE
  v_pk_name TEXT;
  v_pk_is_id BOOLEAN := FALSE;
BEGIN
  -- Inspect existing primary key constraint on public.wa_conversations
  SELECT c.conname,
         (COUNT(*) = 1 AND MAX(a.attname) = 'id') INTO v_pk_name, v_pk_is_id
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.wa_conversations'::regclass AND c.contype = 'p'
  GROUP BY c.conname;

  -- If a PK constraint exists but it is NOT on column 'id' (e.g. legacy PK on sender), drop it
  IF v_pk_name IS NOT NULL AND NOT v_pk_is_id THEN
    EXECUTE 'ALTER TABLE public.wa_conversations DROP CONSTRAINT ' || quote_ident(v_pk_name);
    v_pk_is_id := FALSE;
  END IF;

  -- Add PRIMARY KEY (id) if not already present
  IF NOT v_pk_is_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.wa_conversations'::regclass
        AND conname = 'wa_conversations_pkey'
    ) THEN
      ALTER TABLE public.wa_conversations ADD CONSTRAINT wa_conversations_pkey PRIMARY KEY (id);
    END IF;
  END IF;
END $$;

-- Composite uniqueness: UNIQUE (sender, provider_device_hash).
-- Table-scoped constraint check prevents false positives from other tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wa_conversations'::regclass
      AND conname = 'uq_wa_conversations_sender_device'
  ) THEN
    ALTER TABLE public.wa_conversations
      ADD CONSTRAINT uq_wa_conversations_sender_device UNIQUE (sender, provider_device_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_sender ON public.wa_conversations (sender);

ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wa_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wa_conversations TO service_role;

COMMIT;
