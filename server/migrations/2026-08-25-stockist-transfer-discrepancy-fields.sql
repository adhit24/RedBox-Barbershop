-- server/migrations/2026-08-25-stockist-transfer-discrepancy-fields.sql
alter table stock_transfer_items
  add column if not exists discrepancy_reason text null,
  add column if not exists discrepancy_photo_url text null;

insert into storage.buckets (id, name, public)
values ('stockist-evidence', 'stockist-evidence', true)
on conflict (id) do nothing;
