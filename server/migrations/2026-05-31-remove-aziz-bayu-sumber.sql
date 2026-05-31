-- Remove Aziz and Bayu from Sumber branch
-- Run this in Supabase SQL Editor

-- 1. Soft delete (recommended): set as inactive
UPDATE barbers
SET is_active = false,
    home_service_enabled = false
WHERE LOWER(name) IN ('aziz', 'bayu')
  AND branch = 'sumber';

-- 2. Verify the changes
SELECT id, name, branch, is_active, home_service_enabled
FROM barbers
WHERE LOWER(name) IN ('aziz', 'bayu')
  AND branch = 'sumber';

-- 3. Hard delete (only if you don't need history) - UNCOMMENT to use:
-- DELETE FROM barbers
-- WHERE LOWER(name) IN ('aziz', 'bayu')
--   AND branch = 'sumber';
