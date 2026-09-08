-- supabase/migrations/2026-09-09-booking-atomic-and-idempotency.sql
-- P2-B2 & P2-B3: Atomic Booking + Schedule Creation and Idempotency Guard

-- 1. Ensure columns and constraints exist on bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_request_id UUID,
  ADD COLUMN IF NOT EXISTS group_request_id UUID,
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_price INTEGER,
  ADD COLUMN IF NOT EXISTS discount_label TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'outlet';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_request_id
  ON bookings (booking_request_id)
  WHERE booking_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_group_request_id
  ON bookings (group_request_id)
  WHERE group_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_schedule_id
  ON bookings (schedule_id)
  WHERE schedule_id IS NOT NULL;

-- 2. Function: create_booking_atomic
-- Creates a booking and its corresponding schedule inside ONE atomic transaction.
-- Enforces slot conflict (exclusion / overlap), idempotent replay via booking_request_id,
-- and links schedule_id to the booking row.
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_booking_id UUID,
  p_booking_request_id UUID,
  p_group_request_id UUID,
  p_name TEXT,
  p_wa TEXT,
  p_service_id TEXT,
  p_service TEXT,
  p_price INTEGER,
  p_duration TEXT,
  p_barber_id TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT,
  p_status TEXT,
  p_notes TEXT,
  p_payment TEXT,
  p_type TEXT,
  p_original_price INTEGER DEFAULT NULL,
  p_discount_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_existing_booking RECORD;
  v_booking_id UUID;
  v_outlet_id UUID;
  v_dur_mins INTEGER := 30;
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_schedule_id UUID;
  v_schedule_status TEXT;
  v_schedule_type TEXT;
  v_inserted_booking RECORD;
  v_dur_match TEXT[];
