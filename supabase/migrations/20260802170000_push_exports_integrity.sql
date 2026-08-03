-- Push subscription registry plus owner-scoped recovery and diagnostics RPCs.
-- Push delivery remains an accelerator: clients always compute due state from
-- synchronized canonical reminder/routine data when they open.

create table if not exists public.web_push_subscriptions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check(failure_count >= 0),
  primary key(owner_id,endpoint),
  constraint web_push_endpoint_length check(char_length(endpoint) between 1 and 4096),
  constraint web_push_key_length check(char_length(p256dh) between 1 and 1024),
  constraint web_push_auth_length check(char_length(auth_secret) between 1 and 1024)
);

alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon;
grant select on public.web_push_subscriptions to authenticated;
drop policy if exists web_push_subscriptions_owner_select on public.web_push_subscriptions;
create policy web_push_subscriptions_owner_select on public.web_push_subscriptions
  for select to authenticated
  using(owner_id=auth.uid() and public.is_tapestry_owner());
revoke insert,update,delete,truncate on public.web_push_subscriptions from anon,authenticated;

create or replace function public.register_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if coalesce(char_length(trim(p_endpoint)),0) not between 1 and 4096
     or coalesce(char_length(trim(p_p256dh)),0) not between 1 and 1024
     or coalesce(char_length(trim(p_auth)),0) not between 1 and 1024 then
    raise exception 'The Web Push subscription is invalid.' using errcode='22023';
  end if;
  insert into public.web_push_subscriptions(
    owner_id,endpoint,p256dh,auth_secret,user_agent,updated_at,failure_count
  ) values(
    v_owner_id,trim(p_endpoint),trim(p_p256dh),trim(p_auth),left(p_user_agent,1000),now(),0
  ) on conflict(owner_id,endpoint) do update set
    p256dh=excluded.p256dh,
    auth_secret=excluded.auth_secret,
    user_agent=excluded.user_agent,
    updated_at=excluded.updated_at,
    failure_count=0;
  return jsonb_build_object('registered',true,'updatedAt',now());
end;
$$;

revoke all on function public.register_web_push_subscription(text,text,text,text) from public,anon;
grant execute on function public.register_web_push_subscription(text,text,text,text) to authenticated;

create or replace function public.unregister_web_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_removed integer;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  delete from public.web_push_subscriptions
  where owner_id=v_owner_id and endpoint=trim(coalesce(p_endpoint,''));
  get diagnostics v_removed = row_count;
  return jsonb_build_object('removed',v_removed>0);
end;
$$;

revoke all on function public.unregister_web_push_subscription(text) from public,anon;
grant execute on function public.unregister_web_push_subscription(text) to authenticated;

create or replace function public.get_tapestry_server_integrity()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'generatedAt',now(),
    'latestSequence',coalesce((select max(server_sequence) from public.sync_log where owner_id=v_owner_id),0),
    'counts',jsonb_build_object(
      'devices',(select count(*) from public.sync_devices where owner_id=v_owner_id and retired_at is null),
      'entities',(select count(*) from public.sync_entities where owner_id=v_owner_id and deleted_at is null),
      'deletedEntities',(select count(*) from public.sync_entities where owner_id=v_owner_id and deleted_at is not null),
      'events',(select count(*) from public.sync_events where owner_id=v_owner_id),
      'operations',(select count(*) from public.sync_log where owner_id=v_owner_id),
      'chronicleEntries',(select count(*) from public.sync_entities where owner_id=v_owner_id and entity_type='chronicle-entry' and deleted_at is null),
      'routineRuns',(select count(*) from public.sync_entities where owner_id=v_owner_id and entity_type='routine-run' and deleted_at is null),
      'shopPlayers',(select count(*) from public.shop_player_balances where owner_id=v_owner_id),
      'shopInventory',(select count(*) from public.shop_inventory where owner_id=v_owner_id),
      'shopPurchases',(select count(*) from public.shop_purchase_receipts where owner_id=v_owner_id),
      'shopActivations',(select count(*) from public.shop_activation_receipts where owner_id=v_owner_id),
      'pushSubscriptions',(select count(*) from public.web_push_subscriptions where owner_id=v_owner_id)
    )
  );
