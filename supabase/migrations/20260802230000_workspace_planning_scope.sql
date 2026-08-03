-- Phase 1 mobile correctness: planning records are workspace-visible while
-- player_id remains reserved for authorship, rewards, and session attribution.
alter table public.mobile_reference_records
  add column if not exists workspace_id text;

create index if not exists mobile_reference_owner_workspace_idx
  on public.mobile_reference_records(owner_id,workspace_id,record_type,record_updated_at desc);

alter table public.sync_log
  add column if not exists workspace_id text;

create index if not exists sync_log_owner_workspace_sequence_idx
  on public.sync_log(owner_id,workspace_id,server_sequence);

-- Every command transport mirrors the workspace scope into payload.workspaceId.
-- A trigger keeps this compatible with the existing narrow command RPCs while
-- making the scope a first-class pull-log field.
create or replace function public.set_sync_log_workspace_scope()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  new.workspace_id := coalesce(
    nullif(trim(coalesce(new.workspace_id,'')),''),
    nullif(trim(coalesce(new.payload->>'workspaceId','')),'')
  );
  return new;
end;
$$;

drop trigger if exists sync_log_workspace_scope_before_write on public.sync_log;
create trigger sync_log_workspace_scope_before_write
before insert or update of payload,workspace_id on public.sync_log
for each row execute function public.set_sync_log_workspace_scope();

update public.sync_log
set workspace_id=nullif(trim(coalesce(payload->>'workspaceId','')),'')
where workspace_id is null and payload ? 'workspaceId';

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
  v_workspace_id text;
  v_updated_at timestamptz;
  v_merged integer := 0;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>1000 then
    raise exception 'Bootstrap records must be an array of at most 1000 entries.' using errcode='22023';
  end if;
  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_type := trim(coalesce(v_record->>'recordType',''));
    v_id := trim(coalesce(v_record->>'recordId',''));
    v_player_id := nullif(trim(coalesce(v_record->>'playerId','')),'');
    v_workspace_id := nullif(trim(coalesce(v_record->>'workspaceId','')),'');
    v_updated_at := coalesce(nullif(v_record->>'updatedAt','')::timestamptz,now());
    if coalesce(char_length(v_type),0) not between 1 and 100
       or coalesce(char_length(v_id),0) not between 1 and 500
       or jsonb_typeof(v_record->'data')<>'object'
       or octet_length((v_record->'data')::text)>1048576 then
      raise exception 'A mobile bootstrap record is invalid.' using errcode='22023';
    end if;
    insert into public.mobile_reference_records(
      owner_id,record_type,record_id,player_id,workspace_id,data,record_updated_at,received_at
    ) values(
      v_owner_id,v_type,v_id,v_player_id,v_workspace_id,v_record->'data',v_updated_at,now()
    )
    on conflict(owner_id,record_type,record_id) do update set
      player_id=excluded.player_id,
      workspace_id=excluded.workspace_id,
      data=excluded.data,
      record_updated_at=excluded.record_updated_at,
      received_at=excluded.received_at
    where public.mobile_reference_records.record_updated_at<=excluded.record_updated_at;
    v_merged := v_merged+1;
  end loop;
  return jsonb_build_object('merged',v_merged,'receivedAt',now());
end;
$$;

create or replace function public.merge_mobile_reference_publish(p_publish_token text,p_records jsonb)
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
  v_workspace_id text;
  v_updated_at timestamptz;
  v_merged integer := 0;
