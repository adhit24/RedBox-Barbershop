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
