# Reddy P0 anti-spam rollout

This is an operator runbook only. PR #39 does not change production environment
variables, apply the migration, merge, deploy, or enable a branch.

## Emergency-safe order

1. Set `REDDY_ENABLED=false` in the **production** environment first.
2. Verify the effective production configuration and verify customer messages
   produce no Reddy/OpenAI call and no automated reply. Manual human replies
   must remain usable.
3. Verify Fonnte Inbox is enabled for every Redbox branch device so genuine
   customer webhooks carry `inboxid`; confirm each payload also carries the
   provider `device` identifier. Keep any channel that lacks either field
   disabled because the P0 policy fails closed.
4. Apply `server/migrations/2026-08-29-wa-antispam-idempotency.sql` as the
   database owner. Confirm both RPCs are executable by `service_role` only.
5. After Aira approval, merge and deploy PR #39 while Reddy remains disabled.
6. Confirm application health and anti-spam telemetry while disabled. Expected
   customer-event result is `ai_kill_switch_suppressed`; missing identity is
   `processing_failed` with `missing_provider_message_id` or
   `missing_provider_device_id`.
7. Run controlled probes per device: same device/ID repeated, cross-device same
   ID, concurrent identical replies, rolling-window boundary, and concurrent
   rate ceiling. Confirm zero raw phone/message content in guard tables/logs.
8. Re-enable one branch/channel at a time. Observe inbound claims, outbound
   reservations, provider delivery, error rate, and duplicate suppression
   before advancing to the next branch. Roll back immediately by setting
   `REDDY_ENABLED=false` if any duplicate automated reply appears.

## Success criteria

- Same device + same provider message ID has one inbound winner.
- Different devices + same provider message ID each have one legitimate winner.
- Missing device/ID and DB/RPC errors return HTTP 200 but perform zero AI/send.
- Concurrent duplicate content allows at most one automated provider send.
- Concurrent automated sends never exceed five per destination per 60 seconds.
- Status callbacks and self/fromMe events perform zero AI/automated reply.
- Manual admin/human-takeover replies remain operational.
