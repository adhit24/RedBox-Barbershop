-- Migration: Add durable failure provenance to wa_inbound_events
-- DESIGN FILE ONLY - DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL.
--
-- Adds durable bounded lifecycle provenance:
--   failure_reason: bounded string (e.g. duplicate_suppressed, rate_limited, reddy_disabled, processing_failed, internal_exception, etc.)
--   terminal_source: bounded source caller (e.g. webhook_finally, outbound_guard, handoff_gate, etc.)
--   correlation_id: non-PII request correlation identifier (format: req_<uuid>)

BEGIN;

ALTER TABLE public.wa_inbound_events
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS terminal_source TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Bounded check constraint for failure_reason
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wa_inbound_events'::regclass
      AND conname = 'chk_wa_inbound_events_failure_reason'
  ) THEN
    ALTER TABLE public.wa_inbound_events
      ADD CONSTRAINT chk_wa_inbound_events_failure_reason
      CHECK (failure_reason IS NULL OR failure_reason IN (
        'unexpected_pre_send_exit',
        'processing_failed',
        'model_call_failed',
        'crm_context_failed',
        'duplicate_suppressed',
        'rate_limited',
        'reddy_disabled',
        'branch_number_suppressed',
        'admin_command_handled',
        'handoff_active',
        'legacy_human_takeover',
        'internal_exception',
        'invalid_fonnte_envelope',
        'unsupported_webhook_event',
        'kill_switch_suppressed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wa_inbound_events'::regclass
      AND conname = 'chk_wa_inbound_events_terminal_source'
  ) THEN
    ALTER TABLE public.wa_inbound_events
      ADD CONSTRAINT chk_wa_inbound_events_terminal_source
      CHECK (terminal_source IS NULL OR char_length(terminal_source) <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wa_inbound_events'::regclass
      AND conname = 'chk_wa_inbound_events_correlation_id'
  ) THEN
    ALTER TABLE public.wa_inbound_events
      ADD CONSTRAINT chk_wa_inbound_events_correlation_id
      CHECK (correlation_id IS NULL OR (char_length(correlation_id) <= 100 AND correlation_id ~ '^req_[a-zA-Z0-9_-]+$'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_inbound_events_correlation_id
  ON public.wa_inbound_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMIT;
