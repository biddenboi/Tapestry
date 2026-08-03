# Tapestry Supabase control plane

This directory contains the server-side half of owner-only cross-device sync.
The migration creates an approved-owner allowlist, row-level security, a device
registry, canonical entity/event storage, an append-only sync log, and
command-specific RPC functions.

Production setup is intentionally not automated from application credentials:

1. Link the Supabase CLI to the production project.
2. Push the migration.
3. Disable public sign-ups in Auth settings and configure the production redirect URL.
4. Verify `yujinpetercho@gmail.com` is the only enabled row in
   `tapestry_owner_allowlist`. Use `oatstakes@gmail.com` only if the primary
   address cannot be used.
5. Keep the service-role key out of the browser and deployment environment.

The application needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the
public `VITE_WEB_PUSH_PUBLIC_KEY`. These are publishable client configuration;
all authorization is enforced by Auth, RPC validation, and RLS. Keep the VAPID
private key, service-role key, and cron secret out of every client build.

## Web Push delivery

`functions/push-due-notifications` scans synchronized reminder and routine-run
entities, sends each due item once per subscription, records delivery receipts,
and removes expired push subscriptions. Deploy the function without legacy JWT
verification because its scheduler endpoint authenticates with a separate,
random `x-tapestry-cron-secret` header.

Configure these Edge Function secrets in the Supabase dashboard:

- `TAPESTRY_VAPID_PUBLIC_KEY`
- `TAPESTRY_VAPID_PRIVATE_KEY`
- `TAPESTRY_PUSH_CRON_SECRET`

Apply `20260802170000_push_exports_integrity.sql` before
`20260802200000_push_delivery_receipts.sql`, then deploy the function. Store the
cron secret in Supabase Vault and schedule a `net.http_post` call with `pg_cron`.
The production schedule is every five minutes. Never place the literal secret
in a migration or committed SQL snippet.

Useful non-secret verification queries:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'tapestry-push-due-notifications';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = 1
order by start_time desc
limit 5;

select status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 5;
```

Web Push remains an accelerator. The client independently computes due state
from synchronized reminders and routine runs whenever it opens, so a missed or
expired push can never hide due work.
