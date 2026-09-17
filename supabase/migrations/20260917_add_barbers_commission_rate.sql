-- Task 2.1: Kapster Revenue Sharing Foundation
--
-- Adds a per-barber commission rate. Deliberately nullable with NO default
-- value (not 0.30, not any other number). NULL means "rate not configured
-- yet" and the commission calculator (server/services/commissionCalculator.js)
-- treats that as a hard block (status: MISSING_RATE) rather than silently
-- assuming a rate. Do not backfill this column with a guessed rate — every
-- barber must be explicitly confirmed with the business first.
--
-- 0.30 = 30% (fractional representation, not a whole-number percent).
--
-- This migration is additive-only: it does not touch any existing row's
-- other columns, does not populate commission_rate for any barber, and does
-- not change any read path. It is NOT auto-applied by this task — review
-- and run it deliberately.

BEGIN;

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC;

ALTER TABLE public.barbers
  DROP CONSTRAINT IF EXISTS chk_barbers_commission_rate_range;

ALTER TABLE public.barbers
  ADD CONSTRAINT chk_barbers_commission_rate_range
  CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));

COMMENT ON COLUMN public.barbers.commission_rate IS
  'Fractional commission share (0.30 = 30%) applied to a barber''s commissionable Moka service revenue. NULL = not yet configured; calculation must block (MISSING_RATE), never assume a default. Historical payroll runs must snapshot the rate used at calculation time (commission_rate_used) rather than re-reading this live column for past periods.';

COMMIT;
