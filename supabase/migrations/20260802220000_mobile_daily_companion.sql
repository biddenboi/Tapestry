-- Mobile daily-life companion: append-only Goal updates, private compressed
-- image resources, and immutable duration-effect cancellation receipts.

alter table public.mobile_reference_records
  add column if not exists publish_token text;
alter table public.mobile_reference_records
  drop constraint if exists mobile_reference_type;
alter table public.mobile_reference_records
  add constraint mobile_reference_type check(record_type in (
    'profile','task','completed-task','task-completion-event','task-completion-receipt','reminder',
    'goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution',
    'action-plan','action-session','handoff','match','match-score-event','reward-provenance',
    'world-consequence-receipt','shop-catalog','inventory','transaction','journal',
    'chronicle-entry-metadata','chronicle-entry-revision','chronicle-entry-access',
    'chronicle-story','chronicle-story-entry','chronicle-entry-link','chronicle-reaction',
    'event','event-log','event-buff','achievement-event','achievement-state','achievement-receipt',
    'friendship','notification','routine-run','routine-step-receipt','effect-interval','effect-cancellation'
  ));

create table if not exists public.mobile_reference_publish_sessions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  publish_token text not null,
  started_at timestamptz not null default now()
);
alter table public.mobile_reference_publish_sessions enable row level security;
revoke all on public.mobile_reference_publish_sessions from anon,authenticated;

create or replace function public.begin_mobile_reference_publish()
returns text
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_token text;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  v_token := md5(v_owner_id::text || clock_timestamp()::text || random()::text);
  insert into public.mobile_reference_publish_sessions(owner_id,publish_token,started_at)
  values(v_owner_id,v_token,now())
  on conflict(owner_id) do update set publish_token=excluded.publish_token,started_at=excluded.started_at;
  return v_token;
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
    v_updated_at := coalesce(nullif(v_record->>'updatedAt','')::timestamptz,now());
    if v_type not in (
         'profile','task','completed-task','task-completion-event','task-completion-receipt','reminder',
         'goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution',
         'action-plan','action-session','handoff','match','match-score-event','reward-provenance',
         'world-consequence-receipt','shop-catalog','inventory','transaction','journal',
         'chronicle-entry-metadata','chronicle-entry-revision','chronicle-entry-access',
         'chronicle-story','chronicle-story-entry','chronicle-entry-link','chronicle-reaction',
         'event','event-log','event-buff','achievement-event','achievement-state','achievement-receipt',
         'friendship','notification','routine-run','routine-step-receipt','effect-interval','effect-cancellation'
       )
       or coalesce(char_length(v_id),0) not between 1 and 500
       or jsonb_typeof(v_record->'data')<>'object'
       or octet_length((v_record->'data')::text)>1048576 then
      raise exception 'A mobile working-set record is invalid.' using errcode='22023';
    end if;
    insert into public.mobile_reference_records(
      owner_id,record_type,record_id,player_id,data,record_updated_at,received_at,publish_token
    ) values(
      v_owner_id,v_type,v_id,v_player_id,v_record->'data',v_updated_at,now(),p_publish_token
    )
    on conflict(owner_id,record_type,record_id) do update set
      player_id=excluded.player_id,data=excluded.data,
      record_updated_at=excluded.record_updated_at,received_at=excluded.received_at,
      publish_token=excluded.publish_token;
    v_merged := v_merged+1;
  end loop;
  return jsonb_build_object('merged',v_merged,'receivedAt',now());
end;
$$;

create or replace function public.finalize_mobile_reference_publish(p_publish_token text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_deleted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':mobile-reference-publish',0));
  if not exists(
    select 1 from public.mobile_reference_publish_sessions
    where owner_id=v_owner_id and publish_token=p_publish_token
  ) then
    raise exception 'The mobile working-set publish session is no longer active.' using errcode='22023';
  end if;
  delete from public.mobile_reference_records
  where owner_id=v_owner_id and publish_token is distinct from p_publish_token;
  get diagnostics v_deleted=row_count;
  delete from public.mobile_reference_publish_sessions where owner_id=v_owner_id and publish_token=p_publish_token;
  return jsonb_build_object('published',true,'pruned',v_deleted,'publishedAt',now());
