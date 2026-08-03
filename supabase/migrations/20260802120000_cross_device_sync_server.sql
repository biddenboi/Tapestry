-- Tapestry cross-device sync control plane.
-- The browser never receives a service-role key and never supplies a trusted
-- owner id. Every RPC derives its owner from auth.uid() and the approved email.

create extension if not exists citext with schema extensions;

create table public.tapestry_owner_allowlist (
  email extensions.citext primary key,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.tapestry_owner_allowlist (email)
values ('yujinpetercho@gmail.com')
on conflict (email) do update set enabled = true;

revoke all on public.tapestry_owner_allowlist from anon, authenticated;

create or replace function public.is_tapestry_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tapestry_owner_allowlist allowed
    where allowed.enabled
      and lower(allowed.email::text) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_tapestry_owner() from public, anon;
grant execute on function public.is_tapestry_owner() to authenticated;

create table public.sync_devices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  display_name text not null,
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (owner_id, device_id),
  constraint sync_devices_device_id_length check (char_length(device_id) between 1 and 200),
  constraint sync_devices_display_name_length check (char_length(display_name) between 1 and 200)
);

create table public.sync_entities (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  player_id text,
  version bigint not null default 1 check (version > 0),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by_device_id text not null,
  deleted_at timestamptz,
  primary key (owner_id, entity_type, entity_id),
  constraint sync_entities_type_length check (char_length(entity_type) between 1 and 120),
  constraint sync_entities_id_length check (char_length(entity_id) between 1 and 500)
);

create index sync_entities_owner_updated_idx
  on public.sync_entities (owner_id, updated_at desc);

create table public.sync_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  player_id text,
  command_type text not null,
  entity_type text not null,
  entity_id text not null,
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  origin_device_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, event_id),
  constraint sync_events_data_shape check (jsonb_typeof(data) = 'object')
);

create index sync_events_owner_occurred_idx
  on public.sync_events (owner_id, occurred_at desc);

create unique index sync_events_owner_evidence_idx
  on public.sync_events (owner_id, command_type, entity_type, entity_id);

create table public.sync_log (
  server_sequence bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  player_id text,
  origin_device_id text not null,
  device_sequence bigint,
  command_type text not null,
  entity_type text not null,
  entity_id text not null,
  base_version bigint,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  status text not null check (status in ('accepted', 'conflict', 'rejected')),
  result_json jsonb not null,
  accepted_at timestamptz not null default now(),
  unique (owner_id, operation_id),
  constraint sync_log_payload_shape check (jsonb_typeof(payload) = 'object')
);

create index sync_log_owner_sequence_idx
  on public.sync_log (owner_id, server_sequence);

alter table public.sync_devices enable row level security;
alter table public.sync_entities enable row level security;
alter table public.sync_events enable row level security;
alter table public.sync_log enable row level security;
alter table public.tapestry_owner_allowlist enable row level security;

revoke all on public.sync_devices from anon;
revoke all on public.sync_entities from anon;
revoke all on public.sync_events from anon;
revoke all on public.sync_log from anon;
grant select on public.sync_devices to authenticated;
grant select on public.sync_entities to authenticated;
grant select on public.sync_events to authenticated;
grant select on public.sync_log to authenticated;

create policy sync_devices_owner_select on public.sync_devices
  for select to authenticated
  using (owner_id = auth.uid() and public.is_tapestry_owner());

create policy sync_entities_owner_select on public.sync_entities
  for select to authenticated
  using (owner_id = auth.uid() and public.is_tapestry_owner());

create policy sync_events_owner_select on public.sync_events
  for select to authenticated
  using (owner_id = auth.uid() and public.is_tapestry_owner());

create policy sync_log_owner_select on public.sync_log
  for select to authenticated
  using (owner_id = auth.uid() and public.is_tapestry_owner());

revoke insert, update, delete, truncate on public.sync_devices from anon, authenticated;
revoke insert, update, delete, truncate on public.sync_entities from anon, authenticated;
revoke insert, update, delete, truncate on public.sync_events from anon, authenticated;
revoke insert, update, delete, truncate on public.sync_log from anon, authenticated;

