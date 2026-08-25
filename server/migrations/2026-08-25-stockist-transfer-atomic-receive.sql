-- server/migrations/2026-08-25-stockist-transfer-atomic-receive.sql

-- Server-only idempotency records for atomic transfer receipt confirmation.
create table if not exists public.stockist_idempotency_keys (
  idempotency_key text primary key,
  request_path text not null,
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  request_hash text not null,
  status_code integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stockist_idempotency_keys_transfer_id_fkey'
      and conrelid = 'public.stockist_idempotency_keys'::regclass
  ) then
    alter table public.stockist_idempotency_keys
      add constraint stockist_idempotency_keys_transfer_id_fkey
      foreign key (transfer_id)
      references public.stock_transfers(id)
      on delete cascade;
  end if;
end $$;

alter table public.stockist_idempotency_keys enable row level security;
revoke all on public.stockist_idempotency_keys from public;
revoke all on public.stockist_idempotency_keys from anon, authenticated;
grant all on public.stockist_idempotency_keys to service_role;

create index if not exists idx_stockist_idempotency_keys_created_at
  on public.stockist_idempotency_keys (created_at);

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
  v_qty_before integer;
  v_qty_after integer;
  v_user_uuid uuid;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: idempotency key is required';
  end if;

  if p_request_hash is null or pg_catalog.btrim(p_request_hash) = '' then
    raise exception 'REQUEST_HASH_REQUIRED: request hash is required';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS: items must be a JSON array';
  end if;

  begin
    v_user_uuid := p_received_by::uuid;
  exception when others then
    raise exception 'INVALID_RECEIVED_BY: received_by must be a valid user UUID';
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_idempotency_key, 0)
  );

  select transfer_id, request_hash, response_body, status_code
    into v_existing_idempotency
  from public.stockist_idempotency_keys
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing_idempotency.transfer_id = p_transfer_id
       and v_existing_idempotency.request_hash = p_request_hash then
      return v_existing_idempotency.response_body;
    end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED: idempotency key reused with different request payload or transfer id';
  end if;

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

  select pg_catalog.count(*) into v_sent_count
  from public.stock_transfer_items
  where stock_transfer_id = p_transfer_id;

  v_received_count := pg_catalog.jsonb_array_length(p_items);

  if v_received_count <> v_sent_count then
    raise exception 'INCOMPLETE_ITEM_SET: all transfer items must be included in the receive request';
  end if;

  perform 1
  from public.stock_transfer_items
  where stock_transfer_id = p_transfer_id
  for update;

  for v_elem in select * from pg_catalog.jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := coalesce(v_elem->>'item_id', v_elem->>'id')::uuid;
    exception when others then
      raise exception 'INVALID_ITEM: item id must be a valid UUID';
    end;

    begin
      v_qty_recv := (v_elem->>'quantity_received')::integer;
    exception when others then
      raise exception 'INVALID_QUANTITY: quantity_received must be an integer for item %', v_item_id;
    end;

    v_reason := pg_catalog.btrim(
      coalesce(v_elem->>'discrepancy_reason', v_elem->>'reason', '')
    );
    v_photo_url := coalesce(
      v_elem->>'discrepancy_photo_url',
      v_elem->>'photo_url'
    );

    if v_item_id is null then
      raise exception 'INVALID_ITEM: item id is required';
    end if;

    if v_item_id::text = any(v_seen_item_ids) then
      raise exception 'DUPLICATE_ITEM_SUBMITTED: item % submitted multiple times', v_item_id;
    end if;
    v_seen_item_ids := pg_catalog.array_append(v_seen_item_ids, v_item_id::text);

    select * into v_item
    from public.stock_transfer_items
    where id = v_item_id
      and stock_transfer_id = p_transfer_id;

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

    update public.stock_transfer_items
    set quantity_received = v_qty_recv,
        discrepancy_reason = nullif(v_reason, ''),
        discrepancy_photo_url = v_photo_url
    where id = v_item_id;

    if v_qty_recv > 0 then
      insert into public.inventory_balances (
        product_id,
        location_id,
        quantity,
        updated_at
      )
      values (
        v_item.product_id,
        v_transfer.destination_location_id,
        v_qty_recv,
        pg_catalog.now()
      )
      on conflict (product_id, location_id)
      do update set
        quantity = public.inventory_balances.quantity + excluded.quantity,
        updated_at = pg_catalog.now()
      returning quantity into v_qty_after;

      v_qty_before := v_qty_after - v_qty_recv;

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
        v_qty_after,
        'stock_transfers',
        p_transfer_id,
        v_user_uuid,
        pg_catalog.now()
      );
    end if;
  end loop;

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

  insert into public.stockist_idempotency_keys (
    idempotency_key,
    request_path,
    transfer_id,
    request_hash,
    response_body,
    status_code
  ) values (
    p_idempotency_key,
    '/transfers/' || p_transfer_id || '/receive',
    p_transfer_id,
    p_request_hash,
    v_result,
    200
  );

  return v_result;
end;
$$;

revoke all on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) from public;
revoke all on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) from anon, authenticated;
grant execute on function public.confirm_stock_transfer_receive(uuid, jsonb, text, text, text) to service_role;
