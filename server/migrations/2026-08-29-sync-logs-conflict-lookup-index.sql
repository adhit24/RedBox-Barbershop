-- DA-01 conflict ledger — partial index for the durable conflict lookup.
-- Additive only. NOT applied to production by this change — for review only.
--
-- server/moka/sync.js's _checkDurableConflictBlock queries sync_logs with:
--   WHERE entity_type = 'schedule_conflict' AND entity_id = <billId>
--     AND status = 'failed'
--   ORDER BY created_at DESC
--   LIMIT 1
-- run once per open bill on every Moka pull cycle. At production scale
-- (205,144+ rows in sync_logs per Aira's live inspection, only
-- sync_logs_pkey(id) and idx_sync_logs_created(created_at DESC) existing),
-- this lookup would otherwise risk a large scan. entity_type and status are
-- constant within this query's own predicate, so a partial index scoped to
-- exactly that predicate stays far smaller than indexing all sync_logs rows,
-- and its (entity_id, created_at DESC) column order lets Postgres both seek
-- directly to this bill's rows AND walk them in the query's own ORDER BY
-- direction — satisfying the LIMIT 1 without a separate sort step.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_sync_logs_schedule_conflict_lookup
  ON sync_logs (entity_id, created_at DESC)
  WHERE entity_type = 'schedule_conflict'
    AND status = 'failed';

COMMIT;