end;
$$;

revoke all on function public.begin_mobile_reference_publish() from public,anon;
revoke all on function public.merge_mobile_reference_publish(text,jsonb) from public,anon;
revoke all on function public.finalize_mobile_reference_publish(text) from public,anon;
grant execute on function public.begin_mobile_reference_publish() to authenticated;
grant execute on function public.merge_mobile_reference_publish(text,jsonb) to authenticated;
grant execute on function public.finalize_mobile_reference_publish(text) to authenticated;

create or replace function public.prune_mobile_reference_after_sync_delete()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.status='accepted' and new.command_type='deleteTask' then
    delete from public.mobile_reference_records
    where owner_id=new.owner_id and record_type='task' and record_id=new.entity_id;
  elsif new.status='accepted' and new.command_type='deleteReminder' then
    delete from public.mobile_reference_records
    where owner_id=new.owner_id and record_type='reminder' and record_id=new.entity_id;
  elsif new.status='accepted' and new.command_type='deleteMoment' then
    delete from public.mobile_reference_records
    where owner_id=new.owner_id and record_type='journal' and record_id=new.entity_id;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_log_prune_mobile_reference_delete on public.sync_log;
create trigger sync_log_prune_mobile_reference_delete
after insert on public.sync_log
for each row execute function public.prune_mobile_reference_after_sync_delete();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'tapestry-mobile-resources','tapestry-mobile-resources',false,524288,
  array['image/png','image/jpeg','image/gif','image/webp','application/octet-stream']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.mobile_resource_metadata (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null,
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  byte_size bigint not null check(byte_size > 0 and byte_size <= 524288),
  width integer,
  height integer,
  kind text not null default 'image',
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,resource_id),
  unique(owner_id,content_hash),
  check(storage_path = owner_id::text || '/' || content_hash)
);
alter table public.mobile_resource_metadata enable row level security;
revoke all on public.mobile_resource_metadata from anon;
grant select,insert,update on public.mobile_resource_metadata to authenticated;
drop policy if exists mobile_resource_metadata_owner_select on public.mobile_resource_metadata;
drop policy if exists mobile_resource_metadata_owner_insert on public.mobile_resource_metadata;
drop policy if exists mobile_resource_metadata_owner_update on public.mobile_resource_metadata;
create policy mobile_resource_metadata_owner_select on public.mobile_resource_metadata
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());
create policy mobile_resource_metadata_owner_insert on public.mobile_resource_metadata
  for insert to authenticated with check(owner_id=auth.uid() and public.is_tapestry_owner());
create policy mobile_resource_metadata_owner_update on public.mobile_resource_metadata
  for update to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner())
  with check(owner_id=auth.uid() and public.is_tapestry_owner());

drop policy if exists tapestry_mobile_resource_select on storage.objects;
drop policy if exists tapestry_mobile_resource_insert on storage.objects;
create policy tapestry_mobile_resource_select on storage.objects
  for select to authenticated
  using(
    bucket_id='tapestry-mobile-resources'
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.is_tapestry_owner()
  );
create policy tapestry_mobile_resource_insert on storage.objects
  for insert to authenticated
  with check(
    bucket_id='tapestry-mobile-resources'
    and (storage.foldername(name))[1]=auth.uid()::text
    and public.is_tapestry_owner()
  );

