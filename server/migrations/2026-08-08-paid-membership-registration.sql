-- Paid membership registration and cashier activation persistence.
-- Safe to run after the existing member_profiles/member_activations migrations.

-- Canonicalise Indonesian phone variants before any membership deduplication.
CREATE OR REPLACE FUNCTION normalize_membership_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH phone_input AS (
    SELECT BTRIM(COALESCE(p_phone, '')) AS raw_value
  ),
  phone_digits AS (
    SELECT raw_value, regexp_replace(raw_value, '[^0-9]', '', 'g') AS digits
    FROM phone_input
  ),
  canonical AS (
    SELECT CASE
      WHEN raw_value = '' OR raw_value !~ '^[+]?[0-9[:space:]()./-]+$' THEN NULL
      WHEN raw_value LIKE '+%' AND digits LIKE '62%' THEN '+' || digits
      WHEN raw_value LIKE '+%' THEN NULL
      WHEN digits LIKE '62%' THEN '+' || digits
      WHEN digits LIKE '0%' THEN '+62' || substring(digits FROM 2)
      WHEN digits LIKE '8%' THEN '+62' || digits
      ELSE NULL
    END AS value
    FROM phone_digits
  )
  SELECT CASE
    WHEN value ~ '^[+]628[1-9][0-9]{7,10}$' THEN value
    ELSE NULL
  END
  FROM canonical;
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

-- Keep one live Pending row per canonical phone+tier. PostgreSQL cannot use
-- NOW() in a partial-index predicate, so the RPC expires stale rows while
-- this index serialises every remaining Pending insert.
UPDATE membership_registrations
SET status = 'EXPIRED', updated_at = NOW()
WHERE status = 'PENDING' AND expires_at <= NOW();

WITH duplicate_pending AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY phone_normalized, tier
    ORDER BY created_at ASC, id ASC
  ) AS duplicate_rank
  FROM membership_registrations
  WHERE status = 'PENDING'
)
UPDATE membership_registrations AS mr
SET status = 'CANCELLED', updated_at = NOW()
FROM duplicate_pending AS duplicate
WHERE mr.id = duplicate.id AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_registrations_pending_phone_tier
  ON membership_registrations (phone_normalized, tier)
  WHERE status = 'PENDING';

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

