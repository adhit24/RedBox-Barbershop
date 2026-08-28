-- server/migrations/2026-08-29-wa-antispam-idempotency.sql
-- P0 incident hotfix: the same inbound Fonnte webhook was processed more
-- than once (retry / concurrent serverless instances / cold start losing
-- in-memory dedup state), producing repeated automated Reddy replies to the
-- same customer message. The prior dedup (isDuplicate() in api/wa/webhook.js)
-- is an in-memory Set scoped to one warm process — not durable across
-- serverless instances. This migration adds the durable, atomically-claimed
-- store that replaces it as the authoritative gate.
--
-- wa_inbound_events: one row per genuine provider inbound event, claimed
-- atomically via the UNIQUE constraint below (INSERT ... on conflict fails
-- closed to "duplicate", never silently overwrites). Also the anchor row
-- for the outbound send-once claim (outbound_attempted/outbound_sent),
-- so a crash between claiming and sending fails toward a missed reply
-- rather than a duplicate send.
--
-- wa_outbound_sends: append-only log of automated sends, keyed by hashed
-- destination + hashed content — never raw phone numbers or message text.
-- Backs both the short-window duplicate-content circuit breaker and the
-- per-customer automated rate limit.
--
-- Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS wa_inbound_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL DEFAULT 'fonnte',
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

-- The atomic claim: two concurrent inserts for the same provider event can
-- only have one winner. The loser gets a unique-violation (23505), not a
-- silently-merged row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_inbound_events_provider_message
  ON wa_inbound_events (provider, provider_message_id);

CREATE INDEX IF NOT EXISTS idx_wa_inbound_events_received_at
  ON wa_inbound_events (received_at DESC);

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

ALTER TABLE wa_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_outbound_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wa_inbound_events FROM anon, authenticated;
REVOKE ALL ON TABLE wa_outbound_sends FROM anon, authenticated;

COMMIT;
