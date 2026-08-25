-- server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql

-- Table schema enhancements for discrepancy recording.
alter table public.stock_transfer_items
  add column if not exists discrepancy_reason text null,
  add column if not exists discrepancy_photo_url text null;

alter table public.stock_transfers
  add column if not exists has_discrepancy boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_transfer_items_quantity_received_check'
      and conrelid = 'public.stock_transfer_items'::regclass
  ) then
    alter table public.stock_transfer_items
      add constraint stock_transfer_items_quantity_received_check
      check (quantity_received is null or quantity_received >= 0);
  end if;
end $$;

-- Private evidence bucket. Supabase manages RLS and ownership for storage.objects;
-- this application migration must not alter that internal table.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stockist-evidence',
  'stockist-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Evidence access is backend-only through service-role operations and signed URLs.
drop policy if exists "Allow authenticated read stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated upload stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated update stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated delete stockist evidence" on storage.objects;
