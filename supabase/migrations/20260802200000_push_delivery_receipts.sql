create table if not exists public.web_push_delivery_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint_hash text not null,
  due_key text not null,
  delivered_at timestamptz not null default now(),
  primary key(owner_id,endpoint_hash,due_key)
);
create index if not exists web_push_delivery_recent_idx
  on public.web_push_delivery_receipts(owner_id,delivered_at desc);
alter table public.web_push_delivery_receipts enable row level security;
revoke all on public.web_push_delivery_receipts from anon,authenticated;

-- Delivery receipts are operational, not archival data.
create or replace function public.prune_web_push_delivery_receipts()
returns void
language sql
security definer
set search_path=pg_catalog,public
as $$
  delete from public.web_push_delivery_receipts where delivered_at < now()-interval '14 days';
$$;
revoke all on function public.prune_web_push_delivery_receipts() from public,anon,authenticated;
grant execute on function public.prune_web_push_delivery_receipts() to service_role;

create or replace function public.increment_web_push_failure(p_owner_id uuid,p_endpoint text)
returns void
language sql
security definer
set search_path=pg_catalog,public
as $$
  update public.web_push_subscriptions
  set failure_count=failure_count+1,updated_at=now()
  where owner_id=p_owner_id and endpoint=p_endpoint;
$$;
revoke all on function public.increment_web_push_failure(uuid,text) from public,anon,authenticated;
grant execute on function public.increment_web_push_failure(uuid,text) to service_role;