BEGIN
  -- 1. Idempotency check via p_booking_request_id
  IF p_booking_request_id IS NOT NULL THEN
    SELECT b.*, s.id AS linked_schedule_id, s.status AS linked_schedule_status
    INTO v_existing_booking
    FROM bookings b
    LEFT JOIN schedules s ON s.id = b.schedule_id
    WHERE b.booking_request_id = p_booking_request_id
    LIMIT 1;

    IF FOUND THEN
      -- Canonical material parity check: compare all core booking intent fields
      IF v_existing_booking.wa = p_wa
         AND v_existing_booking.service = p_service
         AND v_existing_booking.price = COALESCE(p_price, 0)
         AND v_existing_booking.duration IS NOT DISTINCT FROM p_duration
         AND v_existing_booking.barber_id IS NOT DISTINCT FROM p_barber_id
         AND v_existing_booking.date = p_date
         AND v_existing_booking.time = p_time
         AND v_existing_booking.location IS NOT DISTINCT FROM p_location
         AND v_existing_booking.type IS NOT DISTINCT FROM COALESCE(p_type, 'outlet')
         AND v_existing_booking.service_id IS NOT DISTINCT FROM COALESCE(p_service_id, '')
         AND v_existing_booking.notes IS NOT DISTINCT FROM p_notes
         AND v_existing_booking.payment IS NOT DISTINCT FROM p_payment
         AND v_existing_booking.original_price IS NOT DISTINCT FROM p_original_price
         AND v_existing_booking.discount_label IS NOT DISTINCT FROM p_discount_label THEN
        -- Idempotent replay: return existing booking and schedule data
        RETURN jsonb_build_object(
          'success', true,
          'replayed', true,
          'booking', to_jsonb(v_existing_booking),
          'booking_id', v_existing_booking.id,
          'schedule_id', v_existing_booking.linked_schedule_id
        );
      ELSE
        -- Idempotency key reused with materially mismatched payload -> conflict
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- 2. Resolve outlet UUID from location slug
  SELECT id INTO v_outlet_id
  FROM outlets
  WHERE slug = COALESCE(NULLIF(TRIM(LOWER(p_location)), ''), 'bypass')
  LIMIT 1;

  IF v_outlet_id IS NULL THEN
    SELECT id INTO v_outlet_id FROM outlets WHERE slug = 'bypass' LIMIT 1;
  END IF;

  IF v_outlet_id IS NULL THEN
    RAISE EXCEPTION 'OUTLET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Calculate start & end timestamps in WIB (+07:00)
  IF p_duration IS NOT NULL AND TRIM(p_duration) <> '' THEN
    v_dur_match := regexp_matches(p_duration, '\d+');
    IF array_length(v_dur_match, 1) > 0 THEN
      v_dur_mins := v_dur_match[1]::integer;
    END IF;
  END IF;

  IF p_type IN ('home_service', 'wedding') AND v_dur_mins < 120 THEN
    v_dur_mins := 120;
  END IF;

  IF v_dur_mins <= 0 THEN
    v_dur_mins := 30;
  END IF;

  v_start_time := (p_date || ' ' || p_time || '+07')::timestamptz;
  v_end_time   := v_start_time + (v_dur_mins || ' minutes')::interval;

  -- 4. Pre-check slot overlap if specific barber is assigned
  IF p_barber_id IS NOT NULL AND p_barber_id <> 'any' THEN
    IF EXISTS (
      SELECT 1 FROM schedules
      WHERE barber_id = p_barber_id
        AND status NOT IN ('cancelled')
        AND tstzrange(start_time, end_time, '[)') && tstzrange(v_start_time, v_end_time, '[)')
    ) THEN
      RAISE EXCEPTION 'BOOKING_SLOT_CONFLICT' USING ERRCODE = '23P01';
    END IF;
  END IF;

  -- 5. Prepare IDs and types
  v_booking_id := COALESCE(p_booking_id, gen_random_uuid());
  v_schedule_status := CASE WHEN LOWER(COALESCE(p_status, '')) = 'confirmed' THEN 'confirmed' ELSE 'reserved' END;
  v_schedule_type := CASE WHEN p_type IN ('home_service', 'wedding') THEN 'home_service' ELSE 'outlet' END;

  -- 6. Insert schedule row (protected by GiST exclusion no_barber_overlap)
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
    notes,
    type
  ) VALUES (
    v_outlet_id,
    CASE WHEN p_barber_id = 'any' THEN NULL ELSE p_barber_id END,
    p_service,
    COALESCE(p_price, 0),
    v_start_time,
    v_end_time,
    v_schedule_status,
    'web',
    'booking:' || v_booking_id::text,
    p_notes,
    v_schedule_type
  )
  RETURNING id INTO v_schedule_id;

  -- 7. Insert booking row with linked schedule_id
  -- Protected by unique constraint idx_bookings_request_id under concurrency
  BEGIN
    INSERT INTO bookings (
      id,
      booking_request_id,
      group_request_id,
      schedule_id,
      name,
      wa,
      service_id,
      service,
      price,
      duration,
      barber_id,
      date,
      time,
      location,
      status,
      notes,
      payment,
      type,
      original_price,
      discount_label
    ) VALUES (
      v_booking_id,
      p_booking_request_id,
      p_group_request_id,
      v_schedule_id,
      p_name,
      p_wa,
      COALESCE(p_service_id, ''),
      p_service,
      COALESCE(p_price, 0),
      p_duration,
      p_barber_id,
      p_date,
      p_time,
      p_location,
      COALESCE(p_status, 'confirmed'),
      p_notes,
      p_payment,
      COALESCE(p_type, 'outlet'),
      p_original_price,
      p_discount_label
    )
    RETURNING * INTO v_inserted_booking;
  EXCEPTION
    WHEN unique_violation THEN
      -- Handle concurrent race: Another request committed the same booking_request_id
      IF p_booking_request_id IS NOT NULL THEN
        -- Delete the newly created schedule to avoid orphan schedule row
        DELETE FROM schedules WHERE id = v_schedule_id;

        SELECT b.*, s.id AS linked_schedule_id, s.status AS linked_schedule_status
        INTO v_existing_booking
        FROM bookings b
        LEFT JOIN schedules s ON s.id = b.schedule_id
        WHERE b.booking_request_id = p_booking_request_id
        LIMIT 1;

        IF FOUND THEN
          -- Check canonical material parity against the concurrently committed booking
          IF v_existing_booking.wa = p_wa
             AND v_existing_booking.service = p_service
             AND v_existing_booking.price = COALESCE(p_price, 0)
             AND v_existing_booking.duration IS NOT DISTINCT FROM p_duration
             AND v_existing_booking.barber_id IS NOT DISTINCT FROM p_barber_id
             AND v_existing_booking.date = p_date
             AND v_existing_booking.time = p_time
             AND v_existing_booking.location IS NOT DISTINCT FROM p_location
             AND v_existing_booking.type IS NOT DISTINCT FROM COALESCE(p_type, 'outlet')
             AND v_existing_booking.service_id IS NOT DISTINCT FROM COALESCE(p_service_id, '')
             AND v_existing_booking.notes IS NOT DISTINCT FROM p_notes
             AND v_existing_booking.payment IS NOT DISTINCT FROM p_payment
             AND v_existing_booking.original_price IS NOT DISTINCT FROM p_original_price
             AND v_existing_booking.discount_label IS NOT DISTINCT FROM p_discount_label THEN
            RETURN jsonb_build_object(
              'success', true,
              'replayed', true,
              'booking', to_jsonb(v_existing_booking),
              'booking_id', v_existing_booking.id,
              'schedule_id', v_existing_booking.linked_schedule_id
            );
          ELSE
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '23505';
          END IF;
        END IF;
      END IF;
      RAISE;
  END;

  -- 8. Return composite result
  RETURN jsonb_build_object(
    'success', true,
    'replayed', false,
    'booking', to_jsonb(v_inserted_booking),
    'booking_id', v_booking_id,
    'schedule_id', v_schedule_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_booking_atomic FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic TO service_role;
