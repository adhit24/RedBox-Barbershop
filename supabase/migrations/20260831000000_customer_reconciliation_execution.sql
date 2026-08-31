-- Task 17.3.2 — Moka Customer Duplicate Reconciliation Execution Schema & Ledger Migration Scaffolding
-- DO NOT APPLY TO PRODUCTION DURING TASK 17.3.2. TRACKED MIGRATION DEFINITION ONLY.

-- 1. Add customer retirement columns to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS merged_into_customer_id UUID NULL REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ NULL;

-- Ensure self-merge is prohibited at database level
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_no_self_merge'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT chk_customers_no_self_merge
      CHECK (merged_into_customer_id IS NULL OR merged_into_customer_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_merged_into_customer_id ON customers(merged_into_customer_id) WHERE merged_into_customer_id IS NOT NULL;

-- 2. Create Reconciliation Ledger Table
CREATE TABLE IF NOT EXISTS customer_reconciliation_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_key TEXT UNIQUE NOT NULL,
  moka_group_hash TEXT NOT NULL,
  classification TEXT NOT NULL,
  canonical_customer_id UUID NOT NULL REFERENCES customers(id),
  candidate_customer_ids UUID[] NOT NULL,
  duplicate_customer_ids UUID[] NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED')),
  reason_code TEXT NOT NULL,
  plan_fingerprint TEXT NOT NULL,

  -- Planned vs actual reference movement counters
  planned_transaction_refs INT NOT NULL DEFAULT 0,
  planned_booking_refs INT NOT NULL DEFAULT 0,
  planned_schedule_refs INT NOT NULL DEFAULT 0,
  planned_other_refs INT NOT NULL DEFAULT 0,

  actual_transaction_refs_moved INT NOT NULL DEFAULT 0,
  actual_booking_refs_moved INT NOT NULL DEFAULT 0,
  actual_schedule_refs_moved INT NOT NULL DEFAULT 0,
  actual_other_refs_moved INT NOT NULL DEFAULT 0,

  -- PII-Free JSONB Rollback Snapshot
  rollback_snapshot JSONB NULL,

  -- Governance & Audit
  approved_by TEXT NULL,
  approved_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  rolled_back_at TIMESTAMPTZ NULL,

  error_code TEXT NULL,
  error_summary TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_moka_group_hash ON customer_reconciliation_ledger(moka_group_hash);
CREATE INDEX IF NOT EXISTS idx_ledger_canonical_customer_id ON customer_reconciliation_ledger(canonical_customer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON customer_reconciliation_ledger(status);

-- 3. Atomic Database Function for Single Group Reconciliation
CREATE OR REPLACE FUNCTION reconcile_customer_duplicate_group(
  p_reconciliation_key TEXT,
  p_expected_fingerprint TEXT,
  p_canonical_id UUID,
  p_duplicate_ids UUID[],
  p_tx_ids UUID[],
  p_booking_ids UUID[],
  p_schedule_ids UUID[]
) RETURNS JSONB AS $$
DECLARE
  v_ledger_id UUID;
  v_moved_tx INT := 0;
  v_moved_booking INT := 0;
  v_moved_schedule INT := 0;
  v_dup_id UUID;
BEGIN
  -- Obtain advisory lock on canonical customer to prevent concurrent reconciliation
  PERFORM pg_advisory_xact_lock(hashtext(p_canonical_id::text));

  -- Verify ledger entry state
  SELECT id INTO v_ledger_id
  FROM customer_reconciliation_ledger
  WHERE reconciliation_key = p_reconciliation_key AND status = 'APPROVED';

  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_APPROVED: Ledger entry missing or not in APPROVED state for key %', p_reconciliation_key;
  END IF;

  -- Update ledger status to EXECUTING
  UPDATE customer_reconciliation_ledger
  SET status = 'EXECUTING', started_at = now(), updated_at = now()
  WHERE id = v_ledger_id;

  -- Move transactions conditionally
  IF p_tx_ids IS NOT NULL AND array_length(p_tx_ids, 1) > 0 THEN
    WITH moved AS (
      UPDATE transactions
      SET customer_id = p_canonical_id
      WHERE id = ANY(p_tx_ids) AND customer_id = ANY(p_duplicate_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_moved_tx FROM moved;
  END IF;

  -- Move bookings conditionally
  IF p_booking_ids IS NOT NULL AND array_length(p_booking_ids, 1) > 0 THEN
    WITH moved AS (
      UPDATE bookings
      SET customer_id = p_canonical_id
      WHERE id = ANY(p_booking_ids) AND customer_id = ANY(p_duplicate_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_moved_booking FROM moved;
  END IF;

  -- Move schedules conditionally
  IF p_schedule_ids IS NOT NULL AND array_length(p_schedule_ids, 1) > 0 THEN
    WITH moved AS (
      UPDATE schedules
      SET customer_id = p_canonical_id
      WHERE id = ANY(p_schedule_ids) AND customer_id = ANY(p_duplicate_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_moved_schedule FROM moved;
  END IF;

  -- Retire duplicate customer rows
  FOREACH v_dup_id IN ARRAY p_duplicate_ids LOOP
    IF v_dup_id = p_canonical_id THEN
      RAISE EXCEPTION 'CANONICAL_RETIREMENT_FORBIDDEN: Cannot retire canonical customer %', p_canonical_id;
    END IF;

    UPDATE customers
    SET merged_into_customer_id = p_canonical_id, merged_at = now()
    WHERE id = v_dup_id AND merged_into_customer_id IS NULL;
  END LOOP;

  -- Update ledger to COMPLETED
  UPDATE customer_reconciliation_ledger
  SET status = 'COMPLETED',
      completed_at = now(),
      actual_transaction_refs_moved = v_moved_tx,
      actual_booking_refs_moved = v_moved_booking,
      actual_schedule_refs_moved = v_moved_schedule,
      updated_at = now()
  WHERE id = v_ledger_id;

  RETURN jsonb_build_object(
    'status', 'COMPLETED',
    'reconciliation_key', p_reconciliation_key,
    'moved_transactions', v_moved_tx,
    'moved_bookings', v_moved_booking,
    'moved_schedules', v_moved_schedule,
    'retired_customers', array_length(p_duplicate_ids, 1)
  );
EXCEPTION WHEN OTHERS THEN
  IF v_ledger_id IS NOT NULL THEN
    UPDATE customer_reconciliation_ledger
    SET status = 'FAILED', failed_at = now(), error_code = SQLSTATE, error_summary = SQLERRM, updated_at = now()
    WHERE id = v_ledger_id;
  END IF;
  RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
