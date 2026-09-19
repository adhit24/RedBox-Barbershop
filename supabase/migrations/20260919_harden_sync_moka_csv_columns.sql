-- Harden public.sync_moka_csv_columns(): API-synced rows must keep tx_date / outlet_slug.
--
-- Root cause: the trigger fired whenever "Receipt Number" was present and then overwrote
-- outlet_slug, tx_date, tx_time, net/gross/total_collected, payment_method, collected_by and
-- items_raw from CSV-only columns ("Outlet", "Date", "Time", "Items", ...). The Moka API sync
-- fills "Receipt Number" (and a few display columns) but not "Outlet"/"Date", so every API row
-- had tx_date and outlet_slug replaced with NULL.
--
-- New behaviour:
--   * "Receipt Number" blank            -> row untouched (unchanged).
--   * "Receipt Number" + "Date" + "Outlet" all present (a real CSV row)
--                                       -> exact legacy normalization (unchanged).
--   * otherwise (API row / partial CSV) -> each canonical column is assigned ONLY when its
--                                          CSV source field is non-blank; nothing is ever nulled.
-- Additive: function body replacement only. Trigger definition, table and data are unchanged.

CREATE OR REPLACE FUNCTION public.sync_moka_csv_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  if nullif(trim(new."Receipt Number"), '') is null then
    return new;
  end if;

  new.receipt_number := nullif(trim(new."Receipt Number"), '');

  if nullif(trim(new."Date"), '') is not null
     and nullif(trim(new."Outlet"), '') is not null then
    -- Full CSV row: legacy semantics, byte-for-byte.
    new.outlet_slug := case lower(trim(new."Outlet"))
      when 'redbox barbershop csb' then 'csb'
      when 'redbox barbershop sumber' then 'sumber'
      when 'redbox barbershop samadikun' then 'samadikun'
      when 'redbox barbershop bypass' then 'bypass'
      when 'redbox barbershop tegal' then 'tegal'
      else lower(regexp_replace(trim(new."Outlet"), '^redbox barbershop\\s+', ''))
    end;
    new.tx_date := to_date(nullif(trim(new."Date"), ''), 'DD-MM-YYYY');
    new.tx_time := new."Time";
    new.net_sales := coalesce(new."Net Sales", 0);
    new.gross_sales := coalesce(new."Gross Sales", 0);
    new.total_collected := coalesce(new."Total Collected", 0);
    new.payment_method := nullif(trim(new."Payment Method"), '');
    new.collected_by := nullif(trim(new."Collected By"), '');
    new.items_raw := nullif(trim(new."Items"), '');
    return new;
  end if;

  -- API row or partial CSV row: only fill a canonical column from a CSV field that is present.
  if nullif(trim(new."Outlet"), '') is not null then
    new.outlet_slug := case lower(trim(new."Outlet"))
      when 'redbox barbershop csb' then 'csb'
      when 'redbox barbershop sumber' then 'sumber'
      when 'redbox barbershop samadikun' then 'samadikun'
      when 'redbox barbershop bypass' then 'bypass'
      when 'redbox barbershop tegal' then 'tegal'
      else lower(regexp_replace(trim(new."Outlet"), '^redbox barbershop\\s+', ''))
    end;
  end if;
  if nullif(trim(new."Date"), '') is not null then
    new.tx_date := to_date(trim(new."Date"), 'DD-MM-YYYY');
  end if;
  if new."Time" is not null then new.tx_time := new."Time"; end if;
  if new."Net Sales" is not null then new.net_sales := new."Net Sales"; end if;
  if new."Gross Sales" is not null then new.gross_sales := new."Gross Sales"; end if;
  if new."Total Collected" is not null then new.total_collected := new."Total Collected"; end if;
  if nullif(trim(new."Payment Method"), '') is not null then new.payment_method := trim(new."Payment Method"); end if;
  if nullif(trim(new."Collected By"), '') is not null then new.collected_by := trim(new."Collected By"); end if;
  if nullif(trim(new."Items"), '') is not null then new.items_raw := trim(new."Items"); end if;
  return new;
end;
$$;
