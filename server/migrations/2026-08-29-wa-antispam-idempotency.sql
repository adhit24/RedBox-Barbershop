-- P0 Reddy anti-spam: durable inbound claims and atomic outbound reservations.
-- Safe to re-run. Only hashes/bounded metadata are stored: never raw phone or
-- message content. Execute as the database owner; runtime access is service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_inbound_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL DEFAULT 'fonnte',
  provider_device_hash  TEXT,
  provider_message_id   TEXT NOT NULL,
  sender_hash           TEXT,
  event_type            TEXT NOT NULL DEFAULT 'customer_message'
                          CHECK (event_type IN ('customer_message', 'status_callback', 'self_message', 'unsupported')),
  processing_status     TEXT NOT NULL DEFAULT 'received'
                          CHECK (processing_status IN ('received', 'processing', 'reply_ready', 'sending', 'sent', 'failed')),
  outbound_attempted    BOOLEAN NOT NULL DEFAULT FALSE,
  outbound_sent         BOOLEAN NOT NULL DEFAULT FALSE,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports a partially applied earlier PR revision without exposing raw IDs.
ALTER TABLE wa_inbound_events ADD COLUMN IF NOT EXISTS provider_device_hash TEXT;
UPDATE wa_inbound_events
SET provider_device_hash = 'legacy-unscoped'
WHERE provider_device_hash IS NULL;
ALTER TABLE wa_inbound_events ALTER COLUMN provider_device_hash SET NOT NULL;

-- Fonnte message IDs are not proven global across devices. Remove the older,
-- over-broad key so the same provider ID on two legitimate devices can claim.
DROP INDEX IF EXISTS uq_wa_inbound_events_provider_message;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_inbound_events_provider_device_message
  ON wa_inbound_events (provider, provider_device_hash, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_events_received_at
  ON wa_inbound_events (received_at DESC);

CREATE TABLE IF NOT EXISTS wa_outbound_send_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_event_id  UUID NOT NULL UNIQUE REFERENCES wa_inbound_events(id) ON DELETE CASCADE,
  destination_hash  TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  reservation_state TEXT NOT NULL DEFAULT 'reserved'
                      CHECK (reservation_state IN ('reserved', 'sent', 'failed')),
  reserved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wa_outbound_claims_dest_time
  ON wa_outbound_send_claims (destination_hash, reserved_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_claims_dest_content_time
  ON wa_outbound_send_claims (destination_hash, content_hash, reserved_at DESC);

-- Kept as append-only delivery audit for compatibility; it is not the guard
-- authority. Guard decisions are made only from reservations above.
CREATE TABLE IF NOT EXISTS wa_outbound_sends (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_hash  TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  inbound_event_id  UUID REFERENCES wa_inbound_events(id) ON DELETE SET NULL,
  branch            TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_sends_dest_time
  ON wa_outbound_sends (destination_hash, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_sends_dest_content_time
  ON wa_outbound_sends (destination_hash, content_hash, sent_at DESC);

-- One transaction and one advisory lock per destination serialize all
-- concurrent serverless instances. Rolling timestamp comparisons avoid bucket
-- boundary escape. A reservation counts even if delivery later fails: a
-- temporary false suppression is safer than duplicate customer spam.
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
  IF p_inbound_event_id IS NULL OR COALESCE(p_destination_hash, '') = ''
     OR COALESCE(p_content_hash, '') = '' OR p_duplicate_window_seconds < 1
     OR p_rate_window_seconds < 1 OR p_rate_limit < 1 THEN
    RETURN QUERY SELECT 'error'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_destination_hash, 0));

  UPDATE wa_inbound_events
  SET outbound_attempted = TRUE, processing_status = 'sending', updated_at = v_now
  WHERE id = p_inbound_event_id AND outbound_attempted = FALSE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN QUERY SELECT 'already_attempted'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND content_hash = p_content_hash
      AND reserved_at >= v_now - make_interval(secs => p_duplicate_window_seconds)
  ) THEN
    UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
    WHERE id = p_inbound_event_id;
    RETURN QUERY SELECT 'duplicate_content'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF (
    SELECT COUNT(*) FROM wa_outbound_send_claims
    WHERE destination_hash = p_destination_hash
      AND reserved_at >= v_now - make_interval(secs => p_rate_window_seconds)
  ) >= p_rate_limit THEN
    UPDATE wa_inbound_events SET processing_status = 'failed', updated_at = v_now
    WHERE id = p_inbound_event_id;
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
  WHERE id = p_claim_id AND inbound_event_id = p_inbound_event_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN FALSE; END IF;

  UPDATE wa_inbound_events
  SET processing_status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
      outbound_sent = p_sent,
      updated_at = clock_timestamp()
  WHERE id = p_inbound_event_id;
  RETURN TRUE;
END;
$$;

ALTER TABLE wa_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_outbound_send_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_outbound_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE wa_inbound_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE wa_outbound_send_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE wa_outbound_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE wa_inbound_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE wa_outbound_send_claims TO service_role;
GRANT SELECT, INSERT ON TABLE wa_outbound_sends TO service_role;
REVOKE ALL ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_wa_automated_send(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_wa_automated_send(UUID, UUID, BOOLEAN) TO service_role;

COMMIT;