CREATE OR REPLACE FUNCTION create_membership_registration(
  p_full_name TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_tier TEXT
)
RETURNS TABLE (
  outcome TEXT,
  was_created BOOLEAN,
  registration_id UUID,
  registration_code TEXT,
  tier TEXT,
  amount INTEGER,
  status TEXT,
  expires_at TIMESTAMPTZ,
  active_tier TEXT,
  active_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_phone TEXT := normalize_membership_phone(p_phone);
  v_price INTEGER;
  v_email TEXT;
  v_user_key TEXT;
  v_active_tier TEXT;
  v_active_expires_at TIMESTAMPTZ;
  v_profile member_profiles%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_registration membership_registrations%ROWTYPE;
  v_profile_found BOOLEAN;
  v_customer_found BOOLEAN;
BEGIN
  IF NULLIF(BTRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'fullName required';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'invalid Indonesian mobile phone';
  END IF;

  v_price := CASE p_tier
    WHEN 'silver' THEN 100000
    WHEN 'gold' THEN 250000
    WHEN 'platinum' THEN 1500000
  END;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'invalid tier';
  END IF;

  -- Serialise all registrations for one canonical identity. This protects
  -- customer/profile creation even when concurrent requests select different tiers.
  PERFORM pg_advisory_xact_lock(hashtextextended('membership-registration:' || v_phone, 0));

  SELECT mp.current_tier, mp.membership_expires_at
  INTO v_active_tier, v_active_expires_at
  FROM member_profiles AS mp
  WHERE normalize_membership_phone(mp.phone) = v_phone
    AND mp.membership_status = 'ACTIVE'
    AND (
      mp.membership_expires_at > v_now
      OR (mp.membership_started_at IS NULL AND mp.membership_expires_at IS NULL)
    )
  ORDER BY mp.created_at ASC NULLS LAST, mp.id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      'ACTIVE_MEMBERSHIP'::TEXT, FALSE, NULL::UUID, NULL::TEXT,
      p_tier, v_price, NULL::TEXT, NULL::TIMESTAMPTZ,
      v_active_tier, v_active_expires_at;
    RETURN;
  END IF;

  v_active_tier := NULL;
  SELECT c.membership_expires_at
  INTO v_active_expires_at
  FROM customers AS c
  WHERE (
      normalize_membership_phone(c.phone_e164) = v_phone
      OR normalize_membership_phone(c.wa) = v_phone
    )
    AND c.membership_status = 'ACTIVE'
    AND (
      c.membership_expires_at > v_now
      OR (c.membership_started_at IS NULL AND c.membership_expires_at IS NULL)
    )
  ORDER BY c.created_at ASC NULLS LAST, c.id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      'ACTIVE_MEMBERSHIP'::TEXT, FALSE, NULL::UUID, NULL::TEXT,
      p_tier, v_price, NULL::TEXT, NULL::TIMESTAMPTZ,
      v_active_tier, v_active_expires_at;
    RETURN;
  END IF;

  UPDATE membership_registrations AS mr
  SET status = 'EXPIRED', updated_at = v_now
  WHERE mr.phone_normalized = v_phone
    AND mr.tier = p_tier
    AND mr.status = 'PENDING'
    AND mr.expires_at <= v_now;

  SELECT mr.* INTO v_registration
  FROM membership_registrations AS mr
  WHERE mr.phone_normalized = v_phone
    AND mr.tier = p_tier
    AND mr.status = 'PENDING'
    AND mr.expires_at > v_now
  ORDER BY mr.created_at ASC, mr.id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      'EXISTING_PENDING'::TEXT, FALSE, v_registration.id,
      v_registration.registration_code, v_registration.tier,
      v_registration.price_snapshot, v_registration.status,
      v_registration.expires_at, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT mp.* INTO v_profile
  FROM member_profiles AS mp
  WHERE normalize_membership_phone(mp.phone) = v_phone
  ORDER BY mp.created_at ASC NULLS LAST, mp.id ASC
  LIMIT 1
  FOR UPDATE;
  v_profile_found := FOUND;

  SELECT c.* INTO v_customer
  FROM customers AS c
  WHERE (
      normalize_membership_phone(c.phone_e164) = v_phone
      OR normalize_membership_phone(c.wa) = v_phone
    )
  ORDER BY c.created_at ASC NULLS LAST, c.id ASC
  LIMIT 1
  FOR UPDATE;
  v_customer_found := FOUND;

  v_email := COALESCE(
    NULLIF(BTRIM(p_email), ''),
    NULLIF(BTRIM(v_profile.email), ''),
    NULLIF(BTRIM(v_customer.email), ''),
    'member_' || substring(v_phone FROM 4) || '@redbox.internal'
  );

  IF v_profile_found THEN
    v_user_key := v_profile.user_key;
  ELSE
    v_user_key := 'member_' || substring(v_phone FROM 2);
    INSERT INTO member_profiles (
      user_key, full_name, email, phone, membership_status,
      membership_activated_at, membership_started_at, membership_expires_at,
      current_tier
    ) VALUES (
      v_user_key, BTRIM(p_full_name), v_email, v_phone, 'INACTIVE',
      NULL, NULL, NULL, NULL
    ) RETURNING * INTO v_profile;
  END IF;

  IF NOT v_customer_found THEN
    INSERT INTO customers (
      wa, phone_e164, name, email, membership_status,
      membership_activated_at, membership_started_at, membership_expires_at
    ) VALUES (
      substring(v_phone FROM 2), v_phone, BTRIM(p_full_name), v_email, 'INACTIVE',
      NULL, NULL, NULL
    ) RETURNING * INTO v_customer;
  END IF;

  INSERT INTO membership_registrations (
    registration_code, user_key, full_name, phone, phone_normalized,
    email, tier, price_snapshot, status, expires_at, created_at, updated_at
  ) VALUES (
    'RBM-' || UPPER(substring(replace(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 12)),
    v_user_key, BTRIM(p_full_name), v_phone, v_phone,
    v_email, p_tier, v_price, 'PENDING', v_now + INTERVAL '7 days', v_now, v_now
  ) RETURNING * INTO v_registration;

  RETURN QUERY SELECT
    'CREATED'::TEXT, TRUE, v_registration.id,
    v_registration.registration_code, v_registration.tier,
    v_registration.price_snapshot, v_registration.status,
    v_registration.expires_at, NULL::TEXT, NULL::TIMESTAMPTZ;
END;
$$;

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
  WHERE (
      normalize_membership_phone(phone_e164) = r.phone_normalized
      OR normalize_membership_phone(wa) = r.phone_normalized
    )
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
  WHERE (
      normalize_membership_phone(phone_e164) = r.phone_normalized
      OR normalize_membership_phone(wa) = r.phone_normalized
    );
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
