-- Persist Fonnte message identifiers and asynchronous delivery state.
-- Required so webhook state=0 can be correlated to a booking outbox row.
ALTER TABLE booking_notification_outbox
  ADD COLUMN IF NOT EXISTS provider_message_ids JSONB,
  ADD COLUMN IF NOT EXISTS provider_state_ids JSONB,
  ADD COLUMN IF NOT EXISTS provider_delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_delivery_state TEXT,
  ADD COLUMN IF NOT EXISTS last_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_webhook_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_booking_notification_outbox_provider_message_ids
  ON booking_notification_outbox USING GIN (provider_message_ids);

CREATE INDEX IF NOT EXISTS idx_booking_notification_outbox_provider_state_ids
  ON booking_notification_outbox USING GIN (provider_state_ids);

-- Backfill rows created before these columns existed. Fonnte returns numeric
-- ids in provider_response, while new sends normalize ids to JSON strings.
UPDATE booking_notification_outbox
SET provider_message_ids = (
  SELECT jsonb_agg(to_jsonb(value #>> '{}'))
  FROM jsonb_array_elements(provider_response->'id') AS ids(value)
)
WHERE provider_message_ids IS NULL
  AND jsonb_typeof(provider_response->'id') = 'array';
