-- server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql

-- 1. Table schema enhancements for discrepancy recording
alter table stock_transfer_items
  add column if not exists discrepancy_reason text null,
  add column if not exists discrepancy_photo_url text null;

-- Add check constraint for non-negative quantity_received if not present
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_transfer_items_quantity_received_check'
  ) then
    alter table stock_transfer_items
      add constraint stock_transfer_items_quantity_received_check
      check (quantity_received is null or quantity_received >= 0);
  end if;
end $$;

-- 2. Storage bucket definition (Private bucket for discrepancy evidence)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stockist-evidence',
  'stockist-evidence',
  false, -- Private bucket: no direct public access, all uploads/reads routed through secure backend
  5242880, -- 5MB file size limit
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. Storage RLS Policies for stockist-evidence bucket
-- Enable RLS on storage.objects if not enabled
alter table storage.objects enable row level security;

-- Remove broad direct access policies if present
drop policy if exists "Allow authenticated read stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated upload stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated update stockist evidence" on storage.objects;
drop policy if exists "Allow authenticated delete stockist evidence" on storage.objects;
