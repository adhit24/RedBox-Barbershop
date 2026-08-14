-- Performance indexes for paid-membership activation.
--
-- activate_membership_registration() resolves the canonical customer row via
-- normalize_membership_phone(phone_e164) / normalize_membership_phone(wa).
-- Without matching expression indexes, this lookup scans the entire customers
-- table and can exceed the production statement timeout under load.

CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized_membership
  ON public.customers USING btree (public.normalize_membership_phone(phone_e164));

CREATE INDEX IF NOT EXISTS idx_customers_wa_normalized_membership
  ON public.customers USING btree (public.normalize_membership_phone(wa));