end;
$$;

revoke all on function public.get_tapestry_server_integrity() from public,anon;
grant execute on function public.get_tapestry_server_integrity() to authenticated;

create or replace function public.export_tapestry_server_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'format','tapestry-server-snapshot-v1',
    'exportedAt',now(),
    'syncEntities',coalesce((select jsonb_agg(to_jsonb(row_value) order by entity_type,entity_id)
      from (select entity_type,entity_id,player_id,version,data,updated_at,updated_by_device_id,deleted_at
            from public.sync_entities where owner_id=v_owner_id) row_value),'[]'::jsonb),
    'syncEvents',coalesce((select jsonb_agg(to_jsonb(row_value) order by occurred_at,event_id)
      from (select event_id,player_id,command_type,entity_type,entity_id,data,occurred_at,origin_device_id,created_at
            from public.sync_events where owner_id=v_owner_id) row_value),'[]'::jsonb),
    'syncLog',coalesce((select jsonb_agg(to_jsonb(row_value) order by server_sequence)
      from (select server_sequence,operation_id,player_id,origin_device_id,device_sequence,command_type,
                   entity_type,entity_id,base_version,payload,occurred_at,status,result_json,accepted_at
            from public.sync_log where owner_id=v_owner_id) row_value),'[]'::jsonb),
    'chronicleEntries',coalesce((select jsonb_agg(to_jsonb(row_value) order by updated_at,entity_id)
      from (select entity_id,player_id,version,data,updated_at,updated_by_device_id,deleted_at
            from public.sync_entities
            where owner_id=v_owner_id and entity_type='chronicle-entry') row_value),'[]'::jsonb),
    'routineRuns',coalesce((select jsonb_agg(to_jsonb(row_value) order by updated_at,entity_id)
      from (select entity_id,player_id,version,data,updated_at,updated_by_device_id,deleted_at
            from public.sync_entities
            where owner_id=v_owner_id and entity_type='routine-run') row_value),'[]'::jsonb),
    'routineSteps',coalesce((select jsonb_agg(to_jsonb(row_value) order by occurred_at,event_id)
      from (select event_id,player_id,entity_id,data,occurred_at,origin_device_id,created_at
            from public.sync_events
            where owner_id=v_owner_id and command_type='completeRoutineStep') row_value),'[]'::jsonb),
    'shop',jsonb_build_object(
      'players',coalesce((select jsonb_agg(to_jsonb(row_value) order by player_id)
        from (select player_id,tokens,player_data,updated_at from public.shop_player_balances where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'cash',coalesce((select jsonb_agg(to_jsonb(row_value))
        from (select money,updated_at from public.shop_cash_balances where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'catalog',coalesce((select jsonb_agg(to_jsonb(row_value) order by item_id)
        from (select item_id,data,sold_count,updated_at from public.shop_catalog where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'inventory',coalesce((select jsonb_agg(to_jsonb(row_value) order by inventory_id)
        from (select inventory_id,player_id,shop_item_id,data,quantity,purchase_count,last_used_at,cooldown_until,updated_at
              from public.shop_inventory where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'purchaseReceipts',coalesce((select jsonb_agg(to_jsonb(row_value) order by created_at,operation_id)
        from (select operation_id,player_id,result_json,created_at from public.shop_purchase_receipts where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'activationReceipts',coalesce((select jsonb_agg(to_jsonb(row_value) order by created_at,operation_id)
        from (select operation_id,player_id,result_json,created_at from public.shop_activation_receipts where owner_id=v_owner_id) row_value),'[]'::jsonb),
      'effectIntervals',coalesce((select jsonb_agg(to_jsonb(row_value) order by starts_at,interval_id)
        from (select interval_id,player_id,source_type,source_id,effect_scope,multiplier,stacking_rule,
                     starts_at,ends_at,policy_version,data,created_at
              from public.shop_effect_intervals where owner_id=v_owner_id) row_value),'[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.export_tapestry_server_snapshot() from public,anon;
grant execute on function public.export_tapestry_server_snapshot() to authenticated;
