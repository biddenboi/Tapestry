create table if not exists public.shop_activation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  player_id text not null,
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default now(),
  primary key(owner_id,operation_id)
);
alter table public.shop_activation_receipts enable row level security;
revoke all on public.shop_activation_receipts from anon;
grant select on public.shop_activation_receipts to authenticated;
drop policy if exists shop_activation_receipts_owner_select on public.shop_activation_receipts;
create policy shop_activation_receipts_owner_select on public.shop_activation_receipts
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
revoke insert,update,delete,truncate on public.shop_activation_receipts from anon,authenticated;

create or replace function public.activate_shop_item(
  p_operation_id text,
  p_device_id text,
  p_player_id text,
  p_inventory_id text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_inventory public.shop_inventory;
  v_result jsonb;
  v_now timestamptz := now();
  v_cooldown_ms bigint;
  v_cooldown_until timestamptz;
  v_duration_minutes numeric;
  v_inventory_data jsonb;
  v_interval_id text;
  v_interval_data jsonb := null;
  v_timeline_event jsonb;
  v_server_sequence bigint;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if coalesce(char_length(trim(p_operation_id)),0) not between 1 and 500
     or coalesce(char_length(trim(p_device_id)),0) not between 1 and 200
     or coalesce(char_length(trim(p_player_id)),0) not between 1 and 500
     or coalesce(char_length(trim(p_inventory_id)),0) not between 1 and 500 then
    raise exception 'The Shop activation command is invalid.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':shop-activation:' || p_operation_id,0));
  select result_json into v_result from public.shop_activation_receipts
  where owner_id=v_owner_id and operation_id=p_operation_id;
  if found then return v_result || jsonb_build_object('duplicate',true); end if;
  if not exists(select 1 from public.sync_devices where owner_id=v_owner_id and device_id=p_device_id and retired_at is null) then
    raise exception 'The sync device is not registered.' using errcode='42501';
  end if;
  select * into v_inventory from public.shop_inventory
  where owner_id=v_owner_id and inventory_id=p_inventory_id and player_id=p_player_id for update;
  if v_inventory.owner_id is null then raise exception 'The inventory item is unavailable.' using errcode='22023'; end if;
  if v_inventory.quantity<=0 then raise exception 'The inventory item is depleted.' using errcode='22023'; end if;
  if v_inventory.cooldown_until is not null and v_inventory.cooldown_until>v_now then
    raise exception 'The inventory item is still on cooldown.' using errcode='22023';
  end if;
  v_cooldown_ms := greatest(0,coalesce((v_inventory.data->>'cooldownMs')::bigint,0));
  v_cooldown_until := case when v_cooldown_ms>0
    then v_now+(v_cooldown_ms::text || ' milliseconds')::interval else null end;
  v_inventory_data := v_inventory.data || jsonb_build_object(
    'quantity',v_inventory.quantity-1,'lastUsedAt',v_now,
    'useCount',coalesce((v_inventory.data->>'useCount')::bigint,0)+1,
    'cooldownUntil',v_cooldown_until
  );
  update public.shop_inventory set quantity=quantity-1,data=v_inventory_data,
    last_used_at=v_now,cooldown_until=v_cooldown_until,updated_at=v_now
  where owner_id=v_owner_id and inventory_id=p_inventory_id;

  v_duration_minutes := greatest(0,coalesce((v_inventory.data->>'duration')::numeric,0));
  if coalesce(v_inventory.data->>'type','')='duration' and v_duration_minutes>0 then
    v_interval_id := 'shop-effect:' || p_operation_id;
    v_interval_data := jsonb_build_object(
      'id',v_interval_id,'playerId',p_player_id,'sourceType','shop-item',
      'sourceId',p_inventory_id,'effectScope','inventory-duration','multiplier',1,
      'stackingRule','highest','startsAt',v_now,
      'endsAt',v_now+(v_duration_minutes::text || ' minutes')::interval,
      'policyVersion',1,'createdAt',v_now,'itemName',v_inventory.data->>'name'
    );
    insert into public.shop_effect_intervals(
      owner_id,interval_id,player_id,source_type,source_id,effect_scope,multiplier,
      stacking_rule,starts_at,ends_at,policy_version,data,created_at
    ) values(
      v_owner_id,v_interval_id,p_player_id,'shop-item',p_inventory_id,'inventory-duration',1,
      'highest',v_now,v_now+(v_duration_minutes::text || ' minutes')::interval,1,v_interval_data,v_now
    );
  end if;
  v_timeline_event := jsonb_build_object(
    'UUID','shop-use-event:' || p_operation_id,'parent',p_player_id,'type','item_use',
    'name',v_inventory.data->>'name','icon',null,'bannerImageUrl',v_inventory.data->'bannerImageUrl',
    'category',coalesce(v_inventory.data->>'category',v_inventory.data->>'type'),
    'description','Used ' || coalesce(v_inventory.data->>'name','inventory item'),
    'itemType',v_inventory.data->>'type','itemId',coalesce(v_inventory.data->>'itemId',v_inventory.shop_item_id),
    'createdAt',v_now
  );
  v_result := jsonb_build_object(
    'operationId',p_operation_id,'inventoryRecord',v_inventory_data,
    'timelineEvent',v_timeline_event,'effectInterval',v_interval_data,'activatedAt',v_now,'duplicate',false
  );
  insert into public.shop_activation_receipts(owner_id,operation_id,player_id,result_json)
  values(v_owner_id,p_operation_id,p_player_id,v_result);
  insert into public.sync_log(
    owner_id,operation_id,player_id,origin_device_id,device_sequence,command_type,
    entity_type,entity_id,base_version,payload,occurred_at,status,result_json
  ) values(
    v_owner_id,p_operation_id,p_player_id,p_device_id,null,'activateShopItem','shop-activation',
    p_inventory_id,null,v_result,v_now,'accepted',jsonb_build_object('operationId',p_operation_id,'status','accepted')
  ) returning server_sequence into v_server_sequence;
  v_result := v_result || jsonb_build_object('serverSequence',v_server_sequence,'acceptedAt',v_now);
  update public.shop_activation_receipts set result_json=v_result where owner_id=v_owner_id and operation_id=p_operation_id;
  update public.sync_log set result_json=jsonb_build_object(
    'operationId',p_operation_id,'status','accepted','serverSequence',v_server_sequence,'acceptedAt',v_now
  ) where server_sequence=v_server_sequence;
  return v_result;
end;
$$;

revoke all on function public.activate_shop_item(text,text,text,text) from public,anon;
grant execute on function public.activate_shop_item(text,text,text,text) to authenticated;
