-- Online-authoritative Shop state. These tables are intentionally narrow and
-- JSON-backed: the RPC validates balances, stock, limits, quantities, and
-- cooldowns while clients retain their richer local SQLite projections.

create table if not exists public.shop_player_balances (
  owner_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  tokens bigint not null check (tokens >= 0),
  player_data jsonb not null check (jsonb_typeof(player_data)='object'),
  updated_at timestamptz not null default now(),
  primary key(owner_id,player_id)
);

create table if not exists public.shop_cash_balances (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  money numeric(18,2) not null check (money >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_catalog (
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  sold_count bigint not null default 0 check (sold_count >= 0),
  updated_at timestamptz not null default now(),
  primary key(owner_id,item_id)
);

create table if not exists public.shop_inventory (
  owner_id uuid not null references auth.users(id) on delete cascade,
  inventory_id text not null,
  player_id text not null,
  shop_item_id text not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  quantity bigint not null default 0 check (quantity >= 0),
  purchase_count bigint not null default 0 check (purchase_count >= 0),
  last_used_at timestamptz,
  cooldown_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(owner_id,inventory_id),
  unique(owner_id,player_id,shop_item_id)
);

create table if not exists public.shop_purchase_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  player_id text not null,
  result_json jsonb not null check (jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default now(),
  primary key(owner_id,operation_id)
);

create table if not exists public.shop_effect_intervals (
  owner_id uuid not null references auth.users(id) on delete cascade,
  interval_id text not null,
  player_id text not null,
  source_type text not null,
  source_id text not null,
  effect_scope text not null,
  multiplier numeric not null check (multiplier >= 0),
  stacking_rule text not null check (stacking_rule in ('multiply','additive','highest')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  policy_version integer not null check (policy_version > 0),
  data jsonb not null check (jsonb_typeof(data)='object'),
  created_at timestamptz not null default now(),
  primary key(owner_id,interval_id),
  unique(owner_id,player_id,source_type,source_id,effect_scope,starts_at),
  check(ends_at > starts_at)
);

alter table public.shop_player_balances enable row level security;
alter table public.shop_cash_balances enable row level security;
alter table public.shop_catalog enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.shop_purchase_receipts enable row level security;
alter table public.shop_effect_intervals enable row level security;

revoke all on public.shop_player_balances, public.shop_cash_balances,
  public.shop_catalog, public.shop_inventory, public.shop_purchase_receipts,
  public.shop_effect_intervals from anon;
grant select on public.shop_player_balances, public.shop_cash_balances,
  public.shop_catalog, public.shop_inventory, public.shop_purchase_receipts,
  public.shop_effect_intervals to authenticated;

drop policy if exists shop_player_balances_owner_select on public.shop_player_balances;
create policy shop_player_balances_owner_select on public.shop_player_balances
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
drop policy if exists shop_cash_balances_owner_select on public.shop_cash_balances;
create policy shop_cash_balances_owner_select on public.shop_cash_balances
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
drop policy if exists shop_catalog_owner_select on public.shop_catalog;
create policy shop_catalog_owner_select on public.shop_catalog
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
drop policy if exists shop_inventory_owner_select on public.shop_inventory;
create policy shop_inventory_owner_select on public.shop_inventory
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
drop policy if exists shop_purchase_receipts_owner_select on public.shop_purchase_receipts;
create policy shop_purchase_receipts_owner_select on public.shop_purchase_receipts
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
drop policy if exists shop_effect_intervals_owner_select on public.shop_effect_intervals;
create policy shop_effect_intervals_owner_select on public.shop_effect_intervals
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());

revoke insert,update,delete,truncate on public.shop_player_balances,
  public.shop_cash_balances,public.shop_catalog,public.shop_inventory,
  public.shop_purchase_receipts,public.shop_effect_intervals from anon,authenticated;

create or replace function public.prepare_shop_authority(
  p_player jsonb,
  p_catalog jsonb,
  p_inventory jsonb,
  p_global_money numeric
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_player_id text := trim(coalesce(p_player->>'UUID',''));
  v_record jsonb;
  v_item_id text;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if v_player_id='' or jsonb_typeof(p_player)<>'object'
     or jsonb_typeof(p_catalog)<>'array' or jsonb_typeof(p_inventory)<>'array'
     or coalesce((p_player->>'tokens')::bigint,-1)<0 or coalesce(p_global_money,-1)<0 then
    raise exception 'The initial Shop authority snapshot is invalid.' using errcode='22023';
  end if;

  insert into public.shop_player_balances(owner_id,player_id,tokens,player_data)
  values(v_owner_id,v_player_id,(p_player->>'tokens')::bigint,p_player)
  on conflict(owner_id,player_id) do nothing;
  insert into public.shop_cash_balances(owner_id,money)
  values(v_owner_id,p_global_money)
  on conflict(owner_id) do nothing;

  for v_record in select value from jsonb_array_elements(p_catalog)
  loop
    v_item_id := trim(coalesce(v_record->>'UUID',''));
    if v_item_id='' then raise exception 'Every Shop item requires a UUID.' using errcode='22023'; end if;
    insert into public.shop_catalog(owner_id,item_id,data,sold_count,updated_at)
    values(v_owner_id,v_item_id,v_record,greatest(0,coalesce((v_record->>'soldCount')::bigint,0)),now())
    on conflict(owner_id,item_id) do update set
      data=excluded.data || jsonb_build_object('soldCount',public.shop_catalog.sold_count),
      updated_at=excluded.updated_at;
  end loop;

  for v_record in select value from jsonb_array_elements(p_inventory)
  loop
    if coalesce(v_record->>'parent','')<>v_player_id or coalesce(v_record->>'UUID','')='' then
      raise exception 'The Shop inventory snapshot has an invalid owner or UUID.' using errcode='22023';
    end if;
    insert into public.shop_inventory(
      owner_id,inventory_id,player_id,shop_item_id,data,quantity,purchase_count,
      last_used_at,cooldown_until,updated_at
    ) values(
      v_owner_id,v_record->>'UUID',v_player_id,v_record->>'itemUUID',v_record,
      greatest(0,coalesce((v_record->>'quantity')::bigint,0)),
      greatest(0,coalesce((v_record->>'purchaseCount')::bigint,0)),
      nullif(v_record->>'lastUsedAt','')::timestamptz,
      nullif(v_record->>'cooldownUntil','')::timestamptz,now()
    ) on conflict(owner_id,player_id,shop_item_id) do nothing;
  end loop;
  return jsonb_build_object('ready',true,'playerId',v_player_id);
end;
$$;

revoke all on function public.prepare_shop_authority(jsonb,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.prepare_shop_authority(jsonb,jsonb,jsonb,numeric) to authenticated;

create or replace function public.purchase_shop_items(
  p_operation_id text,
  p_device_id text,
  p_player_id text,
  p_cart jsonb,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_existing jsonb;
  v_entry jsonb;
  v_item public.shop_catalog;
  v_inventory public.shop_inventory;
  v_balance public.shop_player_balances;
  v_cash public.shop_cash_balances;
  v_item_id text;
  v_inventory_id text;
  v_quantity bigint;
  v_unit_cost numeric;
  v_total_tokens bigint := 0;
  v_total_cash numeric(18,2) := 0;
  v_item_count bigint := 0;
  v_seen text[] := '{}';
  v_new_quantity bigint;
  v_new_purchase_count bigint;
  v_ledger_id text;
  v_index integer := 0;
  v_inventory_records jsonb := '[]'::jsonb;
  v_catalog_records jsonb := '[]'::jsonb;
  v_ledger_records jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_player_inventory jsonb := '[]'::jsonb;
  v_player_data jsonb;
  v_result jsonb;
  v_server_sequence bigint;
  v_now timestamptz := now();
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if coalesce(char_length(trim(p_operation_id)),0) not between 1 and 500
     or coalesce(char_length(trim(p_device_id)),0) not between 1 and 200
     or coalesce(char_length(trim(p_player_id)),0) not between 1 and 500
     or jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart)=0
     or jsonb_array_length(p_cart)>100 then
    raise exception 'The Shop purchase command is invalid.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':shop:' || p_operation_id,0));
  select result_json into v_existing from public.shop_purchase_receipts
  where owner_id=v_owner_id and operation_id=p_operation_id;
  if found then return v_existing || jsonb_build_object('duplicate',true); end if;
  if not exists(select 1 from public.sync_devices where owner_id=v_owner_id and device_id=p_device_id and retired_at is null) then
    raise exception 'The sync device is not registered.' using errcode='42501';
  end if;

  select * into v_balance from public.shop_player_balances
  where owner_id=v_owner_id and player_id=p_player_id for update;
  select * into v_cash from public.shop_cash_balances where owner_id=v_owner_id for update;
  if v_balance.owner_id is null or v_cash.owner_id is null then
    raise exception 'Shop authority must be initialized before purchase.' using errcode='22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_cart)
  loop
    v_item_id := trim(coalesce(v_entry->>'itemId',''));
    v_quantity := coalesce((v_entry->>'quantity')::bigint,0);
    if v_item_id='' or v_quantity<=0 or v_item_id=any(v_seen) then
      raise exception 'The cart contains an invalid or duplicate item.' using errcode='22023';
    end if;
    v_seen := array_append(v_seen,v_item_id);
    select * into v_item from public.shop_catalog
    where owner_id=v_owner_id and item_id=v_item_id for update;
    if v_item.owner_id is null then raise exception 'A cart item is missing from the catalog.' using errcode='22023'; end if;
    select * into v_inventory from public.shop_inventory
    where owner_id=v_owner_id and player_id=p_player_id and shop_item_id=v_item_id for update;
    if nullif(v_item.data->>'stockLimit','') is not null
       and v_item.sold_count+v_quantity>(v_item.data->>'stockLimit')::bigint then
      raise exception 'A cart item does not have enough stock.' using errcode='22023';
    end if;
    if coalesce((v_item.data->>'purchaseLimitPerPlayer')::bigint,0)>0
       and coalesce(v_inventory.purchase_count,0)+v_quantity>(v_item.data->>'purchaseLimitPerPlayer')::bigint then
      raise exception 'A cart item exceeds its player purchase limit.' using errcode='22023';
    end if;
    if (coalesce(v_item.data->>'itemClass','')='unlock' or coalesce(v_item.data->>'type','') like 'cosmetic_%')
       and (v_quantity>1 or coalesce(v_inventory.quantity,0)>0) then
      raise exception 'A permanent unlock cannot be purchased twice.' using errcode='22023';
    end if;
    v_unit_cost := coalesce((v_item.data->>'cost')::numeric,0);
    if v_unit_cost<0 then raise exception 'A cart item has an invalid price.' using errcode='22023'; end if;
    if coalesce(v_item.data->>'currencyType','tokens')='dollars' then
      v_total_cash := v_total_cash + v_unit_cost*v_quantity;
    else
      v_total_tokens := v_total_tokens + trunc(v_unit_cost)*v_quantity;
    end if;
    v_item_count := v_item_count+v_quantity;
  end loop;
  if v_balance.tokens<v_total_tokens then raise exception 'The player does not have enough tokens.' using errcode='22023'; end if;
  if v_cash.money<v_total_cash then raise exception 'The shared cash balance is too low.' using errcode='22023'; end if;

  v_player_data := v_balance.player_data || jsonb_build_object('tokens',v_balance.tokens-v_total_tokens);
  update public.shop_player_balances set tokens=v_balance.tokens-v_total_tokens,
    player_data=v_player_data,updated_at=v_now where owner_id=v_owner_id and player_id=p_player_id;
  update public.shop_cash_balances set money=v_cash.money-v_total_cash,updated_at=v_now where owner_id=v_owner_id;

  for v_entry in select value from jsonb_array_elements(p_cart)
  loop
    v_index := v_index+1;
    v_item_id := v_entry->>'itemId';
    v_quantity := (v_entry->>'quantity')::bigint;
    select * into v_item from public.shop_catalog where owner_id=v_owner_id and item_id=v_item_id;
    select * into v_inventory from public.shop_inventory
    where owner_id=v_owner_id and player_id=p_player_id and shop_item_id=v_item_id;
    v_inventory_id := coalesce(v_inventory.inventory_id,'inventory:' || p_player_id || ':' || v_item_id);
    v_new_quantity := coalesce(v_inventory.quantity,0)+v_quantity;
    v_new_purchase_count := coalesce(v_inventory.purchase_count,0)+v_quantity;
    v_existing := coalesce(v_inventory.data,'{}'::jsonb) || v_item.data || jsonb_build_object(
      'UUID',v_inventory_id,'parent',p_player_id,'itemUUID',v_item_id,
      'quantity',v_new_quantity,'purchaseCount',v_new_purchase_count,
      'purchasedAt',p_occurred_at,'lastUsedAt',v_inventory.last_used_at,
      'cooldownUntil',v_inventory.cooldown_until,'useCount',coalesce((v_inventory.data->>'useCount')::bigint,0)
    );
    insert into public.shop_inventory(owner_id,inventory_id,player_id,shop_item_id,data,quantity,purchase_count,updated_at)
    values(v_owner_id,v_inventory_id,p_player_id,v_item_id,v_existing,v_new_quantity,v_new_purchase_count,v_now)
    on conflict(owner_id,player_id,shop_item_id) do update set
      data=excluded.data,quantity=excluded.quantity,purchase_count=excluded.purchase_count,updated_at=excluded.updated_at;

    update public.shop_catalog set sold_count=sold_count+v_quantity,
      data=data || jsonb_build_object('soldCount',sold_count+v_quantity),updated_at=v_now
    where owner_id=v_owner_id and item_id=v_item_id returning * into v_item;
    v_ledger_id := 'shop-ledger:' || p_operation_id || ':' || v_index;
    v_unit_cost := coalesce((v_item.data->>'cost')::numeric,0);
    v_existing := jsonb_build_object(
      'UUID',v_ledger_id,'parent',p_player_id,'type','shop_purchase',
      'purchaseBatchUUID',p_operation_id,'name',v_item.data->>'name',
      'description',coalesce(v_item.data->>'description',''),'itemUUID',v_item_id,
      'category',coalesce(v_item.data->>'category','Other'),
      'currencyType',coalesce(v_item.data->>'currencyType','tokens'),
      'quantity',v_quantity,'unitCost',v_unit_cost,'totalCost',v_unit_cost*v_quantity,
      'cost',v_unit_cost*v_quantity,'createdAt',p_occurred_at,'completedAt',p_occurred_at
    );
    v_inventory_records := v_inventory_records || jsonb_build_array((select data from public.shop_inventory where owner_id=v_owner_id and inventory_id=v_inventory_id));
    v_catalog_records := v_catalog_records || jsonb_build_array(v_item.data);
    v_ledger_records := v_ledger_records || jsonb_build_array(v_existing);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item',v_item.data,'qty',v_quantity,'unitCost',v_unit_cost,
      'totalCost',v_unit_cost*v_quantity,'currencyType',coalesce(v_item.data->>'currencyType','tokens'),
      'ledgerUUID',v_ledger_id
    ));
  end loop;
  select coalesce(jsonb_agg(data order by inventory_id),'[]'::jsonb) into v_player_inventory
  from public.shop_inventory where owner_id=v_owner_id and player_id=p_player_id;
  v_result := jsonb_build_object(
    'purchaseBatchUUID',p_operation_id,'occurredAt',p_occurred_at,'player',v_player_data,
    'globalMoneyAfter',v_cash.money-v_total_cash,'tokenCost',v_total_tokens,
    'dollarCost',v_total_cash,'itemCount',v_item_count,'items',v_items,
    'inventoryRecords',v_inventory_records,'playerInventory',v_player_inventory,
    'catalogRecords',v_catalog_records,'ledgerRecords',v_ledger_records,'duplicate',false
  );
  insert into public.shop_purchase_receipts(owner_id,operation_id,player_id,result_json)
  values(v_owner_id,p_operation_id,p_player_id,v_result);
  insert into public.sync_log(
    owner_id,operation_id,player_id,origin_device_id,device_sequence,command_type,
    entity_type,entity_id,base_version,payload,occurred_at,status,result_json
  ) values(
    v_owner_id,p_operation_id,p_player_id,p_device_id,null,'purchaseShopItems',
    'shop-purchase',p_operation_id,null,v_result,p_occurred_at,'accepted',
    jsonb_build_object('operationId',p_operation_id,'status','accepted')
  ) returning server_sequence into v_server_sequence;
  v_result := v_result || jsonb_build_object('serverSequence',v_server_sequence,'acceptedAt',v_now);
  update public.shop_purchase_receipts set result_json=v_result where owner_id=v_owner_id and operation_id=p_operation_id;
  update public.sync_log set result_json=jsonb_build_object(
    'operationId',p_operation_id,'status','accepted','serverSequence',v_server_sequence,'acceptedAt',v_now
  ) where server_sequence=v_server_sequence;
  return v_result;
end;
$$;

revoke all on function public.purchase_shop_items(text,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.purchase_shop_items(text,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.apply_shop_reward_balance()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.command_type='recordRewardProvenance'
     and coalesce(new.data->>'rewardType','') in ('tokens','coins')
     and coalesce((new.data->>'amount')::bigint,0)>0 then
    update public.shop_player_balances set
      tokens=tokens+(new.data->>'amount')::bigint,
      player_data=player_data || jsonb_build_object('tokens',tokens+(new.data->>'amount')::bigint),
      updated_at=now()
    where owner_id=new.owner_id and player_id=new.player_id;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_reward_balance_trigger on public.sync_events;
create trigger shop_reward_balance_trigger after insert on public.sync_events
for each row execute function public.apply_shop_reward_balance();
