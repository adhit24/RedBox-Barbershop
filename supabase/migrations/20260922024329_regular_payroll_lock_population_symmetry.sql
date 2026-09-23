-- ====================================================================================================
-- Migration: 20260922024329_regular_payroll_lock_population_symmetry.sql
-- Purpose: Repo-only bookkeeping / history-alignment entry. No schema operation.
--
-- Context: when 20260922040000_regular_payroll_lock_population_symmetry.sql was applied to production
-- Supabase (khcvklzxfohwkyocenaf) via Supabase MCP, the MCP tooling recorded its OWN remote migration
-- history entry (version 20260922024329, name "regular_payroll_lock_population_symmetry") IN ADDITION
-- TO the version that migration's own SQL inserts into supabase_migrations.schema_migrations
-- (20260922040000, inserted by that file's final INSERT ... ON CONFLICT DO NOTHING statement).
--
-- Production migration history therefore now legitimately contains BOTH:
--   20260922024329  (name: regular_payroll_lock_population_symmetry)
--   20260922040000
--
-- The schema itself is correct and was only ever mutated once by that migration (and, forward-only, by
-- 20260922060000_regular_payroll_workforce_revision.sql). This file exists purely so the local
-- repository's migration file list matches that remote history 1:1 -- it performs NO schema change,
-- re-applies NOTHING, and must never be edited to add real DDL. Any future schema change belongs in
-- its own new forward-only migration file.
--
-- (Mirrors the identical bookkeeping pattern already used for the two prior rounds' MCP-recorded
-- entries: 20260921235256_20260921140000_generalize_payroll_snapshot_concurrency.sql and
-- 20260922022232_20260922000000_regular_payroll_population_reconciliation.sql.)
-- ====================================================================================================

BEGIN;

-- Intentionally no-op: see header comment above.

COMMIT;
