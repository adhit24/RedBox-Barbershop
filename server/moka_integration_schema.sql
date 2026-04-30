-- ============================================================
-- REDBOX × MOKA POS  —  Integration Schema Migration
-- Run AFTER existing schema.sql in Supabase SQL Editor
-- Safe to re-run (all statements are idempotent)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- required for exclusion constraint

-- ============================================================
-- TABLE: outlets
-- One row per physical branch. Replaces the free-text `branch`
-- field in barbers. moka_outlet_id links to Moka's outlet.
-- ============================================================
CREATE TABLE IF NOT EXISTS outlets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  slug           TEXT UNIQUE NOT NULL,          -- 'bypass', 'samadikun', etc.
  moka_outlet_id TEXT UNIQUE,                   -- Moka's outlet identifier
  address        TEXT,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO outlets (name, slug, timezone) VALUES
  ('RedBox Bypass',    'bypass',    'Asia/Jakarta'),
  ('RedBox Samadikun', 'samadikun', 'Asia/Jakarta'),
  ('RedBox CSB Mall',  'csb',       'Asia/Jakarta'),
  ('RedBox Sumber',    'sumber',    'Asia/Jakarta'),
  ('RedBox Tegal',     'tegal',     'Asia/Jakarta')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- TABLE: services
-- Canonical service catalog. moka_item_id maps to Moka product.
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  slug             TEXT UNIQUE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price            INTEGER NOT NULL DEFAULT 0,
  moka_item_id     TEXT UNIQUE,        -- Moka item / product ID
  moka_category_id TEXT,               -- Moka category ID
  moka_category_name TEXT,             -- Optional Moka category label
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO services (name, slug, duration_minutes, price) VALUES
  ('Haircut',         'haircut',        30,   35000),
  ('Haircut + Shave', 'haircut-shave',  45,   55000),
  ('Shave Only',      'shave',          20,   25000),
  ('Coloring',        'coloring',       90,  150000),
  ('Highlights',      'highlights',    120,  200000)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- ALTER: barbers — add outlet FK + Moka employee link
-- ============================================================
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS outlet_id         UUID REFERENCES outlets(id);
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS moka_employee_id  TEXT;

-- Backfill outlet_id from existing `branch` text column
UPDATE barbers b
SET    outlet_id = o.id
FROM   outlets o
WHERE  o.slug = b.branch
  AND  b.outlet_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_barbers_outlet ON barbers (outlet_id);