create or replace function public.apply_goal_sync_batch(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_operation jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_existing_result jsonb;
  v_operation_id text;
  v_device_id text;
  v_entity_id text;
  v_player_id text;
  v_payload jsonb;
  v_occurred_at timestamptz;
  v_device_sequence bigint;
  v_server_sequence bigint;
  v_existing_event_id text;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations)>100 then
    raise exception 'Goal operations must be a bounded JSON array.' using errcode='22023';
  end if;
  for v_operation in select value from jsonb_array_elements(p_operations)
  loop
    v_operation_id := null;
    v_result := null;
    begin
      v_operation_id := trim(coalesce(v_operation->>'operationId',''));
      v_device_id := trim(coalesce(v_operation->>'deviceId',''));
      v_entity_id := trim(coalesce(v_operation->>'entityId',''));
      v_player_id := nullif(v_operation->>'playerId','');
      v_payload := coalesce(v_operation->'payload','{}'::jsonb);
      v_device_sequence := nullif(v_operation->>'deviceSequence','')::bigint;
      v_occurred_at := coalesce(nullif(v_operation->>'occurredAt','')::timestamptz,now());
      if v_operation_id='' or char_length(v_operation_id)>500
         or v_device_id='' or char_length(v_device_id)>200
         or v_entity_id='' or char_length(v_entity_id)>500
         or v_operation->>'commandType'<>'recordGoalUpdate'
         or v_operation->>'entityType'<>'goal-update'
         or jsonb_typeof(v_payload->'goal')<>'object'
         or jsonb_typeof(v_payload->'update')<>'object'
         or coalesce(v_payload->'update'->>'UUID','')<>v_entity_id then
        raise exception 'The Goal update operation is invalid.' using errcode='22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':' || v_operation_id,0));
      select result_json into v_existing_result from public.sync_log
      where owner_id=v_owner_id and operation_id=v_operation_id;
      if found then
        v_results := v_results || jsonb_build_array(v_existing_result);
        continue;
      end if;
      if not exists(select 1 from public.sync_devices where owner_id=v_owner_id and device_id=v_device_id and retired_at is null) then
        raise exception 'The sync device is not registered.' using errcode='42501';
      end if;
      select event_id into v_existing_event_id from public.sync_events
      where owner_id=v_owner_id and command_type='recordGoalUpdate'
        and entity_type='goal-update' and entity_id=v_entity_id;
      if not found then
        insert into public.sync_events(owner_id,event_id,player_id,command_type,entity_type,entity_id,data,occurred_at,origin_device_id)
        values(v_owner_id,v_operation_id,v_player_id,'recordGoalUpdate','goal-update',v_entity_id,v_payload,v_occurred_at,v_device_id);
        v_existing_event_id := v_operation_id;
      end if;
      v_result := jsonb_build_object(
        'operationId',v_operation_id,'status','accepted','eventId',v_existing_event_id,
        'duplicateOf',case when v_existing_event_id=v_operation_id then null else v_existing_event_id end
      );
      insert into public.sync_log(
        owner_id,operation_id,player_id,origin_device_id,device_sequence,command_type,
        entity_type,entity_id,base_version,payload,occurred_at,status,result_json
      ) values(
        v_owner_id,v_operation_id,v_player_id,v_device_id,v_device_sequence,'recordGoalUpdate',
        'goal-update',v_entity_id,null,v_payload,v_occurred_at,'accepted',v_result
      ) returning server_sequence into v_server_sequence;
      v_result := v_result || jsonb_build_object('serverSequence',v_server_sequence,'acceptedAt',now());
      update public.sync_log set result_json=v_result where server_sequence=v_server_sequence;
      update public.sync_devices set last_seen_at=now() where owner_id=v_owner_id and device_id=v_device_id;
    exception when others then
      if sqlstate not in ('22023','42501','22P02','22007') then raise; end if;
      v_result := jsonb_build_object(
        'operationId',coalesce(nullif(v_operation_id,''),'invalid'),'status','rejected',
        'errorCode',case when sqlstate='42501' then 'forbidden' else 'invalid-operation' end,
        'message',sqlerrm
      );
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return v_results;
end;
$$;
revoke all on function public.apply_goal_sync_batch(jsonb) from public,anon;
grant execute on function public.apply_goal_sync_batch(jsonb) to authenticated;

create table if not exists public.shop_effect_cancellation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  cancellation_id text not null,
  interval_id text not null,
  player_id text not null,
  device_id text not null,
  operation_id text not null,
  cancelled_at timestamptz not null,
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default now(),
  primary key(owner_id,cancellation_id),
  unique(owner_id,interval_id),
  unique(owner_id,operation_id),
  foreign key(owner_id,interval_id) references public.shop_effect_intervals(owner_id,interval_id) on delete restrict
);
alter table public.shop_effect_cancellation_receipts enable row level security;
revoke all on public.shop_effect_cancellation_receipts from anon,authenticated;
grant select on public.shop_effect_cancellation_receipts to authenticated;
drop policy if exists shop_effect_cancellation_owner_select on public.shop_effect_cancellation_receipts;
create policy shop_effect_cancellation_owner_select on public.shop_effect_cancellation_receipts
  for select to authenticated using(owner_id=auth.uid() and public.is_tapestry_owner());

