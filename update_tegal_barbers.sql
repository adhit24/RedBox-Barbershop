-- Update Tegal barbers dari CSV Moka Item Library
-- Generated: 2026-05-28

UPDATE barbers SET moka_employee_id = '147468093' WHERE id = 'tegal-faiz';
UPDATE barbers SET moka_employee_id = '147470744' WHERE id = 'tegal-wawan';
UPDATE barbers SET moka_employee_id = '147465521' WHERE id = 'tegal-epik';
UPDATE barbers SET moka_employee_id = '147463715' WHERE id = 'tegal-ahmad';
UPDATE barbers SET moka_employee_id = '147470666' WHERE id = 'tegal-sephril';
UPDATE barbers SET moka_employee_id = '147470745' WHERE id = 'tegal-yafi';

-- Verify updates
SELECT o.slug as outlet, b.name, b.moka_employee_id
FROM barbers b
JOIN outlets o ON b.outlet_id = o.id
WHERE o.slug = 'tegal'
ORDER BY b.name;
