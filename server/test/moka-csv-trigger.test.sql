-- Behavioural tests for public.sync_moka_csv_columns().
-- Runs against a TEMP table cloned from moka_transactions, so nothing in production is written.
-- Each case raises an exception on failure; a clean run ends with a result row of 'ALL PASS'.
-- Run: paste into the Supabase SQL editor (or execute_sql).
DO $$
DECLARE r public.moka_transactions%ROWTYPE;
BEGIN
  CREATE TEMP TABLE t_moka (LIKE public.moka_transactions INCLUDING DEFAULTS) ON COMMIT DROP;
  ALTER TABLE t_moka ALTER COLUMN receipt_number DROP NOT NULL, ALTER COLUMN outlet_slug DROP NOT NULL, ALTER COLUMN tx_date DROP NOT NULL;
  CREATE TRIGGER trg_t BEFORE INSERT OR UPDATE ON t_moka FOR EACH ROW EXECUTE FUNCTION public.sync_moka_csv_columns();

  -- 1. API row: canonical columns populated, CSV source fields absent -> canonical values preserved
  INSERT INTO t_moka (receipt_number, outlet_slug, tx_date, tx_time, net_sales, gross_sales, total_collected, payment_method, collected_by, items_raw, "Receipt Number", "Net Sales", "Gross Sales")
  VALUES ('api-1', 'csb', '2026-09-18', '10:00:00', 90000, 100000, 90000, 'Cash', 'Kasir', '[]', 'api-1', 90000, 100000);
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'api-1';
  IF r.outlet_slug IS DISTINCT FROM 'csb' THEN RAISE EXCEPTION 'API row: outlet_slug clobbered (%)', r.outlet_slug; END IF;
  IF r.tx_date IS DISTINCT FROM DATE '2026-09-18' THEN RAISE EXCEPTION 'API row: tx_date clobbered (%)', r.tx_date; END IF;
  IF r.tx_time IS DISTINCT FROM '10:00:00' OR r.collected_by IS DISTINCT FROM 'Kasir' OR r.items_raw IS DISTINCT FROM '[]' OR r.total_collected IS DISTINCT FROM 90000 THEN
    RAISE EXCEPTION 'API row: tx_time/collected_by/items_raw/total_collected clobbered'; END IF;

  -- 2. UPDATE of an API row preserves canonical values
  UPDATE t_moka SET net_sales = 95000, "Net Sales" = 95000 WHERE receipt_number = 'api-1';
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'api-1';
  IF r.outlet_slug IS DISTINCT FROM 'csb' OR r.tx_date IS DISTINCT FROM DATE '2026-09-18' THEN RAISE EXCEPTION 'UPDATE clobbered API tx_date/outlet_slug'; END IF;
  IF r.net_sales IS DISTINCT FROM 95000 THEN RAISE EXCEPTION 'UPDATE lost net_sales'; END IF;

  -- 3. Full CSV row: canonical columns derived exactly as before
  INSERT INTO t_moka ("Receipt Number", "Outlet", "Date", "Time", "Net Sales", "Gross Sales", "Total Collected", "Payment Method", "Collected By", "Items")
  VALUES (' csv-1 ', 'Redbox Barbershop Sumber', '05-09-2026', '12:30:00', 80000, 90000, 80000, ' QRIS ', ' Ani ', ' Haircut ');
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'csv-1';
  IF r.outlet_slug IS DISTINCT FROM 'sumber' OR r.tx_date IS DISTINCT FROM DATE '2026-09-05' OR r.tx_time IS DISTINCT FROM '12:30:00'
     OR r.net_sales IS DISTINCT FROM 80000 OR r.gross_sales IS DISTINCT FROM 90000 OR r.total_collected IS DISTINCT FROM 80000
     OR r.payment_method IS DISTINCT FROM 'QRIS' OR r.collected_by IS DISTINCT FROM 'Ani' OR r.items_raw IS DISTINCT FROM 'Haircut' THEN
    RAISE EXCEPTION 'CSV row not normalized as before: %', row_to_json(r); END IF;

  -- 4. Legacy CSV null money columns still coalesce to 0 (historical semantics)
  INSERT INTO t_moka ("Receipt Number", "Outlet", "Date") VALUES ('csv-2', 'Redbox Barbershop Tegal', '06-09-2026');
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'csv-2';
  IF r.outlet_slug IS DISTINCT FROM 'tegal' OR r.tx_date IS DISTINCT FROM DATE '2026-09-06' OR r.net_sales IS DISTINCT FROM 0 OR r.gross_sales IS DISTINCT FROM 0 OR r.total_collected IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'CSV coalesce semantics changed: %', row_to_json(r); END IF;

  -- 5. Partial CSV fields ("Receipt Number" + "Outlet" only, no "Date") never null canonical columns
  INSERT INTO t_moka (receipt_number, outlet_slug, tx_date, "Receipt Number", "Outlet")
  VALUES ('part-1', 'bypass', '2026-09-10', 'part-1', 'Redbox Barbershop CSB');
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'part-1';
  IF r.tx_date IS DISTINCT FROM DATE '2026-09-10' THEN RAISE EXCEPTION 'partial CSV (no Date) nulled tx_date'; END IF;
  IF r.outlet_slug IS DISTINCT FROM 'csb' THEN RAISE EXCEPTION 'partial CSV should apply the Outlet it does have (%)', r.outlet_slug; END IF;

  -- 6. Partial CSV fields ("Receipt Number" + "Date" only, no "Outlet")
  INSERT INTO t_moka (receipt_number, outlet_slug, tx_date, "Receipt Number", "Date")
  VALUES ('part-2', 'tegal', '2026-09-10', 'part-2', '11-09-2026');
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'part-2';
  IF r.outlet_slug IS DISTINCT FROM 'tegal' THEN RAISE EXCEPTION 'partial CSV (no Outlet) nulled outlet_slug'; END IF;
  IF r.tx_date IS DISTINCT FROM DATE '2026-09-11' THEN RAISE EXCEPTION 'partial CSV should apply the Date it does have (%)', r.tx_date; END IF;

  -- 7. Row without "Receipt Number" is untouched (legacy behaviour)
  INSERT INTO t_moka (receipt_number, outlet_slug, tx_date) VALUES ('plain-1', 'csb', '2026-09-12');
  SELECT * INTO r FROM t_moka WHERE receipt_number = 'plain-1';
  IF r.outlet_slug IS DISTINCT FROM 'csb' OR r.tx_date IS DISTINCT FROM DATE '2026-09-12' THEN RAISE EXCEPTION 'plain row modified'; END IF;

  RAISE NOTICE 'ALL PASS';
END $$;
SELECT 'ALL PASS' AS result;
