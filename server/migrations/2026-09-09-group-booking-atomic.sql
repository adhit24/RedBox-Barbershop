-- server/migrations/2026-09-09-group-booking-atomic.sql
-- P2-B5: Atomic Group Booking (All-or-Nothing Transaction)

CREATE OR REPLACE FUNCTION public.create_group_booking_atomic(
  p_group_request_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_existing_bookings JSONB;
  v_item JSONB;
  v_idx INTEGER := 0;
  v_item_result JSONB;
  v_results JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_item_request_id UUID;
BEGIN
  IF p_group_request_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'GROUP_ITEMS_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- 1. Idempotency check on group_request_id
  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id', b.id,
      'schedule_id', b.schedule_id,
      'booking', to_jsonb(b)
    )
  )
  INTO v_existing_bookings
  FROM bookings b
  WHERE b.group_request_id = p_group_request_id;

  IF v_existing_bookings IS NOT NULL AND jsonb_array_length(v_existing_bookings) > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'replayed', true,
      'group_request_id', p_group_request_id,
      'items', v_existing_bookings
    );
  END IF;

  -- 2. Process each item inside this single atomic transaction
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_idx := v_idx + 1;
    v_item_id := NULL;
    IF v_item->>'id' IS NOT NULL AND TRIM(v_item->>'id') <> '' THEN
      BEGIN
        v_item_id := (v_item->>'id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_item_id := gen_random_uuid();
      END;
    ELSE
      v_item_id := gen_random_uuid();
    END IF;

    v_item_request_id := NULL;
    IF v_item->>'booking_request_id' IS NOT NULL AND TRIM(v_item->>'booking_request_id') <> '' THEN
      BEGIN
        v_item_request_id := (v_item->>'booking_request_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_item_request_id := NULL;
      END;
    END IF;

    BEGIN
      v_item_result := create_booking_atomic(
        p_booking_id         := v_item_id,
        p_booking_request_id := v_item_request_id,
        p_group_request_id   := p_group_request_id,
        p_name               := v_item->>'name',
        p_wa                 := v_item->>'wa',
        p_service_id         := v_item->>'service_id',
        p_service            := v_item->>'service',
        p_price              := COALESCE((v_item->>'price')::integer, 0),
        p_duration           := v_item->>'duration',
        p_barber_id          := v_item->>'barber_id',
        p_date               := (v_item->>'date')::date,
        p_time               := (v_item->>'time')::time,
        p_location           := v_item->>'location',
        p_status             := COALESCE(v_item->>'status', 'confirmed'),
        p_notes              := v_item->>'notes',
        p_payment            := v_item->>'payment',
        p_type               := COALESCE(v_item->>'type', 'outlet'),
        p_original_price     := (v_item->>'original_price')::integer,
        p_discount_label     := v_item->>'discount_label'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Any failure on any item immediately rolls back the entire group transaction
      RAISE EXCEPTION 'GROUP_ITEM_%_FAILED: %', v_idx, SQLERRM;
    END;

    v_results := v_results || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'replayed', false,
    'group_request_id', p_group_request_id,
    'items', v_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_group_booking_atomic FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_group_booking_atomic FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_group_booking_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_booking_atomic TO service_role;
