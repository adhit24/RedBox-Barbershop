-- Task 2.1B: classify "Member Platinum" / "Member Student" line items as
-- NON_STOCK_MISC (membership/payment products, not barber-performed
-- services — approved business decision, section 9 of the Task 2.1B brief).
--
-- Exact (outlet, moka_item_id, moka_variant_id) triples only — never a
-- blind name match across all outlets. Sourced from a live audit of
-- moka_stockist_anomalies (anomaly_type='UNMAPPED_PRODUCT') on 2026-09-17.
-- Note "Member Platinum" and "Member Student" share the SAME moka_item_id
-- at bypass (16902093) and at csb (18112524) — they differ only by
-- moka_variant_id at those two outlets, which is exactly why classification
-- here keys on the full (outlet, item, variant) triple, never item_id alone.
--
-- IMPORTANT: moka_item_mappings has NO unique constraint on
-- (moka_item_id, moka_variant_id, outlet_id) — verified via pg_constraint
-- before writing this (the exact class of assumption that caused the
-- Task 2.1B moka_barber_services ON CONFLICT bug). This migration therefore
-- follows the same safe UPDATE-then-INSERT-if-missing pattern already used
-- in 2026-09-07-stockist-moka-item-classification-backfill.sql, not
-- ON CONFLICT, and is safe to re-run.
--
-- NOT APPLIED by this task — review and run deliberately. No schema change;
-- touches only these 7 exact rows.

BEGIN;

WITH targets(outlet_slug, moka_item_id, moka_variant_id, item_name) AS (
  VALUES
    ('bypass',    '16902093', '207049813', 'Member Platinum'),
    ('csb',       '18112524', '207049935', 'Member Platinum'),
    ('sumber',    '51851182', '82158584',  'Member Student'),
    ('bypass',    '16902093', '31396264',  'Member Student'),
    ('samadikun', '11551867', '23002317',  'Member Student'),
    ('csb',       '18112524', '33139495',  'Member Student'),
    ('tegal',     '94819112', '144991607', 'Member Student')
),
resolved AS (
  SELECT o.id AS outlet_id, t.moka_item_id, t.moka_variant_id, t.item_name
  FROM targets t
  JOIN public.outlets o ON o.slug = t.outlet_slug
)
UPDATE public.moka_item_mappings m
SET classification = 'NON_STOCK_MISC',
    classification_reason = 'Task 2.1B: membership/payment product ("' || r.item_name || '"), not a barber-performed service — exact (outlet, moka_item_id, moka_variant_id) match only.',
    is_active = false,
    updated_at = now()
FROM resolved r
WHERE m.moka_item_id = r.moka_item_id
  AND m.moka_variant_id = r.moka_variant_id
  AND m.outlet_id = r.outlet_id
  AND m.classification IS DISTINCT FROM 'NON_STOCK_MISC';

WITH targets(outlet_slug, moka_item_id, moka_variant_id, item_name) AS (
  VALUES
    ('bypass',    '16902093', '207049813', 'Member Platinum'),
    ('csb',       '18112524', '207049935', 'Member Platinum'),
    ('sumber',    '51851182', '82158584',  'Member Student'),
    ('bypass',    '16902093', '31396264',  'Member Student'),
    ('samadikun', '11551867', '23002317',  'Member Student'),
    ('csb',       '18112524', '33139495',  'Member Student'),
    ('tegal',     '94819112', '144991607', 'Member Student')
),
resolved AS (
  SELECT o.id AS outlet_id, t.moka_item_id, t.moka_variant_id, t.item_name
  FROM targets t
  JOIN public.outlets o ON o.slug = t.outlet_slug
)
INSERT INTO public.moka_item_mappings (moka_item_id, moka_variant_id, product_id, outlet_id, is_active, classification, classification_reason)
SELECT r.moka_item_id, r.moka_variant_id, NULL::uuid, r.outlet_id, false, 'NON_STOCK_MISC',
  'Task 2.1B: membership/payment product ("' || r.item_name || '"), not a barber-performed service — exact (outlet, moka_item_id, moka_variant_id) match only.'
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1 FROM public.moka_item_mappings m
  WHERE m.moka_item_id = r.moka_item_id
    AND m.moka_variant_id = r.moka_variant_id
    AND m.outlet_id = r.outlet_id
);

COMMIT;
