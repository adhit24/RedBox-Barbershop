-- server/migrations/2026-08-24-stockist-notifications-inbox.sql
-- Persisted in-app notification inbox — one row per notification per
-- recipient, written alongside the existing push-notification sends in
-- server/services/stockistNotifications.js so users can browse history,
-- not just receive a transient push. Safe to re-run (idempotent).

BEGIN;

CREATE TABLE IF NOT EXISTS stockist_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('Stok', 'Transfer', 'Pengiriman', 'Sistem', 'Pengumuman')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stockist_notifications_user_created
  ON stockist_notifications (user_id, created_at DESC);

ALTER TABLE stockist_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE stockist_notifications FROM anon, authenticated;

COMMIT;
