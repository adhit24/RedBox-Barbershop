-- Reddy conversation idle-timeout lifecycle (additive). NOT applied to
-- production by this change — for review only.
BEGIN;

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (conversation_status IN ('active', 'closing', 'closed')),
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_bot_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idle_close_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idle_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_idle_due
  ON wa_conversations (idle_close_due_at)
  WHERE conversation_status = 'active';

-- Allow a NULL inbound_event_id: a system-initiated send (the idle-close
-- message) has no triggering inbound customer message to attach to, but must
-- still flow through the same duplicate-content/rate-limit ledger as every
-- other automated send. Postgres UNIQUE allows multiple NULLs, so this does
-- not weaken the existing one-claim-per-inbound-event guarantee at all.
ALTER TABLE wa_outbound_send_claims ALTER COLUMN inbound_event_id DROP NOT NULL;

-- Backward-compatible extension of the existing P0 anti-spam RPC
-- (server/migrations/2026-08-29-wa-antispam-idempotency.sql): a NULL
-- p_inbound_event_id now takes a "system-initiated send" path that skips the
-- wa_inbound_events claim step (there is no such row) but still enforces the
-- same duplicate-content/rate-limit checks against wa_outbound_send_claims,
-- by destination_hash, that every customer-triggered automated send already
-- gets. Every existing NOT-NULL caller is unaffected byte-for-byte.
CREATE OR REPLACE FUNCTION reserve_wa_automated_send(
  p_inbound_event_id UUID,
  p_destination_hash TEXT,
  p_content_hash TEXT,
  p_duplicate_window_seconds INTEGER DEFAULT 90,
  p_rate_window_seconds INTEGER DEFAULT 60,
  p_rate_limit INTEGER DEFAULT 5
)
RETURNS TABLE(decision TEXT, claim_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_claim_id UUID;
  v_updated INTEGER;
BEGIN
  IF COALESCE(p_destination_hash, '') = ''
     OR COALESCE(p_content_hash, '') = '' OR p_duplicate_window_seconds < 1
     OR p_rate_window_seconds < 1 OR p_rate_limit < 1 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_destination_hash, 0));

  IF p_inbound_event_id IS NOT NULL THEN
    UPDATE wa_inbound_events
    SET outbound_attempted = TRUE, processing_status = 'sending', updated_at = v_now
    WHERE id = p_inbound_event_id AND outbound_attempted = FALSE;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RETURN QUERY SELECT 'already_attempted'::TEXT, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND content_hash = p_content_hash
      AND reserved_at >= v_now - make_interval(secs => p_duplicate_window_seconds)
  ) THEN
    IF p_inbound_event_id IS NOT NULL THEN
      UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
      WHERE id = p_inbound_event_id;
    END IF;
    RETURN QUERY SELECT 'duplicate_content'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*) FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND reserved_at >= v_now - make_interval(secs => p_rate_window_seconds)
  ) >= p_rate_limit THEN
    IF p_inbound_event_id IS NOT NULL THEN
      UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
      WHERE id = p_inbound_event_id;
    END IF;
    RETURN QUERY SELECT 'rate_limited'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO wa_outbound_send_claims (
    inbound_event_id, destination_hash, content_hash, reserved_at
  ) VALUES (
    p_inbound_event_id, p_destination_hash, p_content_hash, v_now
  ) RETURNING id INTO v_claim_id;

  RETURN QUERY SELECT 'allowed'::TEXT, v_claim_id;
EXCEPTION WHEN OTHERS THEN
  -- Any SQL error rolls back this function call, including outbound_attempted.
  RETURN QUERY SELECT 'error'::TEXT, NULL::UUID;
END;
$$;

-- ACL hardening (Final Mini Correction, Blocker 2): CREATE OR REPLACE
-- FUNCTION preserves the prior version's ACL when the signature matches
-- exactly (it does here — see Aira's live-production inspection: only
-- postgres/service_role currently have EXECUTE, anon/authenticated do not),
-- but this migration does not rely on that implicit preservation alone —
-- every grant is restated explicitly so the intended privilege set is
-- self-evident from this file without cross-referencing the original P0
-- migration.
REVOKE ALL ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

-- NULL-tolerant match: `inbound_event_id = NULL` is never true in SQL, so a
-- system-initiated claim's completion would otherwise match zero rows.
CREATE OR REPLACE FUNCTION complete_wa_automated_send(
  p_inbound_event_id UUID,
  p_claim_id UUID,
  p_sent BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE wa_outbound_send_claims
  SET reservation_state = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
      completed_at = clock_timestamp()
  WHERE id = p_claim_id AND inbound_event_id IS NOT DISTINCT FROM p_inbound_event_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN FALSE; END IF;

  IF p_inbound_event_id IS NOT NULL THEN
    UPDATE wa_inbound_events
    SET processing_status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
        outbound_sent = p_sent,
        updated_at = clock_timestamp()
    WHERE id = p_inbound_event_id;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) TO service_role;

COMMIT;
