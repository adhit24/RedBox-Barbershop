-- Task 2.3: Concurrency Hardening for barber_commission_rates
-- Database-level check trigger to prevent concurrent or accidental overlapping rate periods.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_barber_commission_rate_overlap()
RETURNS TRIGGER AS $$
DECLARE
    v_overlap_count INTEGER;
    v_new_end DATE;
BEGIN
    v_new_end := COALESCE(NEW.effective_to, '9999-12-31'::DATE);

    SELECT COUNT(*) INTO v_overlap_count
    FROM public.barber_commission_rates
    WHERE barber_id = NEW.barber_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
      AND effective_from <= v_new_end
      AND COALESCE(effective_to, '9999-12-31'::DATE) >= NEW.effective_from;

    IF v_overlap_count > 0 THEN
        RAISE EXCEPTION 'Overlapping commission rate period detected for barber % (interval % to %)',
            NEW.barber_id, NEW.effective_from, COALESCE(NEW.effective_to::TEXT, 'infinity');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bcr_overlap_check ON public.barber_commission_rates;
CREATE TRIGGER trg_bcr_overlap_check
BEFORE INSERT OR UPDATE ON public.barber_commission_rates
FOR EACH ROW EXECUTE FUNCTION public.check_barber_commission_rate_overlap();

COMMIT;
