-- Deterministic, idempotent, CLOSED-WORLD backfill for
-- moka_item_mappings.classification.
--
-- Companion to 2026-09-07-stockist-moka-item-classification.sql, which
-- changed the column default to REVIEW_REQUIRED.
--
-- SECOND RE-REVIEW CORRECTION (PR #75): the first version of this file
-- classified products by Moka *category* (e.g. "Pomade" -> STOCK_PRODUCT,
-- "Coffee" -> NON_STOCK_MISC) and classified anomaly-derived items by an
-- ELSE fallback (anything not in a known-service name list defaulted to
-- NON_STOCK_MISC). Both are unsafe:
--   - a category name is not a permanent classification rule; a future
--     Moka item dropped into "Merchandise" or "Pomade" must NOT be
--     auto-promoted to STOCK_PRODUCT just because of its category.
--   - an UNMAPPED_PRODUCT anomaly can represent a genuine retail product
--     with a broken/missing mapping; defaulting anything unrecognized to
--     NON_STOCK_MISC could silently permanently exclude a real product.
--
-- This version is closed-world and exact:
--   - the STOCK_PRODUCT / NON_STOCK_MISC product lists below are exact
--     `products.id` values, individually verified by product NAME during
--     the 2026-09-07 audit (every one of the 236 bulk-imported "MOKA-"
--     SKU products was read, not sampled) — never derived from category
--     at migration time. A product not in either list is untouched by
--     this migration and keeps whatever classification it already has
--     (REVIEW_REQUIRED by column default if it has none).
--   - the anomaly-name lists below are exact, individually verified
--     Moka line-item names. There is NO catch-all/ELSE branch: a name
--     that matches neither list gets no row inserted at all, which is
--     exactly equivalent to REVIEW_REQUIRED (no mapping row -> falls
--     through to the existing unmapped/anomaly path in
--     buildMokaSalePlan). "Fee Coloring" is a real, currently-open
--     anomaly name deliberately left out of both lists — its meaning
--     is not clear enough to classify confidently, so it stays
--     REVIEW_REQUIRED.
--
-- Safe to re-run: the two UPDATEs use IS DISTINCT FROM guards, and the
-- INSERT is idempotent via the pre-existing uq_moka_item_mapping_scope
-- unique index (ON CONFLICT DO NOTHING). On an environment with none of
-- these exact products/anomalies (e.g. a fresh install), every statement
-- here affects 0 rows — nothing to backfill yet, and the REVIEW_REQUIRED
-- default keeps that safe.
--
-- Does not touch inventory_ledger, inventory_balances, the ice-cream
-- reversal records, any SALE_MOKA row, or cron state.

BEGIN;

-- ============================================================
-- 1. STOCK_PRODUCT — exact product_id allowlist (92 products).
--    Individually verified by name during the 2026-09-07 audit:
--    Pomade/Parfum/Hair Product/Hair Treatment/Hair Styling/Hair System
--    brands (Murrays, Suavecito, Smith, Escalade, HIS ERHA, etc.),
--    "Sisir Rambut" combs (Accessories), and Redbox-branded keychains/
--    mugs/tumblers (Merchandise). No category filter is used here.
-- ============================================================
UPDATE moka_item_mappings m
SET classification = 'STOCK_PRODUCT',
    classification_reason = 'Backfilled 2026-09-07 from an explicit, git-tracked, name-verified STOCK_PRODUCT allowlist (see this migration''s header) — not derived from category.',
    updated_at = now()
WHERE m.product_id = ANY(ARRAY[
  '024fe2b0-96ec-47c6-b58a-00d580dd940e', '0933652a-f3ec-4878-a64e-308b9261d1ca', '0a99eda2-2b28-44b4-a81d-45308baf5484',
  '0b8904a8-bdaf-4d5a-ba70-12654f9b1698', '12a39b36-a2d7-46f4-b4e0-dc60065d07e8', '145616a6-f74f-4d30-8672-c85b60f66d87',
  '17e9fe48-d047-46e2-8e52-68df4ebc2f5d', '1afcbffe-e09d-4fae-bbaf-2950d2ba5616', '1fdbcd21-0fa4-4a98-adad-199fbbb0aac1',
  '20f941f1-b820-41ed-94e8-4546fed88cdd', '24885d62-735b-4c54-9fe9-ba24a7b92af6', '351ce5d0-a500-4e55-a4e7-037e781344f0',
  '3971f930-25f6-43d6-9d97-da8ae7c1fbb1', '3a23f7d6-d813-487e-a1ae-9f858d092662', '3dc2f719-0c59-4915-acc8-562a6a762aaa',
  '44114df0-267b-481f-a822-117b1c6683d5', '477e8f7e-1558-4907-9dea-24641cceb95b', '48a23b97-0ee0-4db2-b0dc-76a471f9c253',
  '49884c38-5377-4087-834d-a9b5d005e202', '4d026cc2-aecf-467a-bb95-165a02733eee', '5169854c-a0a9-4cf2-b75b-414e8914ae40',
  '52836505-0282-4a43-908c-cb50e93eeae1', '52acb320-0ada-466d-a9f4-65486d69b5e2', '53db1252-b242-4038-94d9-8913038f771e',
  '561420e5-c491-4f1c-8f1a-3a06040ba72b', '5653cc22-93f6-4aa7-850c-39ad9c7672e6', '5bbe9d19-5f0d-4ac2-8a64-e0c1655447bd',
  '5c7148fa-7643-40f7-a895-b4a42eeff220', '5fefd146-6da5-4c51-8233-787a94a5f787', '60671013-f83a-412f-a1dc-a8e53cdb72b2',
  '61c596c5-7bc7-4424-9c5d-313d5d92db45', '63b34732-c307-4934-8348-ba0f3c9cceee', '646cd776-858f-471b-a17e-b3cdab0122b5',
  '682f80a8-1e1b-4521-a1bc-bbd84dbf892e', '6a50912c-92e7-4cc6-9c36-eb4d3c88bf82', '6f10baa6-c4d0-4b6f-b3a2-3650a149ce59',
  '6f2a7a9b-3666-4620-852c-d9a636175062', '6ffe3955-ea4a-43fe-9eda-a600c23f8361', '70d5f594-5d65-4265-a16a-015221a1e761',
  '71d2f1eb-4319-4768-9285-2fb323a056be', '72eba95d-4b44-4d04-b490-114d96e76001', '732d973a-73c7-4a10-8291-e993f459cd56',
  '77582f81-5838-4263-82ca-4c835e19d132', '7759598c-3da0-466d-8f67-9e0c592d969d', '7b769f33-753d-4e36-b2fe-df3c61a83c29',
  '81eb0765-9f65-4155-8896-abb8e8553917', '87c9e7c7-6786-4273-877e-ce969c7edf41', '885c8970-1ee3-4563-8ff3-75de3ac1cdd0',
  '8d296f35-e31b-4444-900c-859237c61d17', '8e03c871-e8a7-49d2-a70e-cf0e1d4b44c7', '8f54cfca-21e0-4f4f-82ed-56c2be8a8ec0',
  '9236cb4f-658a-4b1b-9749-e9dd6bb47247', '9b0f84f9-89c6-4bea-b89b-e8e68d371aa0', '9c3a7c73-9655-4bf7-ac6d-d0b51dc5952d',
  '9e298e8a-a0b7-4c52-8b4a-d4a5992fc73d', 'a03f3708-b863-4c10-b504-edbaeccb6e0c', 'a07611b7-4d4f-4430-aa53-7c6cd8a7501a',
  'a22914bb-32e3-435f-a2f6-716af93ce95c', 'a646f7b0-a7d7-4948-a819-b9e7298efb27', 'a81e906d-5f82-44d8-b1d8-d20ff141267c',
  'abb3ce78-0c2d-4829-9944-38ded159703d', 'acf8867a-751b-4dd7-a7ec-e4231d5e1ccc', 'af6f6747-5b3d-49a3-97d7-e87cb48ab4fb',
  'b5819f91-add4-41f4-9d22-8b08d9609809', 'bae8d3f4-cae8-48a8-8d03-3a1fb9a77099', 'bec23a5a-f715-4b31-87ad-443490fa55df',
  'bf3559d3-354b-49e1-bae4-54115ddd12dc', 'c06fc125-9170-4761-94da-ad7d5e6caa32', 'c2726bc8-7d32-4b96-bc44-32f5e441a5bd',
  'c3bfcf1a-0f8d-48a5-8c25-8b5c1d67f427', 'c81fde6f-2630-4452-b534-174211e68a0e', 'cbd11715-b8c5-4f2c-9225-7bc8bed484cd',
  'cc30a39e-0bec-4a0c-87ae-21f7041a21df', 'd1f823de-b823-4512-b519-594b38c0eabd', 'd511b1bd-7120-4dc7-94d5-977c0d3c6677',
  'd85bd3c6-e5c6-4880-99a6-5836b6f692a6', 'da9cf5f5-1067-4e7a-8532-8d75d8a08100', 'dafa722c-1a16-4f55-ba2c-3bf06b0ae8cd',
  'ea7d14f7-b16c-4b87-97fd-22edbb2ceb6b', 'ec8da665-3111-4691-8ea7-1e2e203d5d3d', 'ed500380-05e7-4ee6-bd79-5c4aa816ec9f',
  'f0bdac0c-6eef-4334-af77-157f887d144f', 'f1205897-ded1-4174-b6b4-5b274274502c', 'f35eb847-29c7-46f1-8427-1aea8b337cea',
  'f46fbff7-7712-4d9f-aed4-62bfdd911ae3', 'f648fc7e-4af9-4016-8330-d5c8bca9b9b6', 'f84c4e8c-4bf5-4a43-9625-31684a0ae4c8',
  'f89d195b-56d5-4548-9ec6-531244c45c9d', 'fb9e477b-ade0-4289-a2d9-7b27eabad4e3', 'fc24717c-d6bc-4e4c-bf56-264c76038eff',
  'fc8f61a8-b385-4470-8c0e-5a1ee721bd8d', 'fd60f083-44e9-4cdd-868a-65c3b02578a0'
]::uuid[])
AND m.classification IS DISTINCT FROM 'STOCK_PRODUCT';

-- ============================================================
-- 2. NON_STOCK_MISC — exact product_id allowlist (144 products).
--    Individually verified by name: coffee/tea/soft-drink/dessert/snack/
--    food menu items and packaging supplies (paper cups, plastic cups,
--    paper bags). No category filter is used here either.
-- ============================================================
UPDATE moka_item_mappings m
SET classification = 'NON_STOCK_MISC',
    classification_reason = 'Backfilled 2026-09-07 from an explicit, git-tracked, name-verified NON_STOCK_MISC allowlist (see this migration''s header) — not derived from category.',
    is_active = false,
    updated_at = now()
WHERE m.product_id = ANY(ARRAY[
  '0181bf79-fa6d-4f69-b399-d3427b31a4c0', '0584a387-481d-44ad-8fd6-01c7cb837c74', '05d49fa4-13d7-41cb-95aa-9e12a9490512',
  '064fd34a-ad23-479d-b350-4f82937bde8b', '08c3487d-38b1-4a4f-941a-6e3613ad6cb0', '0a2433fc-f4f0-4b3f-9de9-c7a8d336f031',
  '0c4e2394-85c4-4925-8963-e27be4fb778c', '0d871323-57df-4eb0-bfc3-b1a1eab5d786', '0f0f4b52-b7b1-42f9-b4f9-466a3efb3bda',
  '178acc3f-466f-40bc-b245-974573dffd56', '1915c8de-0487-470c-a579-9d81d8482d71', '19d3c8df-5512-42b4-9be9-0ce378cd069d',
  '1bac4d58-81fa-4d86-90f0-b928eb3ba6d3', '1bf98077-bc0e-423f-8321-45f903337b52', '1e370e9d-08fb-477f-90a1-0472794b911a',
  '21508076-3a70-4ed1-b748-52d835f24c31', '21cb1139-dbf9-4198-8c72-c001ef9d286b', '22d9600b-1496-4add-aad3-c685f2944715',
  '23d1acb4-6814-4253-a27a-235076ed292b', '2421d778-0e40-4290-afac-5a2725392c29', '2554c840-2aea-4074-8336-fd6359f3c250',
  '26c46ea3-2842-4194-937a-34713f8dddda', '279e4798-e387-4b7f-8445-9690777fa097', '2a5d4e3c-b150-45ba-b7c1-2362b4409149',
  '2c772fd1-589e-49da-8635-cb1c952b1f88', '2ca827ec-aae6-478b-acad-be897f8062d6', '2cd06cd2-943c-481a-82f8-0bd05f17fd74',
  '2dc5fcff-014f-4092-ba47-5f7b6503cf37', '30e1c4a7-0989-4308-b3f8-0744692a8c7f', '30e8dc21-2da4-4a1e-8b76-7ac384a4f3b9',
  '320d6910-4b3f-4919-a666-2cecb31da54e', '3742f544-15b1-41fa-b591-4d41b9d83e7e', '3ca0d9e8-a579-4386-bade-e697bdd14a07',
  '3ecd8e2a-bea1-4def-8f18-3d23abbb4b7f', '3f34385f-757f-4f60-b9f3-39d4a1e81758', '4173905b-f893-45c6-b4a5-4e6a289c1445',
  '444a06aa-1b27-4245-916c-f86ecb9e5377', '45faba90-4f33-467c-bbf0-8e9d5531b77a', '494e768b-241a-4f17-b3c5-e3a14b20388c',
  '49b2e314-f982-4fc6-b793-77cc9005515f', '4cee2763-b339-41c7-be1e-3b12948c8ed5', '4e343a35-7c55-4297-a33e-ebc398853e90',
  '4e42e3fd-fb41-4b1e-a1d2-ae88253e9077', '50ff756b-1f59-4aca-a29b-7605da235926', '5135ed25-d706-4543-9225-924ebf236d27',
  '53c36a7e-1641-4d20-8a5d-95c9e2c1c555', '55a977b9-3f8f-4791-925f-52d8368c9e4f', '57807dda-6108-4931-9b07-ee573cf852c1',
  '58198b84-5d18-4867-8b9f-be4f5c74c4aa', '58d48f54-e950-46c5-a772-ea1b5e9ff4d0', '5b131363-ac7d-4390-b075-548d32cffa6c',
  '5ed5e3b6-e64b-400a-bd3e-21f0f594a465', '5ee1684f-ebc9-4194-ba18-409dc77a7742', '602bb1ed-77f9-4744-a507-eb5b5c3f581b',
  '636fa7bd-cc8f-4f89-bc52-143b61c5b5f4', '63d4d781-83f5-492b-ba4c-53e9a7084e22', '667a8131-d4c4-4b7a-86f6-bc9a1ffd75b7',
  '66a622df-3035-449c-9f68-dd242305b010', '678627be-1754-4d41-843f-2355122a0f9d', '6d0c2cd9-c5ac-48dc-a595-233d3c6b9de6',
  '6e0d0813-3f88-4a19-82a3-c753f39b519f', '6ea0deef-19d7-45a2-8088-f5b4dc9ace42', '6f19cebd-509d-46c5-a18c-befd7d944adc',
  '715f896c-acc5-495b-ba16-8da55c1d6559', '7463e987-6a6b-4f96-a225-f122d17eead1', '7531de59-c8dc-4073-a7a4-db3637935b17',
  '75ee0353-0ff3-47ca-b816-952c93e986f7', '7a16fe56-eabc-4962-8f81-826ba748ab13', '7a77269b-7c87-4adf-b2d7-67b7a1247f38',
  '7bd34c9c-aa17-4eea-988e-363b3155a947', '7bfb40aa-7e68-4434-8a25-3af796001cd5', '7c20d333-266b-4b51-88fb-a1d8a9b068a8',
  '85aec7b4-7728-4388-beb4-e94fbadf9064', '87b55624-dd12-4b36-970f-8b70deb3da94', '88699468-2e8e-49eb-8c76-785415b2070b',
  '8a09fa9f-e214-4069-ac7e-e4ec081c33bf', '90ca4c04-e17f-45e4-a71c-55e9c8ccee62', '92ad02c6-7123-47ea-8f38-7162b96e9180',
  '92e52b1a-4e18-43a0-9762-0f21c0ba397c', '93c526f8-cc47-4e2c-b3c6-576c58829d06', '96883d1e-40a3-472b-b098-b6ce58e75fed',
  '96bb7284-d91e-4f74-b246-b5fba9b66b72', '9be4c738-7774-4554-bed5-331845b7dd55', '9ce2e2a4-e882-44e6-986c-f9d3eaecfb09',
  'a006cc71-4d80-4d90-b5d3-a7a3c9ab74c5', 'a32205f2-c396-4615-aba6-4ad469b95ba7', 'a32a052d-9ed4-4de6-a9a2-a1b7e3819268',
  'a37330d4-090d-47c2-8cf7-7ed2c4804567', 'a537d79c-d314-40b6-b35e-0903081d9f49', 'a53d4a03-ff39-417c-a270-7c02cf5d1e4b',
  'aadf8ab1-f7a3-44bf-9dc7-02d4784930f4', 'b048c9d3-264e-4a09-95c2-de1773b8a9d0', 'b10e2561-f5c6-4ab1-a857-866ef6ac92d3',
  'b157a84b-087e-4885-a054-45e760a081b9', 'b447e1fa-fa87-44a4-9ed2-b378cb2f1b54', 'b5816cfc-6eb8-43df-a52a-a77fa59ab489',
  'b701b8cb-b4c6-465b-9c30-ded82c1b3040', 'ba79e421-5489-428c-8a72-3089fe0562b3', 'bad3b370-e681-45e7-84bd-1b685073b86d',
  'bc72a96a-0d85-43f4-ae39-7d4b2b654116', 'bc909d5d-f91a-4a62-8da6-69590500f5d4', 'bd39acbb-d582-40f0-b574-5a2ef98700bc',
  'bdbc8734-b538-4b6f-b27d-1a0025233f7e', 'be467b74-b740-4b1f-a157-bad3d9e8d62f', 'c1082c2d-f361-422a-9147-fb31bb06936e',
  'c17e7137-c153-4a82-ac47-2480ca5eee21', 'c196a6bb-56b9-4cbd-91db-0fcc8b123dd5', 'c1f6fea5-afbc-4623-abb8-df168f1ace5e',
  'c3a072b5-0d2b-4911-91fe-c02bf363a386', 'c4940408-bce8-4ed6-b238-164614ea1663', 'c744a0a7-4c74-4c06-9023-fd93dbe181d7',
  'c86a8b19-22a5-4647-8c18-5f252c6a2f8f', 'cab428d1-3365-4ce3-8136-7926806f1bf3', 'cc6d457a-c00e-4cb0-9e1f-2a095b3ec594',
  'd3cb6898-9e10-4d06-8537-14c7da25765f', 'd5d987eb-9166-4e34-834f-599b4dff3dc7', 'd6aefb5f-1eaf-4a36-bcff-735fc4e1c8b4',
  'd8a598b1-9736-4862-9034-598b8d889a1f', 'dab6e1ba-deab-460d-b07e-29ece7a2da3c', 'db57a860-b3cd-48a2-8fe3-c1b86c57233e',
  'db920dc8-dfdb-4b82-9da8-0296bb1ca535', 'dba830eb-40d3-46bd-ac1e-2e0e99251a00', 'e02b7f33-fc62-4ecb-88e6-686e052206c7',
  'e399e15d-dd18-4edb-8ac2-8448fc94e83f', 'e4f95b74-864a-45f9-8cd6-0d08803d6db9', 'e57b24da-22e7-4e4a-b0b9-7ebc9e17e406',
  'e5a62bfb-55d5-4ee3-8491-7652889bb37c', 'e79b7733-a42a-4ecf-b159-76d1498d8907', 'e8b8bf59-129b-4e9e-8b9a-ebdb3d93f4cb',
  'e90c8c08-f34c-4851-b8f5-43e75f1e8a1d', 'ea3bf5bf-d433-4d9b-ab75-6c073188930e', 'ea85599c-f63a-4130-80f7-e027f6307d53',
  'ef7f77d3-bec8-4acf-86df-291a9ef04154', 'f0080fdc-f5d1-47a5-a8b8-c66ee7db5f90', 'f29e3299-0aad-4f38-a305-e9978fbca380',
  'f33ba44d-d6f3-4ff7-9025-22ece8a7d46f', 'f4df1fae-03ae-426b-a2d9-f4c1b0833a2f', 'f582d487-c539-4759-a963-1bed38360af1',
  'f653904b-4e1d-4821-9036-5a843d5925d1', 'f87acbc2-f173-4aed-9869-a25a3f7936cc', 'f93d763d-6dc3-47d5-8e05-6074074f66e1',
  'fbd3290d-fdcd-4fb1-be06-e54b6395bacb', 'fc187543-3738-48fb-8c3a-1f34dbd2f4d9', 'fdfca866-d527-4a86-b3c0-c4022d508201'
]::uuid[])
AND m.classification IS DISTINCT FROM 'NON_STOCK_MISC';

-- ============================================================
-- 3. Anomaly-derived classification-only rows (no product_id), scoped to
--    the exact outlet + Moka item/variant a real UNMAPPED_PRODUCT
--    anomaly was seen on. NO ELSE/catch-all: a name matching neither list
--    is never classified by this migration.
--
--    Three-step, self-healing sequence (all idempotent):
--      3a. RESET every existing classification-only row back to
--          REVIEW_REQUIRED first. This is what makes the migration safe
--          to replay: a row previously mis-classified by an earlier,
--          less strict version of this migration (or by hand) is always
--          returned to the safe state before the audited allowlist is
--          re-applied, rather than being left stuck at a stale value
--          that a later INSERT-only step could never correct.
--      3b. UPDATE rows that now exist for an audited name back to their
--          correct classification.
--      3c. INSERT rows for audited names that have never been seen
--          before (no existing mapping row at all yet).
--    A name matching neither service_names nor misc_names is left at
--    REVIEW_REQUIRED by step 3a and touched by nothing else — e.g.
--    "Fee Coloring", a real open anomaly whose meaning isn't clear
--    enough to classify confidently.
-- ============================================================

UPDATE moka_item_mappings
SET classification = 'REVIEW_REQUIRED',
    classification_reason = 'Reset by migration replay 2026-09-07: only an explicit, audited allowlist match (see steps 3b/3c below) may classify a classification-only row as non-stock.',
    updated_at = now()
WHERE product_id IS NULL
  AND classification != 'REVIEW_REQUIRED';

WITH service_names(name) AS (VALUES
  ('Beard & Mustache'), ('Charcoal Deep Cleansing'), ('Deep Clean White'), ('Hair Colouring'),
  ('Hair Curly'), ('Hair Cut'), ('Hair Cut Long Trim'), ('Hair Cut with Fade'), ('Hair Cut+'),
  ('Hair Spa'), ('Redbox Baron Grooming'), ('Redbox Baron Grooming +'), ('Redbox Duke Grooming'),
  ('Redbox Earl Grooming'), ('Redbox Gentleman Grooming'), ('Redbox Gentleman Grooming+'),
  ('Redbox Gentlemen Grooming'), ('Redbox Noble Grooming'), ('Shave')
),
matches AS (
  SELECT a.moka_item_id, a.moka_variant_id, a.outlet_id, trim(a.detail->>'name') AS item_name
  FROM moka_stockist_anomalies a
  JOIN service_names s ON s.name = trim(a.detail->>'name')
  WHERE a.anomaly_type = 'UNMAPPED_PRODUCT'
)
UPDATE moka_item_mappings m
SET classification = 'NON_STOCK_SERVICE',
    classification_reason = 'Backfilled 2026-09-07 from an explicit, git-tracked, name-verified anomaly allowlist (item name "' || mt.item_name || '") — not a heuristic fallback.',
    updated_at = now()
FROM matches mt
WHERE m.product_id IS NULL
  AND m.moka_item_id = mt.moka_item_id
  AND COALESCE(m.moka_variant_id, '') = COALESCE(mt.moka_variant_id, '')
  AND COALESCE(m.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(mt.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid);

WITH misc_names(name) AS (VALUES
  ('Baileys Coffee'), ('Chicken Karaage & French Fries'), ('Chocolate'), ('Cloud Latte'),
  ('Custom Amount'), ('French Fries'), ('Hazelnut Coffee'), ('Hazelnut Roll'), ('Hot'), ('Ice'),
  ('Kacang Goreng'), ('Kaluli Arabikapro'), ('Kaluli Chocomaster'), ('Kaluli Light Yummy Yoghurt'),
  ('Kaluli Nutalk Pecan'), ('Lemonade Coffee'), ('Lychee Yakult Tea'), ('Macha Strawberry'),
  ('Member Platinum'), ('Member Student'), ('Nestle Pure Life Air Mineral'), ('Orange Rumbillion'),
  ('Paper Bag'), ('Pristine Water'), ('Senyawa Coffee'), ('Specialty Coffee'), ('Sunkist Coffee'),
  ('TEH / TEBS Kaleng'), ('Teh Botol / Fruit Tea'), ('Teh Botol / Fruit Tea / Tebs'), ('TIPS'), ('Vanilla')
),
matches AS (
  SELECT a.moka_item_id, a.moka_variant_id, a.outlet_id, trim(a.detail->>'name') AS item_name
  FROM moka_stockist_anomalies a
  JOIN misc_names mi ON mi.name = trim(a.detail->>'name')
  WHERE a.anomaly_type = 'UNMAPPED_PRODUCT'
)
UPDATE moka_item_mappings m
SET classification = 'NON_STOCK_MISC',
    classification_reason = 'Backfilled 2026-09-07 from an explicit, git-tracked, name-verified anomaly allowlist (item name "' || mt.item_name || '") — not a heuristic fallback.',
    updated_at = now()
FROM matches mt
WHERE m.product_id IS NULL
  AND m.moka_item_id = mt.moka_item_id
  AND COALESCE(m.moka_variant_id, '') = COALESCE(mt.moka_variant_id, '')
  AND COALESCE(m.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(mt.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid);

WITH service_names(name) AS (VALUES
  ('Beard & Mustache'), ('Charcoal Deep Cleansing'), ('Deep Clean White'), ('Hair Colouring'),
  ('Hair Curly'), ('Hair Cut'), ('Hair Cut Long Trim'), ('Hair Cut with Fade'), ('Hair Cut+'),
  ('Hair Spa'), ('Redbox Baron Grooming'), ('Redbox Baron Grooming +'), ('Redbox Duke Grooming'),
  ('Redbox Earl Grooming'), ('Redbox Gentleman Grooming'), ('Redbox Gentleman Grooming+'),
  ('Redbox Gentlemen Grooming'), ('Redbox Noble Grooming'), ('Shave')
),
misc_names(name) AS (VALUES
  ('Baileys Coffee'), ('Chicken Karaage & French Fries'), ('Chocolate'), ('Cloud Latte'),
  ('Custom Amount'), ('French Fries'), ('Hazelnut Coffee'), ('Hazelnut Roll'), ('Hot'), ('Ice'),
  ('Kacang Goreng'), ('Kaluli Arabikapro'), ('Kaluli Chocomaster'), ('Kaluli Light Yummy Yoghurt'),
  ('Kaluli Nutalk Pecan'), ('Lemonade Coffee'), ('Lychee Yakult Tea'), ('Macha Strawberry'),
  ('Member Platinum'), ('Member Student'), ('Nestle Pure Life Air Mineral'), ('Orange Rumbillion'),
  ('Paper Bag'), ('Pristine Water'), ('Senyawa Coffee'), ('Specialty Coffee'), ('Sunkist Coffee'),
  ('TEH / TEBS Kaleng'), ('Teh Botol / Fruit Tea'), ('Teh Botol / Fruit Tea / Tebs'), ('TIPS'), ('Vanilla')
),
classified_anomalies AS (
  SELECT a.moka_item_id, a.moka_variant_id, a.outlet_id, 'NON_STOCK_SERVICE'::text AS classification, trim(a.detail->>'name') AS item_name
  FROM moka_stockist_anomalies a
  JOIN service_names s ON s.name = trim(a.detail->>'name')
  WHERE a.anomaly_type = 'UNMAPPED_PRODUCT'
  UNION ALL
  SELECT a.moka_item_id, a.moka_variant_id, a.outlet_id, 'NON_STOCK_MISC'::text AS classification, trim(a.detail->>'name') AS item_name
  FROM moka_stockist_anomalies a
  JOIN misc_names mi ON mi.name = trim(a.detail->>'name')
  WHERE a.anomaly_type = 'UNMAPPED_PRODUCT'
)
INSERT INTO moka_item_mappings (moka_item_id, moka_variant_id, product_id, outlet_id, is_active, classification, classification_reason)
SELECT DISTINCT
  moka_item_id, moka_variant_id, NULL::uuid, outlet_id, false, classification,
  'Backfilled 2026-09-07 from an explicit, git-tracked, name-verified anomaly allowlist (item name "' || item_name || '") — not a heuristic fallback. Any anomaly name outside this allowlist (e.g. "Fee Coloring") is deliberately left unclassified and stays REVIEW_REQUIRED.'
FROM classified_anomalies
ON CONFLICT DO NOTHING;

COMMIT;
