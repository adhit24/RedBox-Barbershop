-- Durable customer WhatsApp delivery queue.
-- Apply this migration in the production Supabase project before enabling cron.
CREATE TABLE IF NOT EXISTS booking_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_booking_notification_outbox_due
  ON booking_notification_outbox (status, next_attempt_at);

ALTER TABLE booking_notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_notification_outbox_service_only
  ON booking_notification_outbox;
CREATE POLICY booking_notification_outbox_service_only
  ON booking_notification_outbox FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
