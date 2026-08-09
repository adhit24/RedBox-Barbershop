-- service_role needs DELETE so POST /api/member/sync can purge legacy
-- moka-sync: lump-sum ledger rows superseded by real per-visit rows — see
-- server/index.js persistVisitHistory. Without this grant, the delete call
-- fails with a silent 42501 permission-denied on every sync (caught and
-- warned, never surfaced), and the legacy lump-sum rows are never removed.
--
-- Additive only: does not change RLS or any other existing grant on this
-- table (service_role already had INSERT, SELECT, UPDATE).

GRANT DELETE ON TABLE public.member_point_transactions TO service_role;
