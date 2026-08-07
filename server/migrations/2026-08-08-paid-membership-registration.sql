-- Paid membership registration and cashier activation persistence.
-- Safe to run after the existing member_profiles/member_activations migrations.

CREATE TABLE IF NOT EXISTS membership_registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_code TEXT NOT NULL UNIQUE,
  user_key          TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT,
  tier              TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'platinum')),
  price_snapshot    INTEGER NOT NULL CHECK (price_snapshot IN (100000, 250000, 1500000)),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACTIVATED', 'EXPIRED', 'CANCELLED')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_registrations_status
  ON membership_registrations (status);
CREATE INDEX IF NOT EXISTS idx_membership_registrations_phone
  ON membership_registrations (phone);
CREATE INDEX IF NOT EXISTS idx_membership_registrations_expires_at
  ON membership_registrations (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_registrations_active_phone
  ON membership_registrations (phone)
  WHERE status = 'ACTIVATED';

ALTER TABLE member_activations
  ADD COLUMN IF NOT EXISTS registration_id UUID,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS membership_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_profiles_active_phone
  ON member_profiles (phone)
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
BEGIN
  SELECT * INTO r
  FROM membership_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND OR r.status <> 'PENDING' THEN
    RAISE EXCEPTION 'membership registration is not pending';
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
    WHERE phone = r.phone
      AND membership_status = 'ACTIVE'
      AND (membership_expires_at IS NULL OR membership_expires_at > v_now)
  ) THEN
    RAISE EXCEPTION 'active membership already exists';
  END IF;

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

  UPDATE customers
  SET membership_status = 'ACTIVE',
      membership_activated_at = v_now,
      updated_at = v_now
  WHERE phone_e164 = r.phone;

  UPDATE membership_registrations
  SET status = 'ACTIVATED', updated_at = v_now
  WHERE id = r.id;

  RETURN QUERY SELECT r.id, v_activation_id, r.tier, r.price_snapshot, v_starts_at, v_expires_at;
END;
$$;
