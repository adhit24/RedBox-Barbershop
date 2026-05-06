-- ============================================================
-- MOKA SCHEMA MIGRATION
-- Jalankan di Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Tambah kolom moka_employee_id ke tabel barbers
--    (menyimpan Moka item ID untuk setiap barber)
ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS moka_employee_id TEXT;

-- 2. Tambah kolom moka_variant_name + moka_variant_id ke tabel services
--    (menyimpan nama & ID variant Moka untuk setiap service)
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS moka_variant_name TEXT;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS moka_variant_id TEXT;

-- 3. Index untuk mempercepat lookup saat sync
CREATE INDEX IF NOT EXISTS idx_barbers_moka_employee_id
  ON barbers (moka_employee_id)
  WHERE moka_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_moka_variant_id
  ON services (moka_variant_id)
  WHERE moka_variant_id IS NOT NULL;

-- ============================================================
-- DATA MIGRATION: Isi moka_employee_id dari mapping Moka
-- (Diisi otomatis oleh POST /api/moka/sync-schema setelah migration)
-- Tapi berikut data hardcode sebagai fallback manual:
-- ============================================================

-- BYPASS (outlet_id: 2bcb604c-41da-42e5-9cd4-92fbfb691b75)
UPDATE barbers SET moka_employee_id = '16902095' WHERE id = 'bypass-abdul-dul';
UPDATE barbers SET moka_employee_id = '16902127' WHERE id = 'bypass-ari';
UPDATE barbers SET moka_employee_id = '16902100' WHERE id = 'bypass-bob';
UPDATE barbers SET moka_employee_id = '16902115' WHERE id = 'bypass-onoy';
UPDATE barbers SET moka_employee_id = '16902066' WHERE id = 'bypass-kaji-dodi';

-- SAMADIKUN (outlet_id: 3dc551a8-55ca-4cc0-a354-1a50b31bb783)
UPDATE barbers SET moka_employee_id = '11553115' WHERE id = 'samadikun-aden';
UPDATE barbers SET moka_employee_id = '11553118' WHERE id = 'samadikun-miftah';
UPDATE barbers SET moka_employee_id = '23996892' WHERE id = 'samadikun-opan';
UPDATE barbers SET moka_employee_id = '11553097' WHERE id = 'samadikun-khamami';
UPDATE barbers SET moka_employee_id = '11553120' WHERE id = 'samadikun-sofyan';

-- CSB (outlet_id: d0c665ff-d2d1-4f78-be76-2b1e0619fbaa)
UPDATE barbers SET moka_employee_id = '88894606' WHERE id = 'csb-anggi';
UPDATE barbers SET moka_employee_id = '28129802' WHERE id = 'csb-ega';
UPDATE barbers SET moka_employee_id = '25658146' WHERE id = 'csb-husen';
UPDATE barbers SET moka_employee_id = '88894856' WHERE id = 'csb-ragil';   -- Hamami di Moka
-- csb-ubay, csb-syarif, csb-yudha, csb-yuda: perlu dicek manual di Moka backoffice

-- SUMBER (outlet_id: 16b6ceef-0aad-4653-9040-68372ddd5dd7)
UPDATE barbers SET moka_employee_id = '51851206' WHERE id = 'sumber-putra';
UPDATE barbers SET moka_employee_id = '51881250' WHERE id = 'sumber-didi';
UPDATE barbers SET moka_employee_id = '51851187' WHERE id = 'sumber-prima';
UPDATE barbers SET moka_employee_id = '51851186' WHERE id = 'sumber-sigit';

-- TEGAL (outlet_id: f33bc93a-e90c-4a37-85d5-fd883cd77533)
UPDATE barbers SET moka_employee_id = '94809571' WHERE id = 'tegal-epik';
UPDATE barbers SET moka_employee_id = '94826284' WHERE id = 'tegal-yafi';
UPDATE barbers SET moka_employee_id = '94809440' WHERE id = 'tegal-faiz';
UPDATE barbers SET moka_employee_id = '94809567' WHERE id = 'tegal-wawan';
UPDATE barbers SET moka_employee_id = '94809575' WHERE id = 'tegal-ahmad';
UPDATE barbers SET moka_employee_id = '94809574' WHERE id = 'tegal-sephril';

-- ============================================================
-- SERVICES: mapping nama service kita → nama variant Moka
-- (variant_id tidak disimpan di sini karena berbeda per barber)
-- ============================================================
UPDATE services SET moka_variant_name = 'Hair Cut'           WHERE name ILIKE '%haircut%' AND name NOT ILIKE '%fade%' AND name NOT ILIKE '%beard%' AND name NOT ILIKE '%cream%';
UPDATE services SET moka_variant_name = 'Hair Cut with Fade' WHERE name ILIKE '%fade%';
UPDATE services SET moka_variant_name = 'Beard & Mustache'   WHERE name ILIKE '%beard%';
UPDATE services SET moka_variant_name = 'Creambath'          WHERE name ILIKE '%creambath%';
UPDATE services SET moka_variant_name = 'Hair Colouring'     WHERE name ILIKE '%color%' OR name ILIKE '%colour%';
UPDATE services SET moka_variant_name = 'Hair Tattoo Single' WHERE name ILIKE '%tattoo single%';
UPDATE services SET moka_variant_name = 'Hair Tattoo'        WHERE name ILIKE '%tattoo%' AND name NOT ILIKE '%single%' AND name NOT ILIKE '%double%';
UPDATE services SET moka_variant_name = 'Shave'              WHERE name ILIKE '%shave%' AND name NOT ILIKE '%shaving%';
UPDATE services SET moka_variant_name = 'Traditional Shaving' WHERE name ILIKE '%traditional%';
UPDATE services SET moka_variant_name = 'Hair Spa'           WHERE name ILIKE '%spa%';
UPDATE services SET moka_variant_name = 'Hair Smoothing'     WHERE name ILIKE '%smoothing%';
UPDATE services SET moka_variant_name = 'Hair Curly'         WHERE name ILIKE '%curly%' OR name ILIKE '%keriting%';
UPDATE services SET moka_variant_name = 'Hair Colouring'     WHERE name ILIKE '%warna%' OR name ILIKE '%coloring%';

-- Verifikasi hasil
SELECT id, name, moka_variant_name, moka_employee_id FROM barbers ORDER BY outlet_id, name;
SELECT id, name, moka_variant_name, moka_item_id, moka_category_id FROM services;
