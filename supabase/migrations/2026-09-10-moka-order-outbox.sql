-- ============================================================
-- REDBOX BARBERSHOP — Moka Order Outbox & Persistent Idempotency
-- Migration: 2026-09-10-moka-order-outbox.sql
-- ============================================================

-- 1. Add is_test flag to bookings and schedules to support automated test isolation
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

-- 2. Create moka_order_outbox table
CREATE TABLE IF NOT EXISTS public.moka_order_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  schedule_id UUID UNIQUE REFERENCES public.schedules(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  moka_order_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create indexes for performance and concurrency
CREATE INDEX IF NOT EXISTS idx_moka_order_outbox_status_attempt
  ON public.moka_order_outbox (status, attempt_count, last_attempt_at);

CREATE INDEX IF NOT EXISTS idx_moka_order_outbox_schedule_id
  ON public.moka_order_outbox (schedule_id);

CREATE INDEX IF NOT EXISTS idx_moka_order_outbox_booking_id
  ON public.moka_order_outbox (booking_id);

-- 4. Atomic claim RPC function
CREATE OR REPLACE FUNCTION public.claim_moka_outbox_job(
  p_schedule_id UUID,
  p_booking_id UUID DEFAULT NULL,
  p_stale_interval INTERVAL DEFAULT INTERVAL '5 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking_id UUID := p_booking_id;
  v_row public.moka_order_outbox%ROWTYPE;
BEGIN
  IF p_schedule_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'error', 'p_schedule_id is required');
  END IF;

  -- If booking_id not provided, try resolving from bookings table
  IF v_booking_id IS NULL THEN
    SELECT id INTO v_booking_id FROM public.bookings WHERE schedule_id = p_schedule_id LIMIT 1;
  END IF;

  -- Ensure outbox row exists in 'pending' state if not present
  IF v_booking_id IS NOT NULL THEN
    INSERT INTO public.moka_order_outbox (booking_id, schedule_id, status)
    VALUES (v_booking_id, p_schedule_id, 'pending')
    ON CONFLICT (schedule_id) DO UPDATE
      SET booking_id = COALESCE(public.moka_order_outbox.booking_id, EXCLUDED.booking_id)
      WHERE public.moka_order_outbox.booking_id IS NULL;
  ELSE
    INSERT INTO public.moka_order_outbox (schedule_id, status)
    VALUES (p_schedule_id, 'pending')
    ON CONFLICT (schedule_id) DO NOTHING;
  END IF;

  -- Check if already sent
  SELECT * INTO v_row FROM public.moka_order_outbox WHERE schedule_id = p_schedule_id;
  IF v_row.status = 'sent' OR v_row.moka_order_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'sent',
      'outbox_id', v_row.id,
      'moka_order_id', v_row.moka_order_id,
      'attempt_count', v_row.attempt_count
    );
  END IF;

  -- Attempt atomic transition from pending/failed (or stale processing) to processing
  UPDATE public.moka_order_outbox
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      updated_at = now()
  WHERE schedule_id = p_schedule_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'processing' AND last_attempt_at < now() - p_stale_interval)
    )
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'status', v_row.status,
      'outbox_id', v_row.id,
      'moka_order_id', v_row.moka_order_id,
      'attempt_count', v_row.attempt_count
    );
  ELSE
    -- Row was claimed by another worker and is currently fresh processing
    SELECT * INTO v_row FROM public.moka_order_outbox WHERE schedule_id = p_schedule_id;
    RETURN jsonb_build_object(
      'claimed', false,
      'status', v_row.status,
      'outbox_id', v_row.id,
      'moka_order_id', v_row.moka_order_id,
      'attempt_count', v_row.attempt_count
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_moka_outbox_job FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_moka_outbox_job FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_moka_outbox_job TO service_role;
