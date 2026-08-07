-- Paid membership registration and cashier activation persistence.
-- Safe to run after the existing member_profiles/member_activations migrations.

-- Canonicalise Indonesian phone variants before any membership deduplication.
CREATE OR REPLACE FUNCTION normalize_membership_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH phone_digits AS (
    SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS value
  )
  SELECT CASE
    WHEN value = '' THEN NULL
    WHEN value LIKE '62%' THEN '+' || value
    WHEN value LIKE '0%' THEN '+62' || substring(value FROM 2)
    ELSE '+62' || value
  END
  FROM phone_digits;
$$;

CREATE TABLE IF NOT EXISTS membership_registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_code TEXT NOT NULL UNIQUE,
  user_key          TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  phone_normalized  TEXT NOT NULL CHECK (phone_normalized = normalize_membership_phone(phone)),
  email             TEXT,
  tier              TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'platinum')),
  price_snapshot    INTEGER NOT NULL CHECK (price_snapshot IN (100000, 250000, 1500000)),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACTIVATED', 'EXPIRED', 'CANCELLED')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE membership_registrations
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

UPDATE membership_registrations
SET phone_normalized = normalize_membership_phone(phone)
WHERE phone_normalized IS NULL;

ALTER TABLE membership_registrations
  ALTER COLUMN phone_normalized SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'membership_registrations_phone_normalized_check'
      AND conrelid = 'membership_registrations'::regclass
  ) THEN
    ALTER TABLE membership_registrations
      ADD CONSTRAINT membership_registrations_phone_normalized_check
      CHECK (phone_normalized = normalize_membership_phone(phone)) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_membership_registrations_status
  ON membership_registrations (status);
CREATE INDEX IF NOT EXISTS idx_membership_registrations_phone
  ON membership_registrations (phone);
CREATE INDEX IF NOT EXISTS idx_membership_registrations_expires_at
  ON membership_registrations (expires_at);
DROP INDEX IF EXISTS uq_membership_registrations_active_phone;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_registrations_active_phone_normalized
  ON membership_registrations (phone_normalized)
  WHERE status = 'ACTIVATED';

ALTER TABLE member_activations
  ADD COLUMN IF NOT EXISTS registration_id UUID,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Historical rows are retained; NOT VALID still enforces the allowlist for all new writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_activations_payment_method_check'
      AND conrelid = 'member_activations'::regclass
  ) THEN
    ALTER TABLE member_activations
      ADD CONSTRAINT member_activations_payment_method_check
      CHECK (payment_method IS NOT NULL AND payment_method IN ('cash', 'qris', 'transfer')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS membership_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMPTZ;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS membership_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMPTZ;

DROP INDEX IF EXISTS uq_member_profiles_active_phone;
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_profiles_active_phone_normalized
  ON member_profiles (normalize_membership_phone(phone))
  WHERE membership_status = 'ACTIVE';

CREATE OR REPLACE FUNCTION activate_membership_registration(
  p_registration_id UUID,
  p_payment_method TEXT,
  p_payment_reference TEXT,
  p_branch TEXT,
  p_confirmed_by TEXT
)
RETURNS TABLE (
  registration_id UUID,
  activation_id UUID,
  tier TEXT,
  amount INTEGER,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  r membership_registrations%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_activation_id UUID;
  v_starts_at TIMESTAMPTZ := v_now;
  v_expires_at TIMESTAMPTZ := v_now + INTERVAL '1 year';
  v_expected_price INTEGER;
  v_profile_rows INTEGER;
  v_customer_rows INTEGER;
BEGIN
  SELECT * INTO r
  FROM membership_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND OR r.status <> 'PENDING' THEN
    RAISE EXCEPTION 'membership registration is not pending';
  END IF;
  IF r.expires_at <= v_now THEN
    RAISE EXCEPTION 'membership registration has expired';
  END IF;

  v_expected_price := CASE r.tier
    WHEN 'silver' THEN 100000
    WHEN 'gold' THEN 250000
    WHEN 'platinum' THEN 1500000
  END;
  IF r.price_snapshot <> v_expected_price THEN
    RAISE EXCEPTION 'membership registration price snapshot is invalid';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'qris', 'transfer') THEN
    RAISE EXCEPTION 'invalid payment method';
  END IF;
  IF NULLIF(BTRIM(p_payment_reference), '') IS NULL THEN
    RAISE EXCEPTION 'payment reference is required';
  END IF;
  IF NULLIF(BTRIM(p_branch), '') IS NULL OR NULLIF(BTRIM(p_confirmed_by), '') IS NULL THEN
    RAISE EXCEPTION 'branch and confirmed_by are required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM member_profiles
    WHERE normalize_membership_phone(phone) = r.phone_normalized
      AND membership_status = 'ACTIVE'
      AND (
        membership_expires_at > v_now
        OR (membership_started_at IS NULL AND membership_expires_at IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'active membership already exists';
  END IF;

  -- The activation audit and registration status must never advance without both targets.
  PERFORM 1 FROM member_profiles
  WHERE user_key = r.user_key
    AND normalize_membership_phone(phone) = r.phone_normalized
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member profile target is missing';
  END IF;

  PERFORM 1 FROM customers
  WHERE normalize_membership_phone(phone_e164) = r.phone_normalized
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer target is missing';
  END IF;

  -- An old completed registration ceases to be active when its profile period expired.
  -- This releases the canonical-phone uniqueness guard for a renewal while keeping its audit row.
  UPDATE membership_registrations
  SET status = 'EXPIRED', updated_at = v_now
  WHERE phone_normalized = r.phone_normalized
    AND status = 'ACTIVATED';

  INSERT INTO member_activations (
    user_key, amount, tier, payment_method, payment_reference, branch,
    status, confirmed_by, registration_id, starts_at, expires_at, activated_at
  ) VALUES (
    r.user_key, r.price_snapshot, r.tier, p_payment_method, BTRIM(p_payment_reference),
    BTRIM(p_branch), 'completed', BTRIM(p_confirmed_by), r.id,
    v_starts_at, v_expires_at, v_now
  ) RETURNING id INTO v_activation_id;

  UPDATE member_profiles
  SET membership_status = 'ACTIVE',
      membership_activated_at = v_now,
      membership_started_at = v_starts_at,
      membership_expires_at = v_expires_at,
      current_tier = r.tier,
      updated_at = v_now
  WHERE user_key = r.user_key;
  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;
  IF v_profile_rows = 0 THEN
    RAISE EXCEPTION 'member profile target was not updated';
  END IF;

  UPDATE customers
  SET membership_status = 'ACTIVE',
      membership_activated_at = v_now,
      membership_started_at = v_starts_at,
      membership_expires_at = v_expires_at,
      updated_at = v_now
  WHERE normalize_membership_phone(phone_e164) = r.phone_normalized;
  GET DIAGNOSTICS v_customer_rows = ROW_COUNT;
  IF v_customer_rows = 0 THEN
    RAISE EXCEPTION 'customer target was not updated';
  END IF;

  UPDATE membership_registrations
  SET status = 'ACTIVATED', updated_at = v_now
  WHERE id = r.id;

  RETURN QUERY SELECT r.id, v_activation_id, r.tier, r.price_snapshot, v_starts_at, v_expires_at;
END;
$$;
