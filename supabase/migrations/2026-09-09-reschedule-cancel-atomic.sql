-- server/migrations/2026-09-09-reschedule-cancel-atomic.sql
-- P2-B6: Reschedule and Cancel Integrity (Atomic Booking + Schedule Updates)

-- 1. Function: public.reschedule_booking_atomic
CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic(
  p_booking_id UUID,
  p_new_date DATE,
  p_new_time TIME,
  p_new_barber_id TEXT DEFAULT NULL,
  p_new_location TEXT DEFAULT NULL,
  p_new_duration TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking RECORD;
  v_schedule RECORD;
  v_barber_id TEXT;
  v_location TEXT;
  v_duration TEXT;
  v_dur_mins INTEGER := 30;
  v_dur_match TEXT[];
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_outlet_id UUID;
  v_updated_booking RECORD;
BEGIN
  -- 1. Lock existing booking row
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'BOOKING_ALREADY_CANCELLED' USING ERRCODE = '22023';
  END IF;

  -- 2. Resolve target parameters (fallback to current if not specified)
  v_barber_id := COALESCE(NULLIF(TRIM(p_new_barber_id), ''), v_booking.barber_id);
  v_location  := COALESCE(NULLIF(TRIM(p_new_location), ''), v_booking.location, 'bypass');
  v_duration  := COALESCE(NULLIF(TRIM(p_new_duration), ''), v_booking.duration, '30');

  -- 3. Resolve target outlet
  SELECT id INTO v_outlet_id
  FROM outlets
  WHERE slug = LOWER(v_location)
  LIMIT 1;

  IF v_outlet_id IS NULL THEN
    SELECT id INTO v_outlet_id FROM outlets WHERE slug = 'bypass' LIMIT 1;
  END IF;

  -- 4. Calculate new time range
  v_dur_match := regexp_matches(v_duration, '\d+');
  IF array_length(v_dur_match, 1) > 0 THEN
    v_dur_mins := v_dur_match[1]::integer;
  END IF;
  IF v_booking.notes LIKE '%[HOME SERVICE]%' OR v_booking.notes LIKE '%[WEDDING]%' THEN
    IF v_dur_mins < 120 THEN v_dur_mins := 120; END IF;
  END IF;
  IF v_dur_mins <= 0 THEN v_dur_mins := 30; END IF;

  v_start_time := (p_new_date + p_new_time) AT TIME ZONE 'Asia/Jakarta';
  v_end_time := v_start_time + (v_dur_mins || ' minutes')::interval;

  -- 5. If specific barber, check schedule overlap excluding current schedule
  IF v_barber_id IS NOT NULL AND v_barber_id <> 'any' THEN
    IF EXISTS (
      SELECT 1 FROM schedules
      WHERE barber_id = v_barber_id
        AND (v_booking.schedule_id IS NULL OR id <> v_booking.schedule_id)
        AND status NOT IN ('cancelled')
        AND tstzrange(start_time, end_time, '[)') && tstzrange(v_start_time, v_end_time, '[)')
    ) THEN
      RAISE EXCEPTION 'BOOKING_SLOT_CONFLICT' USING ERRCODE = '23P01';
    END IF;
  END IF;

  -- 6. Update linked schedule row if present
  IF v_booking.schedule_id IS NOT NULL THEN
    UPDATE schedules
    SET
      outlet_id  = COALESCE(v_outlet_id, outlet_id),
      barber_id  = CASE WHEN v_barber_id = 'any' THEN NULL ELSE v_barber_id END,
      start_time = v_start_time,
      end_time   = v_end_time,
      status     = CASE WHEN status = 'cancelled' THEN 'confirmed' ELSE status END,
      updated_at = NOW()
    WHERE id = v_booking.schedule_id;
  ELSE
    -- If booking had no schedule_id (legacy edge case), create one now
    INSERT INTO schedules (
      outlet_id,
      barber_id,
      service_name,
      price,
      start_time,
      end_time,
      status,
      source,
      external_id,
      notes
    ) VALUES (
      COALESCE(v_outlet_id, (SELECT id FROM outlets WHERE slug = 'bypass' LIMIT 1)),
      CASE WHEN v_barber_id = 'any' THEN NULL ELSE v_barber_id END,
      v_booking.service,
      COALESCE(v_booking.price, 0),
      v_start_time,
      v_end_time,
      'confirmed',
      'web',
      'booking:' || v_booking.id::text,
      v_booking.notes
    )
    RETURNING id INTO v_booking.schedule_id;
  END IF;

  -- 7. Update booking row
  UPDATE bookings
  SET
    date        = p_new_date,
    time        = p_new_time,
    barber_id   = v_barber_id,
    location    = v_location,
    duration    = v_duration,
    schedule_id = v_booking.schedule_id,
    updated_at  = NOW()
  WHERE id = p_booking_id
  RETURNING * INTO v_updated_booking;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'schedule_id', v_booking.schedule_id,
    'booking', to_jsonb(v_updated_booking),
    'start_time', v_start_time,
    'end_time', v_end_time
  );
END;
$$;

-- 2. Function: cancel_booking_atomic
CREATE OR REPLACE FUNCTION public.cancel_booking_atomic(
  p_booking_id UUID,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking RECORD;
BEGIN
  -- 1. Lock booking row
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status = 'cancelled' THEN
    -- Idempotent cancel: return success if already cancelled
    RETURN jsonb_build_object(
      'success', true,
      'already_cancelled', true,
      'booking_id', p_booking_id,
      'schedule_id', v_booking.schedule_id
    );
  END IF;

  -- 2. Update booking status to cancelled
  UPDATE bookings
  SET
    status     = 'cancelled',
    notes      = CASE
                   WHEN p_reason IS NOT NULL AND TRIM(p_reason) <> ''
                   THEN TRIM(COALESCE(notes, '') || E'\n[CANCEL] ' || TRIM(p_reason))
                   ELSE notes
                 END,
    updated_at = NOW()
  WHERE id = p_booking_id;

  -- 3. Update linked schedule status to cancelled
  IF v_booking.schedule_id IS NOT NULL THEN
    UPDATE schedules
    SET
      status     = 'cancelled',
      updated_at = NOW()
    WHERE id = v_booking.schedule_id
      AND status <> 'cancelled';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_cancelled', false,
    'booking_id', p_booking_id,
    'schedule_id', v_booking.schedule_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_booking_atomic FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_booking_atomic FROM anon;
REVOKE EXECUTE ON FUNCTION public.reschedule_booking_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_atomic TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_atomic FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_booking_atomic FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_booking_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic TO service_role;
