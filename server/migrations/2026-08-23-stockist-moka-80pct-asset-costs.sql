-- Import Moka product costs that have a verified gross margin of at least 80%.
-- This is intentionally location-scoped: Moka cost values differ by outlet.
-- Safe to re-run; never changes inventory quantities.

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_purchase_prices (
  location_id          UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  purchase_price       INTEGER NOT NULL CHECK (purchase_price > 0),
  retail_price         INTEGER NOT NULL CHECK (retail_price > 0),
  source               TEXT NOT NULL DEFAULT 'MOKA_ITEM_LIBRARY',
  source_moka_variant_id TEXT NOT NULL,
  source_margin_pct    NUMERIC(7, 3) NOT NULL,
  imported_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_purchase_prices_product
  ON inventory_purchase_prices(product_id);

ALTER TABLE inventory_purchase_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_purchase_prices FROM anon, authenticated;

WITH product_seed(sku, name, variant_name, category, purchase_price, retail_price) AS (
  VALUES
    ('RB-MOKA-001', 'Barbara Mousse', '', 'Hair Product', 5636, 50000),
    ('RB-MOKA-002', 'Kenny Hair Styling Spray', '', 'Hair Product', 8795, 55000),
    ('RB-MOKA-003', 'Redbox Pomade', 'Redbox Clay 80gr', 'Pomade', 24750, 130000),
    ('RB-MOKA-004', 'Sisir Rambut', 'Sisir Benchmade', 'Hair Product', 6714, 150000),
    ('RB-MOKA-005', 'Sisir Rambut', 'Sisir Benchmade Plastik', 'Hair Product', 3600, 50000),
    ('RB-MOKA-006', 'Sisir Rambut', 'Sisir Blow', 'Hair Product', 3314, 30000),
    ('RB-MOKA-007', 'Sisir Rambut', 'Sisir Bulat', 'Hair Product', 2343, 20000),
    ('RB-MOKA-008', 'Sisir Rambut', 'Sisir Jambang', 'Hair Product', 2000, 60000),
    ('RB-MOKA-009', 'Sisir Rambut', 'Sisir Kayu', 'Hair Product', 2000, 50000),
    ('RB-MOKA-010', 'Sisir Rambut', 'Sisir Kayu Lipat', 'Hair Product', 2000, 100000),
    ('RB-MOKA-011', 'Sisir Rambut', 'Sisir Lipat Plastik', 'Hair Product', 2000, 20000),
    ('RB-MOKA-012', 'Sisir Rambut', 'Sisir Mini', 'Hair Product', 2000, 10000),
    ('RB-MOKA-013', 'Sisir Rambut', 'Sisir Panjang', 'Hair Product', 2000, 20000),
    ('RB-MOKA-014', 'Sisir Rambut', 'Sisir Switch Blade', 'Hair Product', 2000, 70000),
    ('RB-MOKA-015', 'Tumbler Redbox', '', 'Merchandise', 5000, 100000)
), product_upsert AS (
  INSERT INTO products (sku, name, category, brand, unit, purchase_price, retail_price, product_type, is_active)
  SELECT sku, CASE WHEN variant_name = '' THEN name ELSE name || ' - ' || variant_name END,
         category, 'RedBox', 'pcs', purchase_price, retail_price, 'RETAIL', TRUE
  FROM product_seed
  ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    purchase_price = EXCLUDED.purchase_price,
    retail_price = EXCLUDED.retail_price,
    product_type = 'RETAIL',
    is_active = TRUE,
    updated_at = NOW()
  RETURNING id, sku
)
INSERT INTO inventory_purchase_prices (
  location_id, product_id, purchase_price, retail_price,
  source_moka_variant_id, source_margin_pct
)
SELECT il.id, p.id, s.purchase_price, s.retail_price, s.variant_id,
       ROUND((100.0 * (s.retail_price - s.purchase_price) / s.retail_price)::numeric, 3)
FROM (VALUES
  ('samadikun', 'RB-MOKA-004', 11429, 150000, '23002291'),
  ('samadikun', 'RB-MOKA-013', 2000, 20000, '23002300'),
  ('samadikun', 'RB-MOKA-014', 2000, 70000, '23002299'),
  ('samadikun', 'RB-MOKA-011', 2000, 20000, '23002298'),
  ('samadikun', 'RB-MOKA-005', 4400, 50000, '23002297'),
  ('samadikun', 'RB-MOKA-010', 2000, 100000, '23002296'),
  ('samadikun', 'RB-MOKA-009', 2000, 50000, '23002295'),
  ('samadikun', 'RB-MOKA-008', 2000, 60000, '23002294'),
  ('samadikun', 'RB-MOKA-007', 2501, 20000, '23002293'),
  ('samadikun', 'RB-MOKA-012', 2000, 10000, '23002292'),
  ('samadikun', 'RB-MOKA-006', 4889, 30000, '62273735'),
  ('samadikun', 'RB-MOKA-001', 8976, 50000, '102574648'),
  ('sumber', 'RB-MOKA-004', 2000, 150000, '82158577'),
  ('sumber', 'RB-MOKA-013', 2000, 20000, '82158573'),
  ('sumber', 'RB-MOKA-014', 2000, 70000, '82158570'),
  ('sumber', 'RB-MOKA-011', 2000, 20000, '82158579'),
  ('sumber', 'RB-MOKA-005', 2000, 50000, '82158574'),
  ('sumber', 'RB-MOKA-010', 2000, 100000, '82158571'),
  ('sumber', 'RB-MOKA-009', 2000, 50000, '82158572'),
  ('sumber', 'RB-MOKA-008', 2000, 60000, '82158575'),
  ('sumber', 'RB-MOKA-007', 2000, 20000, '82158576'),
  ('sumber', 'RB-MOKA-012', 2000, 10000, '82158580'),
  ('sumber', 'RB-MOKA-006', 2000, 30000, '82158578'),
  ('sumber', 'RB-MOKA-015', 5000, 100000, '93491451'),
  ('tegal', 'RB-MOKA-003', 24750, 130000, '144990555'),
  ('tegal', 'RB-MOKA-002', 8795, 55000, '144992200'),
  ('csb', 'RB-MOKA-013', 2000, 20000, '33139528'),
  ('csb', 'RB-MOKA-014', 2000, 70000, '33139529'),
  ('csb', 'RB-MOKA-011', 2000, 20000, '33139530'),
  ('csb', 'RB-MOKA-005', 4400, 50000, '33139531'),
  ('csb', 'RB-MOKA-010', 2000, 100000, '33139532'),
  ('csb', 'RB-MOKA-009', 2000, 50000, '33139533'),
  ('csb', 'RB-MOKA-008', 2000, 60000, '33139534'),
  ('csb', 'RB-MOKA-007', 2528, 20000, '33139535'),
  ('csb', 'RB-MOKA-012', 2000, 10000, '33139536'),
  ('csb', 'RB-MOKA-006', 3052, 30000, '62273687'),
  ('csb', 'RB-MOKA-001', 2295, 50000, '102574604')
) AS s(outlet_slug, sku, purchase_price, retail_price, variant_id)
JOIN product_upsert p ON p.sku = s.sku
JOIN inventory_locations il ON il.type = 'branch'
JOIN outlets o ON o.id = il.outlet_id AND o.slug = s.outlet_slug
ON CONFLICT (location_id, product_id) DO UPDATE SET
  purchase_price = EXCLUDED.purchase_price,
  retail_price = EXCLUDED.retail_price,
  source_moka_variant_id = EXCLUDED.source_moka_variant_id,
  source_margin_pct = EXCLUDED.source_margin_pct,
  updated_at = NOW();

COMMIT;
