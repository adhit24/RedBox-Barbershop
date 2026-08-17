-- server/migrations/2026-08-17-stockist-requests-search-path.sql
-- Pin search_path on the functions added/redefined by the stock-requests
-- migration, matching the fix already applied to other functions in
-- 2026-08-09-fix-search-path-and-permissive-rls.sql (0011_function_search_path_mutable).
-- Safe to re-run (idempotent).

BEGIN;

ALTER FUNCTION public.apply_inventory_movement(UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.reserve_inventory_stock(UUID, UUID, INTEGER) SET search_path = public, pg_temp;
ALTER FUNCTION public.release_inventory_reservation(UUID, UUID, INTEGER) SET search_path = public, pg_temp;
ALTER FUNCTION public.fulfill_reserved_transfer_out(UUID, UUID, INTEGER, UUID, TEXT, UUID) SET search_path = public, pg_temp;

COMMIT;