create or replace function public.register_sync_device(
  p_device_id text,
  p_display_name text,
  p_platform text default 'web'
)
returns public.sync_devices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_device public.sync_devices;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode = '42501';
  end if;
  if coalesce(char_length(trim(p_device_id)), 0) not between 1 and 200
     or coalesce(char_length(trim(p_display_name)), 0) not between 1 and 200 then
    raise exception 'A valid device id and display name are required.' using errcode = '22023';
  end if;

  insert into public.sync_devices (
    owner_id, device_id, display_name, platform, last_seen_at, retired_at
  ) values (
    v_owner_id, trim(p_device_id), trim(p_display_name), left(coalesce(nullif(trim(p_platform), ''), 'web'), 80), now(), null
  )
  on conflict (owner_id, device_id) do update set
    display_name = excluded.display_name,
    platform = excluded.platform,
    last_seen_at = excluded.last_seen_at,
    retired_at = null
  returning * into v_device;

  return v_device;
end;
$$;

revoke all on function public.register_sync_device(text, text, text) from public, anon;
grant execute on function public.register_sync_device(text, text, text) to authenticated;

create or replace function public.apply_sync_batch(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_operation jsonb;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_existing_result jsonb;
  v_operation_id text;
  v_device_id text;
  v_command_type text;
  v_entity_type text;
  v_entity_id text;
  v_player_id text;
  v_payload jsonb;
  v_occurred_at timestamptz;
  v_base_version bigint;
  v_device_sequence bigint;
  v_expected_entity_type text;
  v_is_event boolean;
  v_is_delete boolean;
  v_server_sequence bigint;
  v_current public.sync_entities;
  v_next_data jsonb;
  v_next_version bigint;
  v_status text;
  v_existing_event_id text;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operations) <> 'array' then
    raise exception 'Sync operations must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operations) > 100 then
    raise exception 'A sync batch cannot contain more than 100 operations.' using errcode = '22023';
  end if;

  for v_operation in select value from jsonb_array_elements(p_operations)
  loop
    v_operation_id := null;
    v_device_id := null;
    v_command_type := null;
    v_entity_type := null;
    v_entity_id := null;
    v_result := null;
    begin
      if jsonb_typeof(v_operation) <> 'object' then
        raise exception 'Each sync operation must be a JSON object.' using errcode = '22023';
      end if;

      v_operation_id := trim(coalesce(v_operation ->> 'operationId', ''));
      v_device_id := trim(coalesce(v_operation ->> 'deviceId', ''));
      v_command_type := trim(coalesce(v_operation ->> 'commandType', ''));
      v_entity_type := trim(coalesce(v_operation ->> 'entityType', ''));
      v_entity_id := trim(coalesce(v_operation ->> 'entityId', ''));
      v_player_id := nullif(v_operation ->> 'playerId', '');
      v_payload := coalesce(v_operation -> 'payload', '{}'::jsonb);
      v_base_version := nullif(v_operation ->> 'baseVersion', '')::bigint;
      v_device_sequence := nullif(v_operation ->> 'deviceSequence', '')::bigint;
      v_occurred_at := coalesce(nullif(v_operation ->> 'occurredAt', '')::timestamptz, now());

      if v_operation_id = '' or char_length(v_operation_id) > 500
         or v_device_id = '' or char_length(v_device_id) > 200
         or v_command_type = '' or char_length(v_command_type) > 120
         or v_entity_type = '' or char_length(v_entity_type) > 120
         or v_entity_id = '' or char_length(v_entity_id) > 500
         or jsonb_typeof(v_payload) <> 'object' then
        raise exception 'The sync operation has invalid required fields.' using errcode = '22023';
      end if;

      -- Serialize identical operation IDs before the idempotency lookup. This
      -- closes the race between concurrent retries without locking unrelated
      -- commands or trusting a client-supplied owner identifier.
      perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':' || v_operation_id, 0));

      select log.result_json into v_existing_result
      from public.sync_log log
      where log.owner_id = v_owner_id and log.operation_id = v_operation_id;
      if found then
        v_results := v_results || jsonb_build_array(v_existing_result);
        continue;
      end if;

      if not exists (
        select 1 from public.sync_devices device
        where device.owner_id = v_owner_id
          and device.device_id = v_device_id
          and device.retired_at is null
      ) then
        raise exception 'The sync device is not registered.' using errcode = '42501';
      end if;

      v_expected_entity_type := case v_command_type
        when 'createTask' then 'task'
        when 'updateTask' then 'task'
        when 'deleteTask' then 'task'
        when 'completeTaskOccurrence' then 'task-occurrence'
        when 'completeReminder' then 'reminder'
        when 'dismissReminder' then 'reminder'
        when 'snoozeReminder' then 'reminder'
        when 'createReminder' then 'reminder'
        when 'updateReminder' then 'reminder'
        when 'deleteReminder' then 'reminder'
        when 'startActionSession' then 'action-session'
        when 'pauseActionSession' then 'action-session'
        when 'resumeActionSession' then 'action-session'
        when 'takeOverActionSession' then 'action-session'
        when 'finalizeActionSession' then 'action-session'
        when 'finalizeMatchActionSessionScore' then 'match-score-event'
        when 'recordMatchScoreEvent' then 'match-score-event'
        when 'recordRewardProvenance' then 'reward-provenance'
        when 'createMoment' then 'moment'
        when 'updateMoment' then 'moment'
        when 'deleteMoment' then 'moment'
        when 'purchaseShopItems' then 'shop-purchase'
        else null
      end;

      if v_expected_entity_type is null or v_expected_entity_type <> v_entity_type then
        raise exception 'Unsupported sync command or entity type.' using errcode = '22023';
      end if;

      -- Purchases remain an explicit online/server-authoritative boundary. They
      -- are intentionally rejected until the purchase RPC performs its own
      -- balance check and atomic ledger write.
      if v_command_type = 'purchaseShopItems' then
        v_status := 'rejected';
        v_result := jsonb_build_object(
          'operationId', v_operation_id,
          'status', v_status,
          'errorCode', 'online-command-not-implemented',
          'message', 'Shop purchases require the server-authoritative purchase endpoint.'
        );
      else
        v_is_event := v_command_type in (
          'completeTaskOccurrence',
          'finalizeMatchActionSessionScore',
          'recordMatchScoreEvent',
          'recordRewardProvenance'
        );
        v_is_delete := v_command_type in ('deleteTask', 'deleteReminder', 'deleteMoment');

        if v_is_event then
          select event.event_id into v_existing_event_id
          from public.sync_events event
          where event.owner_id = v_owner_id
            and event.command_type = v_command_type
            and event.entity_type = v_entity_type
            and event.entity_id = v_entity_id;

          if not found then
            insert into public.sync_events (
              owner_id, event_id, player_id, command_type, entity_type, entity_id,
              data, occurred_at, origin_device_id
            ) values (
              v_owner_id, v_operation_id, v_player_id, v_command_type, v_entity_type,
              v_entity_id, v_payload, v_occurred_at, v_device_id
            );
            v_existing_event_id := v_operation_id;
          end if;

          v_status := 'accepted';
          v_result := jsonb_build_object(
            'operationId', v_operation_id,
            'status', v_status,
            'eventId', v_existing_event_id,
            'duplicateOf', case when v_existing_event_id = v_operation_id then null else v_existing_event_id end
          );
        else
          select * into v_current
          from public.sync_entities entity
          where entity.owner_id = v_owner_id
            and entity.entity_type = v_entity_type
            and entity.entity_id = v_entity_id
          for update;

          if v_base_version is not null
             and ((found and v_current.version <> v_base_version)
               or (not found and v_base_version <> 0)) then
            v_status := 'conflict';
            v_result := jsonb_build_object(
              'operationId', v_operation_id,
              'status', v_status,
              'errorCode', 'base-version-conflict',
              'errorMessage', 'The server has a newer entity version.',
              'conflictId', 'sync-conflict:' || v_operation_id,
              'serverVersion', v_current.version,
              'serverPayload', coalesce(v_current.data, '{}'::jsonb),
              'serverEntity', case when v_current.owner_id is null then null else jsonb_build_object(
                'entityType', v_current.entity_type,
                'entityId', v_current.entity_id,
                'version', v_current.version,
                'data', v_current.data,
                'deletedAt', v_current.deleted_at
              ) end
            );
          else
            v_next_version := coalesce(v_current.version, 0) + 1;
            v_next_data := case
              when v_command_type = 'startActionSession' and jsonb_typeof(v_payload -> 'session') = 'object'
                then v_payload -> 'session'
              else coalesce(v_current.data, '{}'::jsonb) || v_payload
            end;

            insert into public.sync_entities (
              owner_id, entity_type, entity_id, player_id, version, data,
              updated_at, updated_by_device_id, deleted_at
            ) values (
              v_owner_id, v_entity_type, v_entity_id, v_player_id,
              v_next_version, v_next_data, v_occurred_at, v_device_id,
              case when v_is_delete then v_occurred_at else null end
            )
            on conflict (owner_id, entity_type, entity_id) do update set
              player_id = coalesce(excluded.player_id, public.sync_entities.player_id),
              version = excluded.version,
              data = excluded.data,
              updated_at = excluded.updated_at,
              updated_by_device_id = excluded.updated_by_device_id,
              deleted_at = excluded.deleted_at;

            v_status := 'accepted';
            v_result := jsonb_build_object(
              'operationId', v_operation_id,
              'status', v_status,
              'entity', jsonb_build_object(
                'entityType', v_entity_type,
                'entityId', v_entity_id,
                'version', v_next_version,
                'data', v_next_data,
                'deletedAt', case when v_is_delete then v_occurred_at else null end
              )
            );
          end if;
        end if;
      end if;

      insert into public.sync_log (
        owner_id, operation_id, player_id, origin_device_id, device_sequence,
        command_type, entity_type, entity_id, base_version, payload, occurred_at,
        status, result_json
      ) values (
        v_owner_id, v_operation_id, v_player_id, v_device_id, v_device_sequence,
        v_command_type, v_entity_type, v_entity_id, v_base_version, v_payload,
        v_occurred_at, v_status, v_result
      ) returning server_sequence into v_server_sequence;

      v_result := v_result || jsonb_build_object(
        'serverSequence', v_server_sequence,
        'acceptedAt', now()
      );
      update public.sync_log
      set result_json = v_result
      where server_sequence = v_server_sequence;

      update public.sync_devices
      set last_seen_at = now()
      where owner_id = v_owner_id and device_id = v_device_id;
    exception when others then
      -- Invalid commands are acknowledged as rejected so clients do not retry
      -- them forever. Database/system failures still abort the batch.
      if sqlstate not in ('22023', '42501', '22P02', '22007') then
        raise;
      end if;
      v_result := jsonb_build_object(
        'operationId', coalesce(nullif(v_operation_id, ''), 'invalid'),
        'status', 'rejected',
        'errorCode', case when sqlstate = '42501' then 'forbidden' else 'invalid-operation' end,
        'message', sqlerrm
      );
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return v_results;
end;
$$;

revoke all on function public.apply_sync_batch(jsonb) from public, anon;
grant execute on function public.apply_sync_batch(jsonb) to authenticated;

create or replace function public.pull_sync_log(
  p_after bigint default 0,
  p_limit integer default 100
)
returns table (
  server_sequence bigint,
  operation_id text,
  player_id text,
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
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode = '42501';
  end if;
  return query
    select log.server_sequence, log.operation_id, log.player_id,
      log.origin_device_id, log.device_sequence, log.command_type,
      log.entity_type, log.entity_id, log.base_version, log.payload,
      log.occurred_at, log.status, log.accepted_at, log.result_json
    from public.sync_log log
    where log.owner_id = auth.uid()
      and log.server_sequence > greatest(coalesce(p_after, 0), 0)
    order by log.server_sequence
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.pull_sync_log(bigint, integer) from public, anon;
grant execute on function public.pull_sync_log(bigint, integer) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sync_log;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