begin
  if not exists(
    select 1 from public.mobile_reference_publish_sessions
    where owner_id=v_owner_id and publish_token=p_publish_token
  ) then
    raise exception 'The mobile working-set publish session is no longer active.' using errcode='22023';
  end if;
  if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>500 then
    raise exception 'Working-set records must be an array of at most 500 entries.' using errcode='22023';
  end if;
  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_type := trim(coalesce(v_record->>'recordType',''));
    v_id := trim(coalesce(v_record->>'recordId',''));
    v_player_id := nullif(trim(coalesce(v_record->>'playerId','')),'');
    v_workspace_id := nullif(trim(coalesce(v_record->>'workspaceId','')),'');
    v_updated_at := coalesce(nullif(v_record->>'updatedAt','')::timestamptz,now());
    if coalesce(char_length(v_type),0) not between 1 and 100
       or coalesce(char_length(v_id),0) not between 1 and 500
       or jsonb_typeof(v_record->'data')<>'object'
       or octet_length((v_record->'data')::text)>1048576 then
      raise exception 'A mobile working-set record is invalid.' using errcode='22023';
    end if;
    insert into public.mobile_reference_records(
      owner_id,record_type,record_id,player_id,workspace_id,data,record_updated_at,received_at,publish_token
    ) values(
      v_owner_id,v_type,v_id,v_player_id,v_workspace_id,v_record->'data',v_updated_at,now(),p_publish_token
    )
    on conflict(owner_id,record_type,record_id) do update set
      player_id=excluded.player_id,
      workspace_id=excluded.workspace_id,
      data=excluded.data,
      record_updated_at=excluded.record_updated_at,
      received_at=excluded.received_at,
      publish_token=excluded.publish_token;
    v_merged := v_merged+1;
  end loop;
  return jsonb_build_object('merged',v_merged,'receivedAt',now());
end;
$$;

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
      'recordType',record_type,'recordId',record_id,'workspaceId',workspace_id,
      'playerId',player_id,'data',data,'updatedAt',record_updated_at
    ) order by record_type,record_id)
    from public.mobile_reference_records where owner_id=v_owner_id
  ),'[]'::jsonb);
end;
$$;

create or replace function public.get_mobile_reference_records_by_type(p_record_types text[])
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
  if coalesce(array_length(p_record_types,1),0) not between 1 and 50 then
    raise exception 'Bootstrap record filters must contain between 1 and 50 types.' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'recordType',record_type,'recordId',record_id,'workspaceId',workspace_id,
      'playerId',player_id,'data',data,'updatedAt',record_updated_at
    ) order by record_type,record_id)
    from public.mobile_reference_records
    where owner_id=v_owner_id and record_type=any(p_record_types)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.merge_mobile_reference_records(jsonb) from public,anon;
revoke all on function public.merge_mobile_reference_publish(text,jsonb) from public,anon;
revoke all on function public.get_mobile_reference_records() from public,anon;
revoke all on function public.get_mobile_reference_records_by_type(text[]) from public,anon;
grant execute on function public.merge_mobile_reference_records(jsonb) to authenticated;
grant execute on function public.merge_mobile_reference_publish(text,jsonb) to authenticated;
grant execute on function public.get_mobile_reference_records() to authenticated;
grant execute on function public.get_mobile_reference_records_by_type(text[]) to authenticated;

drop function if exists public.pull_sync_log(bigint,integer);
create function public.pull_sync_log(
  p_after bigint default 0,
  p_limit integer default 100
)
returns table (
  server_sequence bigint,
  operation_id text,
  player_id text,
  workspace_id text,
  origin_device_id text,
  device_sequence bigint,
  command_type text,
  entity_type text,
  entity_id text,
  base_version bigint,
  payload jsonb,
  occurred_at timestamptz,
  status text,
  accepted_at timestamptz,
  result_json jsonb
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  return query
    select log.server_sequence,log.operation_id,log.player_id,log.workspace_id,
      log.origin_device_id,log.device_sequence,log.command_type,
      log.entity_type,log.entity_id,log.base_version,log.payload,
      log.occurred_at,log.status,log.accepted_at,log.result_json
    from public.sync_log log
    where log.owner_id=auth.uid()
      and log.server_sequence>greatest(coalesce(p_after,0),0)
    order by log.server_sequence
    limit least(greatest(coalesce(p_limit,100),1),500);
end;
$$;

revoke all on function public.pull_sync_log(bigint,integer) from public,anon;
grant execute on function public.pull_sync_log(bigint,integer) to authenticated;
