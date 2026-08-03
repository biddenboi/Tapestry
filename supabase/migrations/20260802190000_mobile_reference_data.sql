-- Read-oriented profile lookup and Goal reference data for the companion.
-- Updated-at comparison prevents a stale device from replacing newer desktop
-- records while keeping profile selection itself device-local.
create table if not exists public.mobile_reference_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null,
  record_id text not null,
  player_id text,
  data jsonb not null check(jsonb_typeof(data)='object'),
  record_updated_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key(owner_id,record_type,record_id),
  constraint mobile_reference_type check(record_type in (
    'profile','goal','goal-area','goal-milestone','goal-update','goal-link',
    'goal-participant','goal-contribution'
  ))
);
create index if not exists mobile_reference_owner_player_idx
  on public.mobile_reference_records(owner_id,player_id,record_type,record_updated_at desc);
alter table public.mobile_reference_records enable row level security;
revoke all on public.mobile_reference_records from anon;
grant select on public.mobile_reference_records to authenticated;
drop policy if exists mobile_reference_owner_select on public.mobile_reference_records;
create policy mobile_reference_owner_select on public.mobile_reference_records
  for select to authenticated
  using(owner_id=auth.uid() and public.is_tapestry_owner());
revoke insert,update,delete,truncate on public.mobile_reference_records from anon,authenticated;

create or replace function public.merge_mobile_reference_records(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_record jsonb;
  v_type text;
  v_id text;
  v_player_id text;
  v_updated_at timestamptz;
  v_merged integer := 0;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>1000 then
    raise exception 'Reference records must be an array of at most 1000 entries.' using errcode='22023';
  end if;
  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_type := trim(coalesce(v_record->>'recordType',''));
    v_id := trim(coalesce(v_record->>'recordId',''));
    v_player_id := nullif(trim(coalesce(v_record->>'playerId','')),'');
    v_updated_at := coalesce(nullif(v_record->>'updatedAt','')::timestamptz,now());
    if v_type not in ('profile','goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution')
       or coalesce(char_length(v_id),0) not between 1 and 500
       or jsonb_typeof(v_record->'data')<>'object' then
      raise exception 'A mobile reference record is invalid.' using errcode='22023';
    end if;
    insert into public.mobile_reference_records(
      owner_id,record_type,record_id,player_id,data,record_updated_at,received_at
    ) values(v_owner_id,v_type,v_id,v_player_id,v_record->'data',v_updated_at,now())
    on conflict(owner_id,record_type,record_id) do update set
      player_id=excluded.player_id,
      data=excluded.data,
      record_updated_at=excluded.record_updated_at,
      received_at=excluded.received_at
    where public.mobile_reference_records.record_updated_at<=excluded.record_updated_at;
    v_merged := v_merged+1;
  end loop;
  return jsonb_build_object('merged',v_merged,'receivedAt',now());
end;
$$;

revoke all on function public.merge_mobile_reference_records(jsonb) from public,anon;
grant execute on function public.merge_mobile_reference_records(jsonb) to authenticated;

create or replace function public.get_mobile_reference_records()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'recordType',record_type,'recordId',record_id,'playerId',player_id,
      'data',data,'updatedAt',record_updated_at
    ) order by record_type,record_id)
    from public.mobile_reference_records where owner_id=v_owner_id
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_mobile_reference_records() from public,anon;
grant execute on function public.get_mobile_reference_records() to authenticated;
