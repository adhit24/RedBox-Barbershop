-- Fix Aziz and Bayu barbers at Sumber branch
-- Issues: missing images, basic role only

-- Update Aziz with proper image and role
UPDATE barbers 
SET 
  img = '/Brand_assets/Kapster1.jpg',
  role = 'Hair Tattoo, Haircut, Coloring, Haircut Fade, Root Lift, Shaving, Wedding Grooming',
  updated_at = NOW()
WHERE id = 'sumber-aziz';

-- Update Bayu with proper image and role  
UPDATE barbers
SET 
  img = '/Brand_assets/Kapster2.jpg',
  role = 'Hair Tattoo, Haircut, Coloring, Haircut Fade, Root Lift, Shaving, Wedding Grooming',
  updated_at = NOW()
WHERE id = 'sumber-bayu';

-- Verify updates
SELECT id, name, img, role, is_active 
FROM barbers 
WHERE id IN ('sumber-aziz', 'sumber-bayu');
