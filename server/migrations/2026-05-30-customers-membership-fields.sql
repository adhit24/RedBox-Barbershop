-- ================================================================
-- Migration: tambah kolom membership ke tabel customers
-- Supaya OTP login bisa menyimpan membership_status yang disync
-- dari member_profiles (cross-reference fix untuk duplikat akun).
-- Run di Supabase SQL Editor — aman di-run berulang kali.
-- ================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS membership_status        TEXT DEFAULT 'INACTIVE'
    CHECK (membership_status IN ('ACTIVE', 'INACTIVE')),
  ADD COLUMN IF NOT EXISTS membership_activated_at  TIMESTAMPTZ;

-- Backfill: sinkronkan membership_status dari member_profiles
-- berdasarkan phone_e164 ↔ member_profiles.phone
UPDATE customers c
SET
  membership_status        = mp.membership_status,
  membership_activated_at  = mp.membership_activated_at
FROM member_profiles mp
WHERE mp.phone = c.phone_e164
  AND mp.membership_status = 'ACTIVE'
  AND c.membership_status  = 'INACTIVE';
