-- ============================================================
-- SERVICE DURATIONS — Authoritative list dari RedBox Barbershop
-- Jalankan di Supabase Dashboard > SQL Editor
--
-- Tujuan: memastikan setiap Open Bill di MokaPOS (walk-in / goshow)
-- mem-blok slot kapster dengan durasi yang AKURAT, sehingga website
-- tidak menerima reservasi yang bentrok (double booking).
--
-- Mekanisme:
--   1. MokaPOS Open Bill (PENDING) → server/moka/sync.js Pull 3
--   2. Lookup duration_minutes by services.moka_variant_name (atau name)
--   3. Insert schedules row status='reserved' dengan
--        start_time = createdAt   (goshow) atau parsed dari billName (advance)
--        end_time   = start_time + sum(duration) + buffer
--   4. Constraint no_barber_overlap (GiST) cegah web booking overlap
-- ============================================================

-- ── Step 1: Update durasi untuk service yang sudah ada (match by name) ──
-- Pakai ILIKE supaya tidak case-sensitive dan toleran terhadap variasi spasi.

UPDATE services SET duration_minutes = 45  WHERE name ILIKE 'Hair Cut'                      OR name ILIKE 'Haircut'             OR name ILIKE '%hair cut%' AND name NOT ILIKE '%fade%';
UPDATE services SET duration_minutes = 60  WHERE name ILIKE 'Hair Fade Cut'                 OR name ILIKE '%fade%';
UPDATE services SET duration_minutes = 15  WHERE name ILIKE 'Hair Tattoo – Single Side'     OR name ILIKE 'Hair Tattoo - Single Side' OR name ILIKE '%tattoo%single%';
UPDATE services SET duration_minutes = 30  WHERE name ILIKE 'Hair Tattoo – Double Side'     OR name ILIKE 'Hair Tattoo - Double Side' OR name ILIKE '%tattoo%double%';
UPDATE services SET duration_minutes = 45  WHERE name ILIKE 'Hair Color'                    OR name ILIKE 'Hair Colouring'      OR name ILIKE '%hair color%';
UPDATE services SET duration_minutes = 180 WHERE name ILIKE 'Hair Bleaching'                OR name ILIKE '%bleach%';
UPDATE services SET duration_minutes = 180 WHERE name ILIKE 'Hair Highlighting'             OR name ILIKE '%highlight%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Hair Curly'                    OR name ILIKE '%curly%' OR name ILIKE '%keriting%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Hair Smoothing'                OR name ILIKE '%smoothing%';
UPDATE services SET duration_minutes = 30  WHERE name ILIKE 'Hair Spa'                      OR name ILIKE '%hair spa%';
UPDATE services SET duration_minutes = 60  WHERE name ILIKE 'Down Perm / Root Lift'         OR name ILIKE '%root lift%' OR name ILIKE '%down perm%';
UPDATE services SET duration_minutes = 30  WHERE name ILIKE 'Traditional Shaving'           OR name ILIKE '%traditional%';
UPDATE services SET duration_minutes = 45  WHERE name ILIKE 'Premium Head Shave'            OR name ILIKE '%head shave%' OR name ILIKE '%premium shave%';
UPDATE services SET duration_minutes = 45  WHERE name ILIKE 'Men Massage Service'           OR name ILIKE '%massage%';
UPDATE services SET duration_minutes = 25  WHERE name ILIKE 'Nose Wax'                      OR name ILIKE '%nose wax%';
UPDATE services SET duration_minutes = 25  WHERE name ILIKE 'Ear Wax'                       OR name ILIKE '%ear wax%';
UPDATE services SET duration_minutes = 20  WHERE name ILIKE 'Ear Singeing'                  OR name ILIKE '%singeing%';
UPDATE services SET duration_minutes = 45  WHERE name ILIKE 'Charcoal Deep Cleansing'       OR name ILIKE '%deep cleansing%';
UPDATE services SET duration_minutes = 25  WHERE name ILIKE 'Ear Candle'                    OR name ILIKE '%ear candle%';
UPDATE services SET duration_minutes = 30  WHERE name ILIKE 'Charcoal Nose Cleansing Strip' OR name ILIKE '%nose cleansing%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Redbox Royal Grooming'         OR name ILIKE '%royal grooming%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Redbox Duxe Grooming'          OR name ILIKE '%duxe grooming%' OR name ILIKE '%deluxe grooming%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Redbox Earl Grooming'          OR name ILIKE '%earl grooming%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Redbox Baron Grooming'         OR name ILIKE '%baron grooming%';
UPDATE services SET duration_minutes = 90  WHERE name ILIKE 'Redbox Noble Grooming'         OR name ILIKE '%noble grooming%';

