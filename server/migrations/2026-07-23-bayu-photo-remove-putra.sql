-- Update Bayu photo and keep Putra hidden from the live booking list.
-- Run in Supabase SQL Editor or apply via the service role key.

UPDATE barbers
SET img = '/Brand_assets/kapster/bayu.jpeg',
    is_active = true
WHERE id = 'sumber-bayu'
   OR (LOWER(name) = 'bayu' AND branch = 'sumber');

UPDATE barbers
SET is_active = false,
    home_service_enabled = false
WHERE id = 'sumber-putra'
   OR (LOWER(name) = 'putra' AND branch = 'sumber');

SELECT id, name, branch, img, is_active, home_service_enabled
FROM barbers
WHERE id IN ('sumber-bayu', 'sumber-putra')
   OR (LOWER(name) IN ('bayu', 'putra') AND branch = 'sumber')
ORDER BY branch, name;
