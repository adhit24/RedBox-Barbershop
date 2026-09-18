-- Task 2.3: Concurrency Hardening for barber_commission_rates
-- Replace trigger-based overlap check with PostgreSQL exclusion constraint using btree_gist.
-- Guarantees deterministic rejection of overlapping commission rate periods even under concurrent Owner requests.

BEGIN;

-- 1. Remove old trigger if present
DROP TRIGGER IF EXISTS trg_bcr_overlap_check ON public.barber_commission_rates;
DROP FUNCTION IF EXISTS public.check_barber_commission_rate_overlap();

-- 2. Ensure btree_gist extension exists
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 3. Add exclusion constraint preventing overlapping date ranges for the same barber
ALTER TABLE public.barber_commission_rates
DROP CONSTRAINT IF EXISTS uq_barber_commission_rate_no_overlap;

ALTER TABLE public.barber_commission_rates
ADD CONSTRAINT uq_barber_commission_rate_no_overlap
EXCLUDE USING gist (
    barber_id WITH =,
    daterange(
        effective_from,
        COALESCE(effective_to, 'infinity'::date),
        '[]'
    ) WITH &&
);

COMMIT;