create or replace function public.cancel_shop_effect(
  p_operation_id text,
  p_device_id text,
  p_player_id text,
  p_interval_id text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_now timestamptz := now();
  v_cancellation_id text;
  v_receipt jsonb;
  v_result jsonb;
  v_server_sequence bigint;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if coalesce(char_length(trim(p_operation_id)),0) not between 1 and 500
     or coalesce(char_length(trim(p_device_id)),0) not between 1 and 200
     or coalesce(char_length(trim(p_player_id)),0) not between 1 and 500
     or coalesce(char_length(trim(p_interval_id)),0) not between 1 and 500 then
    raise exception 'The effect cancellation command is invalid.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':effect-cancellation:' || p_interval_id,0));
  select result_json into v_result from public.shop_effect_cancellation_receipts
  where owner_id=v_owner_id and (operation_id=p_operation_id or interval_id=p_interval_id)
  order by (operation_id=p_operation_id) desc limit 1;
  if found then return v_result || jsonb_build_object('duplicate',true); end if;
  if not exists(select 1 from public.sync_devices where owner_id=v_owner_id and device_id=p_device_id and retired_at is null) then
    raise exception 'The sync device is not registered.' using errcode='42501';
  end if;
  if not exists(select 1 from public.shop_effect_intervals where owner_id=v_owner_id and interval_id=p_interval_id and player_id=p_player_id) then
    raise exception 'The duration effect is unavailable.' using errcode='22023';
  end if;
  v_cancellation_id := 'shop-effect-cancellation:' || p_interval_id;
  v_receipt := jsonb_build_object(
    'id',v_cancellation_id,'intervalId',p_interval_id,'playerId',p_player_id,
    'deviceId',p_device_id,'operationId',p_operation_id,'cancelledAt',v_now,'createdAt',v_now
  );
  v_result := jsonb_build_object(
    'operationId',p_operation_id,'cancellationReceipt',v_receipt,'cancelledAt',v_now,'duplicate',false
  );
  insert into public.shop_effect_cancellation_receipts(
    owner_id,cancellation_id,interval_id,player_id,device_id,operation_id,cancelled_at,result_json,created_at
  ) values(v_owner_id,v_cancellation_id,p_interval_id,p_player_id,p_device_id,p_operation_id,v_now,v_result,v_now);
  insert into public.sync_events(owner_id,event_id,player_id,command_type,entity_type,entity_id,data,occurred_at,origin_device_id)
  values(v_owner_id,p_operation_id,p_player_id,'cancelShopEffect','shop-effect-cancellation',p_interval_id,v_result,v_now,p_device_id);
  insert into public.sync_log(
    owner_id,operation_id,player_id,origin_device_id,device_sequence,command_type,
    entity_type,entity_id,base_version,payload,occurred_at,status,result_json
  ) values(
    v_owner_id,p_operation_id,p_player_id,p_device_id,null,'cancelShopEffect',
    'shop-effect-cancellation',p_interval_id,null,v_result,v_now,'accepted',
    jsonb_build_object('operationId',p_operation_id,'status','accepted')
  ) returning server_sequence into v_server_sequence;
  v_result := v_result || jsonb_build_object('serverSequence',v_server_sequence,'acceptedAt',v_now);
  update public.shop_effect_cancellation_receipts set result_json=v_result
    where owner_id=v_owner_id and cancellation_id=v_cancellation_id;
  update public.sync_log set result_json=jsonb_build_object(
    'operationId',p_operation_id,'status','accepted','serverSequence',v_server_sequence,'acceptedAt',v_now
  ) where server_sequence=v_server_sequence;
  return v_result;
end;
$$;
revoke all on function public.cancel_shop_effect(text,text,text,text) from public,anon;
grant execute on function public.cancel_shop_effect(text,text,text,text) to authenticated;
