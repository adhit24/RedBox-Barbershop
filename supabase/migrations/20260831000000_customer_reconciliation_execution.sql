-- Task 17.3.2 — Moka Customer Duplicate Reconciliation Execution Schema & Ledger Migration Scaffolding (Correction Round 1 Hardened).
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
  rollback_snapshot JSONB NOT NULL,

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

-- 3. Approved Plan Immutability Trigger
CREATE OR REPLACE FUNCTION prevent_approved_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'EXECUTING', 'COMPLETED', 'ROLLED_BACK') THEN
    IF NEW.plan_fingerprint <> OLD.plan_fingerprint OR
       NEW.canonical_customer_id <> OLD.canonical_customer_id OR
       NEW.duplicate_customer_ids <> OLD.duplicate_customer_ids OR
       NEW.classification <> OLD.classification OR
       NEW.rollback_snapshot <> OLD.rollback_snapshot THEN
      RAISE EXCEPTION 'IMMUTABLE_APPROVED_PLAN: Cannot mutate approved reconciliation plan parameters for key %', OLD.reconciliation_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE trgname = 'trg_prevent_approved_ledger_mutation'
  ) THEN
    CREATE TRIGGER trg_prevent_approved_ledger_mutation
      BEFORE UPDATE ON customer_reconciliation_ledger
      FOR EACH ROW EXECUTE FUNCTION prevent_approved_ledger_mutation();
  END IF;
END $$;

-- 4. Hardened Atomic Database Function for Single Group Reconciliation
CREATE OR REPLACE FUNCTION reconcile_customer_duplicate_group(
  p_reconciliation_key TEXT,
  p_expected_fingerprint TEXT
) RETURNS JSONB AS $$
DECLARE
  v_ledger RECORD;
  v_moved_tx INT := 0;
  v_moved_booking INT := 0;
  v_moved_schedule INT := 0;
  v_retired_count INT := 0;
  v_canonical_id UUID;
  v_duplicate_ids UUID[];
  v_dup_id UUID;
  v_move RECORD;
  v_row_count INT;
  v_merged_check UUID;
