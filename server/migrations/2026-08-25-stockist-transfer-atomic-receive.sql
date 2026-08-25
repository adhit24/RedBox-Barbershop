-- server/migrations/2026-08-25-stockist-transfer-atomic-receive.sql

-- 1. Table for server-side Idempotency Keys binding key, path, transfer_id, and request_hash
create table if not exists public.stockist_idempotency_keys (
  idempotency_key text primary key,
  request_path text not null,
  transfer_id uuid not null,
  request_hash text not null,
  status_code integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now()
);

-- Enable RLS and revoke all frontend access from public/anon/authenticated
alter table public.stockist_idempotency_keys enable row level security;
revoke all on public.stockist_idempotency_keys from public;
revoke all on public.stockist_idempotency_keys from anon, authenticated;
grant all on public.stockist_idempotency_keys to service_role;

-- Index for auto-cleanup queries
create index if not exists idx_stockist_idempotency_keys_created_at on public.stockist_idempotency_keys (created_at);

-- 2. Atomic Database Transaction Function (RPC) for Confirming Stock Transfer Receipt
create or replace function public.confirm_stock_transfer_receive(
  p_transfer_id uuid,
  p_items jsonb,
  p_received_by text,
  p_idempotency_key text default null,
  p_request_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
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
  v_seen_item_ids text[] := '{}';
  v_qty_before integer := 0;
  v_user_uuid uuid;
begin
  -- Parse received_by UUID safely
  begin
    v_user_uuid := (p_received_by)::uuid;
  exception when others then
    v_user_uuid := null;
  end;

  -- 1. Idempotency Check & Re-use Detection
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select transfer_id, request_hash, response_body, status_code into v_existing_idempotency
    from public.stockist_idempotency_keys
    where idempotency_key = p_idempotency_key;

    if found then
      if v_existing_idempotency.transfer_id = p_transfer_id and v_existing_idempotency.request_hash = coalesce(p_request_hash, '') then
        return v_existing_idempotency.response_body;
      else
        raise exception 'IDEMPOTENCY_KEY_REUSED: idempotency key reused with different request payload or transfer id';
      end if;
    end if;
  end if;

  -- 2. Row locking on public.stock_transfers (Lock before checking status)
  select * into v_transfer
  from public.stock_transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'TRANSFER_NOT_FOUND: transfer % not found', p_transfer_id;
  end if;

  if v_transfer.status <> 'SENT' then
    raise exception 'TRANSFER_ALREADY_RECEIVED: transfer already received or not in SENT status';
  end if;

  -- 3. Complete item-set validation & duplicate checking
  select pg_catalog.count(*) into v_sent_count
  from public.stock_transfer_items
  where stock_transfer_id = p_transfer_id;

  v_received_count := pg_catalog.jsonb_array_length(p_items);

  if v_received_count <> v_sent_count then
    raise exception 'INCOMPLETE_ITEM_SET: all transfer items must be included in the receive request';
  end if;

  -- Row locking on public.stock_transfer_items
  perform 1
  from public.stock_transfer_items
  where stock_transfer_id = p_transfer_id
  for update;

  -- 4. Process items and validate discrepancies
  for v_elem in select * from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_item_id := (v_elem->>'item_id')::uuid;
    if v_item_id is null then
      v_item_id := (v_elem->>'id')::uuid;
    end if;

    v_qty_recv := (v_elem->>'quantity_received')::integer;
    v_reason := pg_catalog.btrim(coalesce(v_elem->>'discrepancy_reason', v_elem->>'reason', ''));
    v_photo_url := coalesce(v_elem->>'discrepancy_photo_url', v_elem->>'photo_url');

    -- Duplicate item check
    if v_item_id::text = any(v_seen_item_ids) then
      raise exception 'DUPLICATE_ITEM_SUBMITTED: item % submitted multiple times', v_item_id;
    end if;
    v_seen_item_ids := pg_catalog.array_append(v_seen_item_ids, v_item_id::text);

    select * into v_item
    from public.stock_transfer_items
    where id = v_item_id and stock_transfer_id = p_transfer_id;

    if not found then
      raise exception 'INVALID_ITEM: item % does not belong to transfer %', v_item_id, p_transfer_id;
    end if;

    if v_qty_recv is null or v_qty_recv < 0 then
      raise exception 'INVALID_QUANTITY: quantity_received cannot be negative for item %', v_item_id;
    end if;

    if v_qty_recv <> v_item.quantity_sent then
      v_has_discrepancy := true;
      if v_reason = '' then
        raise exception 'DISCREPANCY_REASON_REQUIRED: discrepancy reason is required for mismatched quantity on item %', v_item_id;
      end if;
    end if;

    -- Update item record
    update public.stock_transfer_items
    set quantity_received = v_qty_recv,
        discrepancy_reason = nullif(v_reason, ''),
        discrepancy_photo_url = v_photo_url
    where id = v_item_id;

    -- Inventory Balance & Ledger Update (All-or-Nothing in same transaction)
    if v_qty_recv > 0 then
      -- Get current quantity before update
      select coalesce(quantity, 0) into v_qty_before
      from public.inventory_balances
      where product_id = v_item.product_id and location_id = v_transfer.destination_location_id;

      if not found then
        v_qty_before := 0;
      end if;

      -- Upsert inventory_balances (PK is (product_id, location_id))
      insert into public.inventory_balances (product_id, location_id, quantity, updated_at)
      values (v_item.product_id, v_transfer.destination_location_id, v_qty_recv, pg_catalog.now())
      on conflict (product_id, location_id)
      do update set quantity = public.inventory_balances.quantity + v_qty_recv, updated_at = pg_catalog.now();

      -- Insert into inventory_ledger audit log
      if v_user_uuid is not null then
        insert into public.inventory_ledger (
          product_id,
          location_id,
          movement_type,
          quantity_delta,
          quantity_before,
          quantity_after,
          reference_type,
          reference_id,
          performed_by,
          created_at
        ) values (
          v_item.product_id,
          v_transfer.destination_location_id,
          'TRANSFER_IN',
          v_qty_recv,
          v_qty_before,
          v_qty_before + v_qty_recv,
          'stock_transfers',
          p_transfer_id,
          v_user_uuid,
          pg_catalog.now()
        );
      end if;
    end if;
  end loop;

  -- 5. Update stock_transfers status
  update public.stock_transfers
  set status = 'RECEIVED',
      received_at = pg_catalog.now(),
      received_by = v_user_uuid,
      has_discrepancy = v_has_discrepancy
  where id = p_transfer_id;

  v_result := pg_catalog.jsonb_build_object(
    'success', true,
    'transfer_id', p_transfer_id,
    'status', 'RECEIVED',
    'has_discrepancy', v_has_discrepancy
  );

  -- Store Idempotency Key record
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into public.stockist_idempotency_keys (idempotency_key, request_path, transfer_id, request_hash, response_body, status_code)
    values (p_idempotency_key, '/transfers/' || p_transfer_id || '/receive', p_transfer_id, coalesce(p_request_hash, ''), v_result, 200);
  end if;

  return v_result;
end;
$$;

-- 3. Strict RPC Security & Permissions (Revoke Public & Direct Client Access)
revoke all on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) from public;
revoke all on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) from anon, authenticated;
grant execute on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) to service_role;
