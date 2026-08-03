-- Read-only canonical Shop snapshot used after rejected races and on reconnect.
create or replace function public.get_shop_authority(p_player_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_player public.shop_player_balances;
  v_cash public.shop_cash_balances;
  v_catalog jsonb;
  v_inventory jsonb;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  select * into v_player from public.shop_player_balances
  where owner_id=v_owner_id and player_id=trim(coalesce(p_player_id,''));
  select * into v_cash from public.shop_cash_balances where owner_id=v_owner_id;
  if v_player.owner_id is null or v_cash.owner_id is null then
    raise exception 'Shop authority has not been initialized.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(data order by item_id),'[]'::jsonb) into v_catalog
  from public.shop_catalog where owner_id=v_owner_id;
  select coalesce(jsonb_agg(data order by inventory_id),'[]'::jsonb) into v_inventory
  from public.shop_inventory where owner_id=v_owner_id and player_id=p_player_id;
  return jsonb_build_object(
    'player',v_player.player_data,
    'globalMoneyAfter',v_cash.money,
    'catalogRecords',v_catalog,
    'inventoryRecords',v_inventory,
    'reconciledAt',now()
  );
end;
$$;

revoke all on function public.get_shop_authority(text) from public,anon;
grant execute on function public.get_shop_authority(text) to authenticated;