BEGIN
  -- Obtain transaction advisory lock on key
  PERFORM pg_advisory_xact_lock(hashtext(p_reconciliation_key));

  -- Load ledger row FOR UPDATE
  SELECT * INTO v_ledger
  FROM customer_reconciliation_ledger
  WHERE reconciliation_key = p_reconciliation_key
  FOR UPDATE;

  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND: Ledger entry missing for key %', p_reconciliation_key;
  END IF;

  IF v_ledger.status <> 'APPROVED' OR v_ledger.approved_by IS NULL OR v_ledger.approved_at IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_APPROVED: Ledger entry not in APPROVED state or missing approval audit for key %', p_reconciliation_key;
  END IF;

  IF v_ledger.plan_fingerprint <> p_expected_fingerprint THEN
    RAISE EXCEPTION 'STALE_PLAN_FINGERPRINT_DRIFT_DETECTED: Fingerprint mismatch for key %', p_reconciliation_key;
  END IF;

  IF v_ledger.classification NOT IN ('SAFE_AUTO_RECONCILE', 'DETERMINISTIC_RECONCILIATION') THEN
    RAISE EXCEPTION 'CLASSIFICATION_NOT_EXECUTABLE: Classification % is not executable for key %', v_ledger.classification, p_reconciliation_key;
  END IF;

  v_canonical_id := v_ledger.canonical_customer_id;
  v_duplicate_ids := v_ledger.duplicate_customer_ids;

  -- Lock candidate customer rows in deterministic order
  PERFORM id FROM customers
  WHERE id = ANY(array_cat(ARRAY[v_canonical_id], v_duplicate_ids))
  ORDER BY id
  FOR UPDATE;

  -- Revalidate canonical customer state
  SELECT merged_into_customer_id INTO v_merged_check
  FROM customers WHERE id = v_canonical_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANONICAL_NOT_FOUND: Canonical customer % does not exist', v_canonical_id;
  END IF;

  IF v_merged_check IS NOT NULL THEN
    RAISE EXCEPTION 'CANONICAL_ALREADY_RETIRED: Canonical customer % is already merged into %', v_canonical_id, v_merged_check;
  END IF;

  IF v_canonical_id = ANY(v_duplicate_ids) THEN
    RAISE EXCEPTION 'CANONICAL_CANNOT_BE_RETIRED: Canonical customer % is listed in duplicate retirement set', v_canonical_id;
  END IF;

  -- Revalidate duplicate customer states
  FOREACH v_dup_id IN ARRAY v_duplicate_ids LOOP
    SELECT merged_into_customer_id INTO v_merged_check
    FROM customers WHERE id = v_dup_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DUPLICATE_NOT_FOUND: Duplicate customer % does not exist', v_dup_id;
    END IF;

    IF v_merged_check IS NOT NULL THEN
      RAISE EXCEPTION 'DUPLICATE_ALREADY_MERGED: Duplicate customer % is already merged into %', v_dup_id, v_merged_check;
    END IF;
  END LOOP;

  -- Update ledger status to EXECUTING
  UPDATE customer_reconciliation_ledger
  SET status = 'EXECUTING', started_at = now(), updated_at = now()
  WHERE id = v_ledger.id;

  -- Move transactions with exact previous-owner matching
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'transaction_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE transactions
    SET customer_id = v_canonical_id
    WHERE id = v_move.id AND customer_id = v_move.previous_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'REFERENCE_DRIFT_DETECTED: Transaction % expected customer_id % but update affected % rows', v_move.id, v_move.previous_customer_id, v_row_count;
    END IF;
    v_moved_tx := v_moved_tx + 1;
  END LOOP;

  -- Move bookings with exact previous-owner matching
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'booking_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE bookings
    SET customer_id = v_canonical_id
    WHERE id = v_move.id AND customer_id = v_move.previous_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'REFERENCE_DRIFT_DETECTED: Booking % expected customer_id % but update affected % rows', v_move.id, v_move.previous_customer_id, v_row_count;
    END IF;
    v_moved_booking := v_moved_booking + 1;
  END LOOP;

  -- Move schedules with exact previous-owner matching
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'schedule_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE schedules
    SET customer_id = v_canonical_id
    WHERE id = v_move.id AND customer_id = v_move.previous_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'REFERENCE_DRIFT_DETECTED: Schedule % expected customer_id % but update affected % rows', v_move.id, v_move.previous_customer_id, v_row_count;
    END IF;
    v_moved_schedule := v_moved_schedule + 1;
  END LOOP;

  -- Retire duplicate customer rows
  FOREACH v_dup_id IN ARRAY v_duplicate_ids LOOP
    UPDATE customers
    SET merged_into_customer_id = v_canonical_id, merged_at = now()
    WHERE id = v_dup_id AND merged_into_customer_id IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'RETIREMENT_DRIFT_DETECTED: Duplicate customer % update affected % rows', v_dup_id, v_row_count;
    END IF;
    v_retired_count := v_retired_count + 1;
  END LOOP;

  -- Verify total counts match planned
  IF v_moved_tx <> v_ledger.planned_transaction_refs OR
     v_moved_booking <> v_ledger.planned_booking_refs OR
     v_moved_schedule <> v_ledger.planned_schedule_refs OR
     v_retired_count <> array_length(v_duplicate_ids, 1) THEN
    RAISE EXCEPTION 'MOVE_COUNT_MISMATCH: Planned vs actual moves mismatch';
  END IF;

  -- Update ledger to COMPLETED
  UPDATE customer_reconciliation_ledger
  SET status = 'COMPLETED',
      completed_at = now(),
      actual_transaction_refs_moved = v_moved_tx,
      actual_booking_refs_moved = v_moved_booking,
      actual_schedule_refs_moved = v_moved_schedule,
      updated_at = now()
  WHERE id = v_ledger.id;

  RETURN jsonb_build_object(
    'status', 'COMPLETED',
    'reconciliation_key', p_reconciliation_key,
    'moved_transactions', v_moved_tx,
    'moved_bookings', v_moved_booking,
    'moved_schedules', v_moved_schedule,
    'retired_customers', v_retired_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- SECURITY DEFINER Hardening for reconcile_customer_duplicate_group
REVOKE EXECUTE ON FUNCTION reconcile_customer_duplicate_group(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reconcile_customer_duplicate_group(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION reconcile_customer_duplicate_group(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION reconcile_customer_duplicate_group(TEXT, TEXT) TO service_role;

-- 5. Hardened Atomic Rollback Function
CREATE OR REPLACE FUNCTION rollback_customer_reconciliation_group(
  p_reconciliation_key TEXT
) RETURNS JSONB AS $$
DECLARE
  v_ledger RECORD;
  v_restored_tx INT := 0;
  v_restored_booking INT := 0;
  v_restored_schedule INT := 0;
  v_unretired_count INT := 0;
  v_move RECORD;
  v_row_count INT;
  v_dup_id UUID;
BEGIN
  -- Obtain advisory lock
  PERFORM pg_advisory_xact_lock(hashtext(p_reconciliation_key));

  -- Load ledger row FOR UPDATE
  SELECT * INTO v_ledger
  FROM customer_reconciliation_ledger
  WHERE reconciliation_key = p_reconciliation_key
  FOR UPDATE;

  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_FOUND: Ledger entry missing for key %', p_reconciliation_key;
  END IF;

  IF v_ledger.status NOT IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'ROLLBACK_INVALID_STATUS: Cannot rollback ledger entry in status %', v_ledger.status;
  END IF;

  -- Restore transactions conditionally
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'transaction_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE transactions
    SET customer_id = v_move.previous_customer_id
    WHERE id = v_move.id AND customer_id = v_move.target_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'ROLLBACK_DRIFT_DETECTED: Transaction % target customer_id % changed since reconciliation', v_move.id, v_move.target_customer_id;
    END IF;
    v_restored_tx := v_restored_tx + 1;
  END LOOP;

  -- Restore bookings conditionally
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'booking_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE bookings
    SET customer_id = v_move.previous_customer_id
    WHERE id = v_move.id AND customer_id = v_move.target_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'ROLLBACK_DRIFT_DETECTED: Booking % target customer_id % changed since reconciliation', v_move.id, v_move.target_customer_id;
    END IF;
    v_restored_booking := v_restored_booking + 1;
  END LOOP;

  -- Restore schedules conditionally
  FOR v_move IN SELECT * FROM jsonb_to_recordset(v_ledger.rollback_snapshot->'schedule_moves') AS x(id UUID, previous_customer_id UUID, target_customer_id UUID) LOOP
    UPDATE schedules
    SET customer_id = v_move.previous_customer_id
    WHERE id = v_move.id AND customer_id = v_move.target_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'ROLLBACK_DRIFT_DETECTED: Schedule % target customer_id % changed since reconciliation', v_move.id, v_move.target_customer_id;
    END IF;
    v_restored_schedule := v_restored_schedule + 1;
  END LOOP;

  -- Un-retire duplicate customer rows
  FOREACH v_dup_id IN ARRAY v_ledger.duplicate_customer_ids LOOP
    UPDATE customers
    SET merged_into_customer_id = NULL, merged_at = NULL
    WHERE id = v_dup_id AND merged_into_customer_id = v_ledger.canonical_customer_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'ROLLBACK_DRIFT_DETECTED: Duplicate customer % merged_into_customer_id changed since reconciliation', v_dup_id;
    END IF;
    v_unretired_count := v_unretired_count + 1;
  END LOOP;

  -- Verify rollback counts match original moves
  IF v_restored_tx <> v_ledger.actual_transaction_refs_moved OR
     v_restored_booking <> v_ledger.actual_booking_refs_moved OR
     v_restored_schedule <> v_ledger.actual_schedule_refs_moved THEN
    RAISE EXCEPTION 'ROLLBACK_COUNT_MISMATCH: Restored vs original moved count mismatch';
  END IF;

  -- Update ledger status to ROLLED_BACK
  UPDATE customer_reconciliation_ledger
  SET status = 'ROLLED_BACK', rolled_back_at = now(), updated_at = now()
  WHERE id = v_ledger.id;

  RETURN jsonb_build_object(
    'status', 'ROLLED_BACK',
    'reconciliation_key', p_reconciliation_key,
    'restored_transactions', v_restored_tx,
    'restored_bookings', v_restored_booking,
    'restored_schedules', v_restored_schedule,
    'unretired_customers', v_unretired_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- SECURITY DEFINER Hardening for rollback_customer_reconciliation_group
REVOKE EXECUTE ON FUNCTION rollback_customer_reconciliation_group(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rollback_customer_reconciliation_group(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rollback_customer_reconciliation_group(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION rollback_customer_reconciliation_group(TEXT) TO service_role;
