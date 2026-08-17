-- server/migrations/2026-08-17-stockist-notifications.sql
-- Anti-spam state for low-stock push notifications: tracks the last known
-- status (NORMAL/LOW) and when a branch was last alerted per product, so a
-- product that stays low doesn't re-notify on every single movement, but
-- does notify again after it recovers to NORMAL and dips again, or after a
-- cooldown window if nobody has acted on the earlier alert yet.
-- Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS stock_alert_state (
  product_id      UUID NOT NULL REFERENCES products(id),
  location_id     UUID NOT NULL REFERENCES inventory_locations(id),
  last_status     TEXT NOT NULL DEFAULT 'NORMAL' CHECK (last_status IN ('NORMAL', 'LOW')),
  last_alerted_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, location_id)
);

CREATE OR REPLACE TRIGGER trg_stock_alert_state_updated
  BEFORE UPDATE ON stock_alert_state FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stock_alert_state FROM anon, authenticated;

COMMIT;
