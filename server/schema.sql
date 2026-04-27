-- ================================================
-- REDBOX BARBERSHOP — PostgreSQL Schema (Supabase)
-- Run this in Supabase SQL Editor
-- ================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================
-- TABLE: barbers
-- ================================================
CREATE TABLE IF NOT EXISTS barbers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT,
  img        TEXT,
  work_days  TEXT[],  -- e.g. ARRAY['Mon','Tue','Wed']
  branch     TEXT,    -- bypass, samadikun, csb, sumber, tegal
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed barbers (27 people)
INSERT INTO barbers (id, name, role, img, work_days, branch) VALUES
  -- Bypass (6 Orang)
  ('bypass1', 'Alex Chillboy UA', 'Senior Master Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], 'bypass'),
  ('bypass2', 'Adrián AR', 'Senior Master Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat','Sun'], 'bypass'),
  ('bypass3', 'B Richards BR', 'Fade Specialist', 'Brand_assets/Kapster3.jpg', ARRAY['Mon','Wed','Thu','Fri','Sat'], 'bypass'),
  ('bypass4', 'Iwan', 'Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Mon','Tue','Thu','Fri','Sat','Sun'], 'bypass'),
  ('bypass5', 'Heri', 'Junior Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri'], 'bypass'),
  ('bypass6', 'Ujang', 'Junior Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat'], 'bypass'),
  
  -- Samadikun (5 Orang)
  ('samadikun1', 'Andi', 'Senior Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], 'samadikun'),
  ('samadikun2', 'Rian', 'Senior Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat','Sun'], 'samadikun'),
  ('samadikun3', 'Eko', 'Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Mon','Wed','Thu','Fri','Sat'], 'samadikun'),
  ('samadikun4', 'Toto', 'Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Mon','Tue','Thu','Fri','Sat','Sun'], 'samadikun'),
  ('samadikun5', 'Gani', 'Junior Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri'], 'samadikun'),
  
  -- CSB Mall (6 Orang)
  ('csb1', 'Rizky', 'Senior Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], 'csb'),
  ('csb2', 'Fajar', 'Senior Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat','Sun'], 'csb'),
  ('csb3', 'Yanto', 'Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Mon','Wed','Thu','Fri','Sat'], 'csb'),
  ('csb4', 'Asep', 'Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Mon','Tue','Thu','Fri','Sat','Sun'], 'csb'),
  ('csb5', 'Deni', 'Junior Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri'], 'csb'),
  ('csb6', 'Maman', 'Junior Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat'], 'csb'),
  
  -- Sumber (4 Orang)
  ('sumber1', 'Joko', 'Senior Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], 'sumber'),
  ('sumber2', 'Slamet', 'Senior Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat','Sun'], 'sumber'),
  ('sumber3', 'Nanang', 'Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Mon','Wed','Thu','Fri','Sat'], 'sumber'),
  ('sumber4', 'Wawan', 'Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Mon','Tue','Thu','Fri','Sat','Sun'], 'sumber'),
  
  -- Tegal (6 Orang)
  ('tegal1', 'Hadi', 'Senior Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'], 'tegal'),
  ('tegal2', 'Yudi', 'Senior Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat','Sun'], 'tegal'),
  ('tegal3', 'Aris', 'Barber', 'Brand_assets/Kapster4.jpg', ARRAY['Mon','Wed','Thu','Fri','Sat'], 'tegal'),
  ('tegal4', 'Tedi', 'Barber', 'Brand_assets/Kapster1.jpg', ARRAY['Mon','Tue','Thu','Fri','Sat','Sun'], 'tegal'),
  ('tegal5', 'Sony', 'Junior Barber', 'Brand_assets/Kapster2.jpg', ARRAY['Mon','Tue','Wed','Thu','Fri'], 'tegal'),
  ('tegal6', 'Diki', 'Junior Barber', 'Brand_assets/Kapster3.jpg', ARRAY['Tue','Wed','Thu','Fri','Sat'], 'tegal')
ON CONFLICT (id) DO NOTHING;

-- ================================================
-- TABLE: customers
-- ================================================
CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  wa           TEXT NOT NULL UNIQUE,
  visits       INTEGER DEFAULT 0,
  total_spent  INTEGER DEFAULT 0,
  last_visit   DATE,
  services     TEXT[],
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for search
CREATE INDEX IF NOT EXISTS idx_customers_wa   ON customers (wa);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);

-- ================================================
-- TABLE: bookings
-- ================================================
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  wa            TEXT NOT NULL,
  service_id    TEXT NOT NULL,
  service       TEXT NOT NULL,
  price         INTEGER DEFAULT 0,
  duration      TEXT,
  barber_id     TEXT REFERENCES barbers(id) ON DELETE SET NULL,
  date          DATE NOT NULL,
  time          TIME NOT NULL,
  location      TEXT DEFAULT 'bypass',
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','done','cancelled')),
  notes         TEXT,
  payment       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_bookings_date      ON bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_barber    ON bookings (barber_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status    ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_wa        ON bookings (wa);

-- ================================================
-- UNIQUE CONSTRAINT: anti double-booking
-- 1 barber can only have 1 booking per timeslot (excluding cancelled)
-- Enforced via partial unique index
-- ================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_double_booking
  ON bookings (barber_id, date, time)
  WHERE status <> 'cancelled' AND barber_id <> 'any';

-- ================================================
-- FUNCTION: auto-update updated_at timestamp
-- ================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookings_updated
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================
-- FUNCTION: sync customer after booking done
-- Upsert customer data when booking status = 'done'
-- ================================================
CREATE OR REPLACE FUNCTION sync_customer_on_done()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    INSERT INTO customers (name, wa, visits, total_spent, last_visit, services)
    VALUES (NEW.name, NEW.wa, 1, NEW.price, NEW.date, ARRAY[NEW.service])
    ON CONFLICT (wa) DO UPDATE
      SET
        visits      = customers.visits + 1,
        total_spent = customers.total_spent + NEW.price,
        last_visit  = GREATEST(customers.last_visit, NEW.date),
        services    = ARRAY(
          SELECT DISTINCT unnest(customers.services || ARRAY[NEW.service])
        ),
        updated_at  = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_customer
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION sync_customer_on_done();

-- ================================================
-- VIEW: booking_full (joined with barber name)
-- ================================================
CREATE OR REPLACE VIEW booking_full AS
  SELECT
    b.*,
    br.name AS barber_name,
    br.role AS barber_role
  FROM bookings b
  LEFT JOIN barbers br ON b.barber_id = br.id;
