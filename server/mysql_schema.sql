-- ================================================
-- REDBOX BARBERSHOP — MySQL Schema (XAMPP)
-- ================================================

CREATE DATABASE IF NOT EXISTS redbox_db;
USE redbox_db;

-- ================================================
-- TABLE: barbers
-- ================================================
CREATE TABLE IF NOT EXISTS barbers (
  id         VARCHAR(50) PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  role       VARCHAR(100),
  img        VARCHAR(255),
  work_days  JSON,  -- MySQL supports JSON for arrays
  branch     VARCHAR(50), -- bypass, samadikun, csb, sumber, tegal
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed barbers (27 people)
INSERT INTO barbers (id, name, role, img, work_days, branch) VALUES
  -- Bypass (6 Orang)
  ('bypass1', 'Alex Chillboy UA', 'Senior Master Barber', 'Brand_assets/Kapster1.jpg', '["Mon","Tue","Wed","Thu","Fri","Sat"]', 'bypass'),
  ('bypass2', 'Adrián AR', 'Senior Master Barber', 'Brand_assets/Kapster2.jpg', '["Tue","Wed","Thu","Fri","Sat","Sun"]', 'bypass'),
  ('bypass3', 'B Richards BR', 'Fade Specialist', 'Brand_assets/Kapster3.jpg', '["Mon","Wed","Thu","Fri","Sat"]', 'bypass'),
  ('bypass4', 'Iwan', 'Barber', 'Brand_assets/Kapster4.jpg', '["Mon","Tue","Thu","Fri","Sat","Sun"]', 'bypass'),
  ('bypass5', 'Heri', 'Junior Barber', 'Brand_assets/Kapster1.jpg', '["Mon","Tue","Wed","Thu","Fri"]', 'bypass'),
  ('bypass6', 'Ujang', 'Junior Barber', 'Brand_assets/Kapster2.jpg', '["Tue","Wed","Thu","Fri","Sat"]', 'bypass'),
  
  -- Samadikun (5 Orang)
  ('samadikun1', 'Andi', 'Senior Barber', 'Brand_assets/Kapster3.jpg', '["Mon","Tue","Wed","Thu","Fri","Sat"]', 'samadikun'),
  ('samadikun2', 'Rian', 'Senior Barber', 'Brand_assets/Kapster4.jpg', '["Tue","Wed","Thu","Fri","Sat","Sun"]', 'samadikun'),
  ('samadikun3', 'Eko', 'Barber', 'Brand_assets/Kapster1.jpg', '["Mon","Wed","Thu","Fri","Sat"]', 'samadikun'),
  ('samadikun4', 'Toto', 'Barber', 'Brand_assets/Kapster2.jpg', '["Mon","Tue","Thu","Fri","Sat","Sun"]', 'samadikun'),
  ('samadikun5', 'Gani', 'Junior Barber', 'Brand_assets/Kapster3.jpg', '["Mon","Tue","Wed","Thu","Fri"]', 'samadikun'),
  
  -- CSB Mall (6 Orang)
  ('csb1', 'Rizky', 'Senior Barber', 'Brand_assets/Kapster4.jpg', '["Mon","Tue","Wed","Thu","Fri","Sat"]', 'csb'),
  ('csb2', 'Fajar', 'Senior Barber', 'Brand_assets/Kapster1.jpg', '["Tue","Wed","Thu","Fri","Sat","Sun"]', 'csb'),
  ('csb3', 'Yanto', 'Barber', 'Brand_assets/Kapster2.jpg', '["Mon","Wed","Thu","Fri","Sat"]', 'csb'),
  ('csb4', 'Asep', 'Barber', 'Brand_assets/Kapster3.jpg', '["Mon","Tue","Thu","Fri","Sat","Sun"]', 'csb'),
  ('csb5', 'Deni', 'Junior Barber', 'Brand_assets/Kapster4.jpg', '["Mon","Tue","Wed","Thu","Fri"]', 'csb'),
  ('csb6', 'Maman', 'Junior Barber', 'Brand_assets/Kapster1.jpg', '["Tue","Wed","Thu","Fri","Sat"]', 'csb'),
  
  -- Sumber (4 Orang)
  ('sumber1', 'Joko', 'Senior Barber', 'Brand_assets/Kapster2.jpg', '["Mon","Tue","Wed","Thu","Fri","Sat"]', 'sumber'),
  ('sumber2', 'Slamet', 'Senior Barber', 'Brand_assets/Kapster3.jpg', '["Tue","Wed","Thu","Fri","Sat","Sun"]', 'sumber'),
  ('sumber3', 'Nanang', 'Barber', 'Brand_assets/Kapster4.jpg', '["Mon","Wed","Thu","Fri","Sat"]', 'sumber'),
  ('sumber4', 'Wawan', 'Barber', 'Brand_assets/Kapster1.jpg', '["Mon","Tue","Thu","Fri","Sat","Sun"]', 'sumber'),
  
  -- Tegal (6 Orang)
  ('tegal1', 'Hadi', 'Senior Barber', 'Brand_assets/Kapster2.jpg', '["Mon","Tue","Wed","Thu","Fri","Sat"]', 'tegal'),
  ('tegal2', 'Yudi', 'Senior Barber', 'Brand_assets/Kapster3.jpg', '["Tue","Wed","Thu","Fri","Sat","Sun"]', 'tegal'),
  ('tegal3', 'Aris', 'Barber', 'Brand_assets/Kapster4.jpg', '["Mon","Wed","Thu","Fri","Sat"]', 'tegal'),
  ('tegal4', 'Tedi', 'Barber', 'Brand_assets/Kapster1.jpg', '["Mon","Tue","Thu","Fri","Sat","Sun"]', 'tegal'),
  ('tegal5', 'Sony', 'Junior Barber', 'Brand_assets/Kapster2.jpg', '["Mon","Tue","Wed","Thu","Fri"]', 'tegal'),
  ('tegal6', 'Diki', 'Junior Barber', 'Brand_assets/Kapster3.jpg', '["Tue","Wed","Thu","Fri","Sat"]', 'tegal')
ON DUPLICATE KEY UPDATE id=id;

-- ================================================
-- TABLE: customers
-- ================================================
CREATE TABLE IF NOT EXISTS customers (
  id           VARCHAR(36) PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  wa           VARCHAR(20) NOT NULL UNIQUE,
  visits       INT DEFAULT 0,
  total_spent  INT DEFAULT 0,
  last_visit   DATE,
  services     JSON,
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ================================================
-- TABLE: bookings
-- ================================================
CREATE TABLE IF NOT EXISTS bookings (
  id            VARCHAR(36) PRIMARY KEY,
  customer_id   VARCHAR(36),
  name          VARCHAR(100) NOT NULL,
  wa            VARCHAR(20) NOT NULL,
  service_id    VARCHAR(50) NOT NULL,
  service       VARCHAR(100) NOT NULL,
  price         INT DEFAULT 0,
  duration      VARCHAR(50),
  barber_id     VARCHAR(50),
  date          DATE NOT NULL,
  time          TIME NOT NULL,
  location      VARCHAR(100) DEFAULT 'bypass',
  status        ENUM('pending','confirmed','done','cancelled') DEFAULT 'pending',
  notes         TEXT,
  payment       VARCHAR(50),
  slot_key      VARCHAR(120) GENERATED ALWAYS AS (
    CASE
      WHEN barber_id IS NULL OR barber_id = 'any' OR status = 'cancelled' THEN NULL
      ELSE CONCAT(barber_id,'|',date,'|',time)
    END
  ) STORED,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE SET NULL
);

-- Indices
CREATE INDEX idx_bookings_date ON bookings (date);
CREATE INDEX idx_bookings_wa ON bookings (wa);
CREATE UNIQUE INDEX uq_bookings_slot_key ON bookings (slot_key);
