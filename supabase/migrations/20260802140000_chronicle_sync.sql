-- Revision-aware Chronicle synchronization. The server stores one canonical
-- entry snapshot per owner while clients retain the complete revision graph.

create or replace function public.apply_chronicle_sync_batch(p_operations jsonb)
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
  v_server_sequence bigint;
  v_current public.sync_entities;
  v_next_version bigint;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operations) <> 'array' then
    raise exception 'Chronicle operations must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_operations) > 100 then
    raise exception 'A Chronicle batch cannot contain more than 100 operations.' using errcode = '22023';
  end if;

  for v_operation in select value from jsonb_array_elements(p_operations)
  loop
    v_operation_id := null;
    v_result := null;
    begin
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
         or v_entity_id = '' or char_length(v_entity_id) > 500
         or v_entity_type <> 'chronicle-entry'
         or jsonb_typeof(v_payload) <> 'object'
         or v_command_type not in (
           'createChronicleEntry','updateChronicleEntry','changeChronicleAccess',
           'archiveChronicleEntry','setChronicleLock'
         )
         or jsonb_typeof(v_payload -> 'journal') <> 'object'
         or jsonb_typeof(v_payload -> 'metadata') <> 'object'
         or jsonb_typeof(v_payload -> 'access') <> 'object'
         or coalesce(v_payload #>> '{journal,UUID}', '') <> v_entity_id
         or coalesce(v_payload #>> '{metadata,journalUUID}', '') <> v_entity_id
         or coalesce(v_payload #>> '{access,journalUUID}', '') <> v_entity_id then
        raise exception 'The Chronicle operation has invalid canonical records.' using errcode = '22023';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':' || v_operation_id, 0));
      select result_json into v_existing_result
      from public.sync_log
      where owner_id=v_owner_id and operation_id=v_operation_id;
      if found then
        v_results := v_results || jsonb_build_array(v_existing_result);
        continue;
      end if;

      if not exists (
        select 1 from public.sync_devices
        where owner_id=v_owner_id and device_id=v_device_id and retired_at is null
      ) then
        raise exception 'The sync device is not registered.' using errcode = '42501';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text || ':chronicle:' || v_entity_id, 0));
      select * into v_current from public.sync_entities
      where owner_id=v_owner_id and entity_type='chronicle-entry' and entity_id=v_entity_id
      for update;

      if v_base_version is not null
         and ((found and v_current.version <> v_base_version)
           or (not found and v_base_version <> 0)) then
        v_result := jsonb_build_object(
          'operationId',v_operation_id,'status','conflict',
          'errorCode','base-version-conflict',
          'errorMessage','The server has a newer Chronicle revision.',
          'conflictId','sync-conflict:' || v_operation_id,
          'serverVersion',v_current.version,
          'serverPayload',coalesce(v_current.data,'{}'::jsonb),
          'serverEntity',case when v_current.owner_id is null then null else jsonb_build_object(
            'entityType',v_current.entity_type,'entityId',v_current.entity_id,
            'version',v_current.version,'data',v_current.data,'deletedAt',v_current.deleted_at
          ) end
        );
      else
        v_next_version := coalesce(v_current.version,0)+1;
        insert into public.sync_entities(
          owner_id,entity_type,entity_id,player_id,version,data,
          updated_at,updated_by_device_id,deleted_at
        ) values (
          v_owner_id,'chronicle-entry',v_entity_id,v_player_id,v_next_version,
          v_payload,v_occurred_at,v_device_id,
          case when v_payload #>> '{metadata,lifecycleState}' = 'archived' then v_occurred_at else null end
        )
        on conflict(owner_id,entity_type,entity_id) do update set
          player_id=coalesce(excluded.player_id,public.sync_entities.player_id),
          version=excluded.version,data=excluded.data,updated_at=excluded.updated_at,
          updated_by_device_id=excluded.updated_by_device_id,deleted_at=excluded.deleted_at;
        v_result := jsonb_build_object(
          'operationId',v_operation_id,'status','accepted',
          'entity',jsonb_build_object(
            'entityType','chronicle-entry','entityId',v_entity_id,
            'version',v_next_version,'data',v_payload,
            'deletedAt',case when v_payload #>> '{metadata,lifecycleState}' = 'archived' then v_occurred_at else null end
          )
        );
      end if;

      insert into public.sync_log(
        owner_id,operation_id,player_id,origin_device_id,device_sequence,
        command_type,entity_type,entity_id,base_version,payload,occurred_at,
        status,result_json
      ) values (
        v_owner_id,v_operation_id,v_player_id,v_device_id,v_device_sequence,
        v_command_type,v_entity_type,v_entity_id,v_base_version,v_payload,v_occurred_at,
        v_result ->> 'status',v_result
      ) returning server_sequence into v_server_sequence;
      v_result := v_result || jsonb_build_object('serverSequence',v_server_sequence,'acceptedAt',now());
      update public.sync_log set result_json=v_result where server_sequence=v_server_sequence;
      update public.sync_devices set last_seen_at=now()
      where owner_id=v_owner_id and device_id=v_device_id;
    exception when others then
      if sqlstate not in ('22023','42501','22P02','22007') then raise; end if;
      v_result := jsonb_build_object(
        'operationId',coalesce(nullif(v_operation_id,''),'invalid'),
        'status','rejected',
        'errorCode',case when sqlstate='42501' then 'forbidden' else 'invalid-operation' end,
        'message',sqlerrm
      );
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return v_results;
end;
$$;

revoke all on function public.apply_chronicle_sync_batch(jsonb) from public, anon;
grant execute on function public.apply_chronicle_sync_batch(jsonb) to authenticated;
