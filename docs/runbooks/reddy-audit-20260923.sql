-- Pending operation: this session's Supabase connection is read-only.
-- Assign queue ownership under the existing autoAssignHandoff policy.
-- These labels are queues, not proof of human acknowledgment.
-- Does not change case status, resolve cases, or send notifications.
begin;
update public.human_handoff_cases
set assigned_to = case
  when branch in ('bypass','samadikun','csb','sumber','tegal') then 'admin_' || branch
  else 'central_admin'
end,
updated_at = now()
where status = 'waiting_human'
  and priority in ('urgent','high')
  and assigned_to is null
returning id, branch, priority, assigned_to, status;
commit;

-- Verify queue ownership. Human handling still requires an authenticated
-- operator to claim, investigate and explicitly resolve each case.
select priority, status, count(*) as total,
       count(*) filter (where assigned_to is null) as unassigned
from public.human_handoff_cases
where status in ('waiting_human','human_active')
group by priority, status;

-- Read-only reconciliation candidates. Never infer duplicate outcomes from
-- proximity of timestamps: the inspected evaluation events have no message
-- ID or correlation ID. Obtain provider/runtime evidence first.
select id, correlation_id, processing_status, received_at,
       failure_reason, terminal_source
from public.wa_inbound_events
where received_at >= timestamptz '2026-09-23 00:00:00+00'
  and received_at < timestamptz '2026-09-24 00:00:00+00'
  and outbound_attempted and not outbound_sent
  and (failure_reason is null or terminal_source is null)
order by received_at;
