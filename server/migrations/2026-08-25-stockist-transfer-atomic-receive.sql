-- server/migrations/2026-08-25-stockist-transfer-atomic-receive.sql

-- 1. Table for server-side Idempotency Keys
create table if not exists stockist_idempotency_keys (
  idempotency_key text primary key,
  request_path text not null,
  response_body jsonb not null,
  status_code integer not null,
  created_at timestamptz not null default now()
);

-- Index for auto-cleanup queries if needed later
create index if not exists idx_stockist_idempotency_keys_created_at on stockist_idempotency_keys (created_at);

-- 2. Atomic Database Transaction Function (RPC) for Confirming Stock Transfer Receipt
create or replace function confirm_stock_transfer_receive(
  p_transfer_id uuid,
  p_items jsonb,
  p_received_by text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_transfer record;
  v_item record;
  v_elem jsonb;
  v_item_id uuid;
  v_qty_recv integer;
  v_reason text;
  v_photo_url text;
  v_sent_count integer;
  v_received_count integer;
  v_has_discrepancy boolean := false;
  v_result jsonb;
  v_existing_idempotency record;
begin
  -- Idempotency check
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select response_body, status_code into v_existing_idempotency
    from stockist_idempotency_keys
    where idempotency_key = p_idempotency_key;

    if found then
      return v_existing_idempotency.response_body;
    end if;
  end if;

  -- 1. Row locking on stock_transfers
  select * into v_transfer
  from stock_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'transfer not found';
  end if;

  if v_transfer.status <> 'SENT' then
    raise exception 'transfer already received or not in SENT status';
  end if;

  -- 2. Complete item-set validation
  select count(*) into v_sent_count
  from stock_transfer_items
  where stock_transfer_id = p_transfer_id;

  v_received_count := jsonb_array_length(p_items);

  if v_received_count <> v_sent_count then
    raise exception 'all items in transfer must be submitted for receipt confirmation';
  end if;

  -- Row locking on stock_transfer_items
  perform 1
  from stock_transfer_items
  where stock_transfer_id = p_transfer_id
  for update;

  -- 3. Process items and validate discrepancies
  for v_elem in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_elem->>'id')::uuid;
    v_qty_recv := (v_elem->>'quantity_received')::integer;
    v_reason := trim(coalesce(v_elem->>'discrepancy_reason', ''));
    v_photo_url := v_elem->>'discrepancy_photo_url';

    select * into v_item
    from stock_transfer_items
    where id = v_item_id and stock_transfer_id = p_transfer_id;

    if not found then
      raise exception 'item % does not belong to transfer %', v_item_id, p_transfer_id;
    end if;

    if v_qty_recv is null or v_qty_recv < 0 then
      raise exception 'quantity_received cannot be negative';
    end if;

    if v_qty_recv <> v_item.quantity_sent then
      v_has_discrepancy := true;
      if v_reason = '' then
        raise exception 'discrepancy reason is required for mismatched quantity on item %', v_item_id;
      end if;
    end if;

    -- Update item record
    update stock_transfer_items
    set quantity_received = v_qty_recv,
        discrepancy_reason = nullif(v_reason, ''),
        discrepancy_photo_url = v_photo_url
    where id = v_item_id;

    -- Inventory Movement & Balance Update (All-or-Nothing)
    if v_qty_recv > 0 then
      insert into inventory_movements (
        stock_transfer_id,
        product_id,
        location_id,
        movement_type,
        quantity,
        created_at,
        created_by
      ) values (
        p_transfer_id,
        v_item.product_id,
        v_transfer.destination_location_id,
        'TRANSFER_RECEIVE',
        v_qty_recv,
        now(),
        p_received_by
      );

      insert into inventory_balances (location_id, product_id, quantity)
      values (v_transfer.destination_location_id, v_item.product_id, v_qty_recv)
      on conflict (location_id, product_id)
      do update set quantity = inventory_balances.quantity + v_qty_recv;
    end if;
  end loop;

  -- 4. Update stock_transfers status
  update stock_transfers
  set status = 'RECEIVED',
      received_at = now(),
      received_by = p_received_by,
      has_discrepancy = v_has_discrepancy
  where id = p_transfer_id;

  v_result := jsonb_build_object(
    'success', true,
    'transfer_id', p_transfer_id,
    'status', 'RECEIVED',
    'has_discrepancy', v_has_discrepancy
  );

  -- Store Idempotency Key record
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into stockist_idempotency_keys (idempotency_key, request_path, response_body, status_code)
    values (p_idempotency_key, '/transfers/' || p_transfer_id || '/receive', v_result, 200);
  end if;

  return v_result;
end;
$$;
