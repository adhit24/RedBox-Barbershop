-- ====================================================================================================
-- Migration: 20260921235256_20260921140000_generalize_payroll_snapshot_concurrency.sql
-- Purpose: Repo-only bookkeeping / history-alignment entry. No schema operation.
--
-- Context: when 20260921140000_generalize_payroll_snapshot_concurrency.sql was applied to production
-- Supabase (khcvklzxfohwkyocenaf) via Supabase MCP, the MCP tooling recorded its OWN remote migration
-- history entry (version 20260921235256, name
-- "20260921140000_generalize_payroll_snapshot_concurrency") IN ADDITION TO the version the migration's
-- own SQL inserts into supabase_migrations.schema_migrations (20260921140000, inserted by that file's
-- final INSERT ... ON CONFLICT DO NOTHING statement).
--
-- Production migration history therefore now legitimately contains BOTH:
--   20260921140000
--   20260921235256  (name: 20260921140000_generalize_payroll_snapshot_concurrency)
--
-- The schema itself is correct and was only ever mutated once, by 20260921140000. This file exists
-- purely so the local repository's migration file list matches that remote history 1:1 -- it performs
-- NO schema change, re-applies NOTHING, and must never be edited to add real DDL. Any future schema
-- change belongs in its own new forward-only migration file.
-- ====================================================================================================

BEGIN;

-- Intentionally no-op: see header comment above.

COMMIT;
