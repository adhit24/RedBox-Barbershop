-- Member profile photo upload (paid tiers only: silver/gold/platinum).
-- Applied directly via Supabase MCP on 2026-08-18; kept here for history.

alter table public.customers
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
