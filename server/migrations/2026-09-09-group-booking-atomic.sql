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
  v_existing_count INTEGER;
  v_canonical_incoming JSONB;
  v_canonical_existing JSONB;
BEGIN
  IF p_group_request_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'GROUP_ITEMS_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- 1. Idempotency concurrency lock on group_request_id with 1:1 canonical multiset parity
  IF p_group_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(('x' || substr(md5('group_booking_request:' || p_group_request_id::text), 1, 16))::bit(64)::bigint);

    SELECT count(*) INTO v_existing_count
    FROM bookings
    WHERE group_request_id = p_group_request_id;

    IF v_existing_count > 0 THEN
      -- Build deterministically sorted canonical JSON representation for incoming items
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'barber_id', COALESCE(elem->>'barber_id', ''),
            'date', (elem->>'date')::date::text,
            'discount_label', COALESCE(elem->>'discount_label', ''),
            'duration', COALESCE(elem->>'duration', '30'),
            'location', COALESCE(elem->>'location', 'bypass'),
            'notes', COALESCE(elem->>'notes', ''),
            'original_price', CASE WHEN elem ? 'original_price' AND elem->>'original_price' IS NOT NULL THEN (elem->>'original_price')::integer ELSE NULL END,
            'payment', COALESCE(elem->>'payment', ''),
            'price', COALESCE((elem->>'price')::integer, 0),
            'service', elem->>'service',
            'service_id', COALESCE(elem->>'service_id', ''),
            'time', (elem->>'time')::time::text,
            'type', COALESCE(elem->>'type', 'outlet'),
            'wa', elem->>'wa'
          )
          ORDER BY
            elem->>'wa',
            (elem->>'date')::date,
            (elem->>'time')::time,
            COALESCE(elem->>'barber_id', ''),
            elem->>'service',
            COALESCE((elem->>'price')::integer, 0),
            COALESCE(elem->>'service_id', ''),
            COALESCE(elem->>'duration', '30'),
            COALESCE(elem->>'location', 'bypass'),
            COALESCE(elem->>'type', 'outlet'),
            COALESCE(elem->>'notes', ''),
            COALESCE(elem->>'payment', ''),
            COALESCE((elem->>'original_price')::integer, 0),
            COALESCE(elem->>'discount_label', '')
        ),
        '[]'::jsonb
      ) INTO v_canonical_incoming
      FROM jsonb_array_elements(p_items) elem;

      -- Build deterministically sorted canonical JSON representation for existing bookings
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'barber_id', COALESCE(b.barber_id::text, ''),
            'date', b.date::text,
            'discount_label', COALESCE(b.discount_label, ''),
            'duration', COALESCE(b.duration, '30'),
            'location', COALESCE(b.location, 'bypass'),
            'notes', COALESCE(b.notes, ''),
            'original_price', b.original_price,
            'payment', COALESCE(b.payment, ''),
            'price', COALESCE(b.price, 0),
            'service', b.service,
            'service_id', COALESCE(b.service_id, ''),
            'time', b.time::text,
            'type', COALESCE(b.type, 'outlet'),
            'wa', b.wa
          )
          ORDER BY
            b.wa,
            b.date,
            b.time,
            COALESCE(b.barber_id::text, ''),
            b.service,
            COALESCE(b.price, 0),
            COALESCE(b.service_id, ''),
            COALESCE(b.duration, '30'),
            COALESCE(b.location, 'bypass'),
            COALESCE(b.type, 'outlet'),
            COALESCE(b.notes, ''),
            COALESCE(b.payment, ''),
            COALESCE(b.original_price, 0),
            COALESCE(b.discount_label, '')
        ),
        '[]'::jsonb
      ) INTO v_canonical_existing
      FROM bookings b
      WHERE b.group_request_id = p_group_request_id;

      -- Direct 1:1 multiset comparison
      IF v_canonical_incoming = v_canonical_existing THEN
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

        RETURN jsonb_build_object(
          'success', true,
          'replayed', true,
          'group_request_id', p_group_request_id,
          'items', v_existing_bookings
        );
      ELSE
        -- Group key reused with any material difference in items, fields, or duplicates
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '23505';
      END IF;
    END IF;
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
