-- Task 2.2: Barber Commission Rate History Schema
-- Additive migration: tracks historical and active commission rates per barber.
-- Current barbers.commission_rate remains a convenience current-cache,
-- while historical calculations resolve against barber_commission_rates by transaction date.

BEGIN;

CREATE TABLE IF NOT EXISTS public.barber_commission_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id TEXT NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    rate NUMERIC NOT NULL CHECK (rate >= 0 AND rate <= 1),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_bcr_lookup ON public.barber_commission_rates (barber_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_bcr_barber ON public.barber_commission_rates (barber_id);
CREATE INDEX IF NOT EXISTS idx_bcr_effective_from ON public.barber_commission_rates (effective_from);

-- Enable RLS and lock down to service_role only (Redbox backend-only security pattern)
ALTER TABLE public.barber_commission_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.barber_commission_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.barber_commission_rates TO service_role;

COMMIT;