-- ── Step 2: Update durasi via moka_variant_name (untuk lookup dari Moka items) ──
-- Variant name di MokaPOS bisa berbeda dengan service display name kita.
-- Update ini memastikan _processOpenBill bisa lookup duration via variant name.

UPDATE services SET duration_minutes = 45  WHERE moka_variant_name ILIKE 'Hair Cut'                  AND duration_minutes <> 45;
UPDATE services SET duration_minutes = 60  WHERE moka_variant_name ILIKE 'Hair Cut with Fade'        AND duration_minutes <> 60;
UPDATE services SET duration_minutes = 60  WHERE moka_variant_name ILIKE 'Hair Fade Cut'             AND duration_minutes <> 60;
UPDATE services SET duration_minutes = 45  WHERE moka_variant_name ILIKE 'Hair Colouring'            AND duration_minutes <> 45;
UPDATE services SET duration_minutes = 30  WHERE moka_variant_name ILIKE 'Traditional Shaving'      AND duration_minutes <> 30;
UPDATE services SET duration_minutes = 30  WHERE moka_variant_name ILIKE 'Hair Spa'                  AND duration_minutes <> 30;
UPDATE services SET duration_minutes = 90  WHERE moka_variant_name ILIKE 'Hair Smoothing'           AND duration_minutes <> 90;
UPDATE services SET duration_minutes = 90  WHERE moka_variant_name ILIKE 'Hair Curly'                AND duration_minutes <> 90;
UPDATE services SET duration_minutes = 30  WHERE moka_variant_name ILIKE 'Hair Tattoo'               AND moka_variant_name NOT ILIKE '%single%' AND duration_minutes <> 30;
UPDATE services SET duration_minutes = 15  WHERE moka_variant_name ILIKE 'Hair Tattoo Single'        AND duration_minutes <> 15;

-- ── Step 3: Verifikasi hasil ──
SELECT
  name,
  moka_variant_name,
  duration_minutes,
  price
FROM services
ORDER BY duration_minutes DESC, name;

-- ── Step 4 (OPSIONAL): Insert service yang belum ada di DB ──
-- Uncomment & adjust jika service di list belum ada di tabel services.
-- Slug harus unique; gunakan slugify dari nama.
--
-- INSERT INTO services (name, slug, duration_minutes, price, is_active)
-- VALUES
--   ('Hair Bleaching',                'hair-bleaching',                180, 0, true),
--   ('Hair Highlighting',             'hair-highlighting',             180, 0, true),
--   ('Down Perm / Root Lift',         'down-perm-root-lift',           60,  0, true),
--   ('Premium Head Shave',            'premium-head-shave',            45,  0, true),
--   ('Men Massage Service',           'men-massage-service',           45,  0, true),
--   ('Nose Wax',                      'nose-wax',                      25,  0, true),
--   ('Ear Wax',                       'ear-wax',                       25,  0, true),
--   ('Ear Singeing',                  'ear-singeing',                  20,  0, true),
--   ('Charcoal Deep Cleansing',       'charcoal-deep-cleansing',       45,  0, true),
--   ('Ear Candle',                    'ear-candle',                    25,  0, true),
--   ('Charcoal Nose Cleansing Strip', 'charcoal-nose-cleansing-strip', 30,  0, true),
--   ('Redbox Royal Grooming',         'redbox-royal-grooming',         90,  0, true),
--   ('Redbox Duxe Grooming',          'redbox-duxe-grooming',          90,  0, true),
--   ('Redbox Earl Grooming',          'redbox-earl-grooming',          90,  0, true),
--   ('Redbox Baron Grooming',         'redbox-baron-grooming',         90,  0, true),
--   ('Redbox Noble Grooming',         'redbox-noble-grooming',         90,  0, true)
-- ON CONFLICT (slug) DO UPDATE SET duration_minutes = EXCLUDED.duration_minutes;