-- ============================================================
-- ALTER: customers — add Moka / email fields
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_e164       TEXT;           -- normalized +62xxx
ALTER TABLE customers ADD COLUMN IF NOT EXISTS source           TEXT DEFAULT 'web'
  CHECK (source IN ('web', 'moka'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS moka_customer_id TEXT UNIQUE;

-- Backfill phone_e164 from wa column
UPDATE customers
SET phone_e164 = CASE
  WHEN wa ~ '^62' THEN '+' || wa
  WHEN wa ~ '^0'  THEN '+62' || SUBSTRING(wa FROM 2)
  ELSE '+62' || wa
END
WHERE phone_e164 IS NULL AND wa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_email       ON customers (email)         WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_e164  ON customers (phone_e164)    WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_moka        ON customers (moka_customer_id) WHERE moka_customer_id IS NOT NULL;

ALTER TABLE services ADD COLUMN IF NOT EXISTS moka_category_id   TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS moka_category_name TEXT;

-- ============================================================
-- TABLE: schedules   ★ SOURCE OF TRUTH ★
-- Every appointment — online OR walk-in — lives here.
-- external_id = Moka order_id for bidirectional tracing.
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id    UUID NOT NULL REFERENCES outlets(id),
  barber_id    TEXT REFERENCES barbers(id),
  customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
  service_id   UUID REFERENCES services(id),
  service_name TEXT,                         -- snapshot at booking time
  price        INTEGER NOT NULL DEFAULT 0,   -- snapshot at booking time
  start_time   TIMESTAMPTZ NOT NULL,
  end_time     TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'reserved'
               CHECK (status IN ('reserved','confirmed','in_progress','completed','cancelled')),
  source       TEXT NOT NULL DEFAULT 'web'
               CHECK (source IN ('web','moka')),
  external_id  TEXT UNIQUE,                  -- Moka order_id (idempotency key)
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT   chk_schedule_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_schedules_barber    ON schedules (barber_id);
CREATE INDEX IF NOT EXISTS idx_schedules_outlet    ON schedules (outlet_id);
CREATE INDEX IF NOT EXISTS idx_schedules_time      ON schedules (start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_schedules_status    ON schedules (status);
CREATE INDEX IF NOT EXISTS idx_schedules_external  ON schedules (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedules_customer  ON schedules (customer_id) WHERE customer_id IS NOT NULL;

-- Overlap exclusion: one barber can NOT have two non-cancelled schedules
-- whose time ranges intersect. The GIST index enforces this at DB level.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'no_barber_overlap' AND conrelid = 'schedules'::regclass
  ) THEN
    ALTER TABLE schedules ADD CONSTRAINT no_barber_overlap
      EXCLUDE USING GIST (
        barber_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
      )
      WHERE (status NOT IN ('cancelled'));
  END IF;
END $$;

-- ============================================================
-- TABLE: transactions
-- One row per paid order. external_id is the Moka order_id.
-- This is the idempotency anchor — never insert twice for same order.
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
  outlet_id    UUID REFERENCES outlets(id),
  schedule_id  UUID REFERENCES schedules(id) ON DELETE SET NULL,
  total_amount INTEGER NOT NULL DEFAULT 0,
  external_id  TEXT NOT NULL UNIQUE,          -- Moka order_id (IDEMPOTENCY KEY)
  source       TEXT NOT NULL DEFAULT 'web'
               CHECK (source IN ('web','moka')),
  status       TEXT NOT NULL DEFAULT 'completed'
               CHECK (status IN ('pending','completed','refunded','cancelled')),
  moka_payload JSONB,                         -- full Moka order snapshot
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_external  ON transactions (external_id);
CREATE INDEX IF NOT EXISTS idx_transactions_outlet    ON transactions (outlet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer  ON transactions (customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created   ON transactions (created_at DESC);

-- ============================================================
-- TABLE: transaction_items
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  service_name   TEXT NOT NULL,
  price          INTEGER NOT NULL DEFAULT 0,
  quantity       INTEGER NOT NULL DEFAULT 1,
  moka_item_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_txn_items_txn ON transaction_items (transaction_id);

-- ============================================================
-- TABLE: moka_tokens
-- OAuth 2.0 token store — one row per outlet.
-- auto-refresh happens in oauth.js before expiry.
-- ============================================================
CREATE TABLE IF NOT EXISTS moka_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outlet_id     UUID NOT NULL REFERENCES outlets(id) UNIQUE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  expires_at    TIMESTAMPTZ NOT NULL,
  scope         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: sync_logs
-- Audit trail for every bidirectional sync attempt.
-- Enables retry and post-mortem debugging.
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  direction     TEXT NOT NULL
                CHECK (direction IN ('web_to_moka','moka_to_web')),
  entity_type   TEXT,        -- 'order', 'schedule', 'customer'
  entity_id     TEXT,        -- UUID or Moka ID
  payload       JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','success','failed','skipped')),
  error_message TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_status    ON sync_logs (status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_direction ON sync_logs (direction);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created   ON sync_logs (created_at DESC);

-- ============================================================
-- TABLE: barber_working_hours
-- Used by the slot engine to generate available booking windows.
-- day_of_week: 0=Sunday … 6=Saturday
-- ============================================================
CREATE TABLE IF NOT EXISTS barber_working_hours (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barber_id   TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   TIME NOT NULL DEFAULT '09:00',
  close_time  TIME NOT NULL DEFAULT '21:00',
  is_off      BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (barber_id, day_of_week)
);

-- ============================================================
-- TRIGGERS: keep updated_at fresh
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outlets_updated      ON outlets;
DROP TRIGGER IF EXISTS trg_schedules_updated    ON schedules;
DROP TRIGGER IF EXISTS trg_moka_tokens_updated  ON moka_tokens;

CREATE TRIGGER trg_outlets_updated
  BEFORE UPDATE ON outlets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schedules_updated
  BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_moka_tokens_updated
  BEFORE UPDATE ON moka_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: check_barber_overlap
-- Application-layer overlap check before inserting a schedule.
-- Returns TRUE if there IS a conflict (slot is taken).
-- ============================================================
CREATE OR REPLACE FUNCTION check_barber_overlap(
  p_barber_id  TEXT,
  p_start      TIMESTAMPTZ,
  p_end        TIMESTAMPTZ,
  p_exclude_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM schedules
    WHERE  barber_id  = p_barber_id
      AND  status    NOT IN ('cancelled')
      AND  start_time < p_end
      AND  end_time   > p_start
      AND  (p_exclude_id IS NULL OR id <> p_exclude_id)
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- FUNCTION: find_available_barber
-- Returns first available barber_id in an outlet for a window.
-- Used by sync.js when Moka walk-in has no barber assigned.
-- ============================================================
CREATE OR REPLACE FUNCTION find_available_barber(
  p_outlet_id UUID,
  p_start     TIMESTAMPTZ,
  p_end       TIMESTAMPTZ
)
RETURNS TEXT AS $$
DECLARE
  v_barber_id TEXT;
BEGIN
  SELECT b.id INTO v_barber_id
  FROM   barbers b
  WHERE  b.outlet_id = p_outlet_id
    AND  b.is_active  = TRUE
    AND  NOT EXISTS (
      SELECT 1 FROM schedules s
      WHERE  s.barber_id   = b.id
        AND  s.status     NOT IN ('cancelled')
        AND  s.start_time  < p_end
        AND  s.end_time    > p_start
    )
  ORDER BY b.id
  LIMIT 1;

  RETURN v_barber_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- VIEW: schedules_full  (denormalized read model)
-- ============================================================
CREATE OR REPLACE VIEW schedules_full AS
  SELECT
    s.*,
    b.name            AS barber_name,
    b.role            AS barber_role,
    c.name            AS customer_name,
    COALESCE(c.phone_e164, c.wa) AS customer_phone,
    c.email           AS customer_email,
    o.name            AS outlet_name,
    o.moka_outlet_id  AS outlet_moka_id,
    svc.moka_item_id,
    svc.moka_category_id,
    svc.moka_category_name
  FROM  schedules s
  LEFT JOIN barbers   b ON s.barber_id   = b.id
  LEFT JOIN customers c ON s.customer_id = c.id
  LEFT JOIN outlets   o ON s.outlet_id   = o.id
  LEFT JOIN services svc ON s.service_id = svc.id;
