-- Run after the incremental reference migrations on an isolated test database.
-- All fixture writes are rolled back; never run tests against user data.
begin;
do $$
declare
  v_owner uuid := auth.uid();
  v_id text := 'cursor-regression-' || gen_random_uuid()::text;
  v_sequence bigint;
  v_version bigint;
  v_delta jsonb;
  v_count bigint;
begin
  select count(*) into v_count from public.mobile_reference_records;
  insert into public.mobile_reference_records(owner_id,record_type,record_id,data,record_updated_at)
  values(v_owner,'task',v_id,jsonb_build_object('UUID',v_id,'name','Preserved'),'2026-09-14T00:00:00Z')
  returning server_sequence,server_version into v_sequence,v_version;

  select d into v_delta from public.get_mobile_reference_changes(v_sequence-1,1) d;
  if (v_delta->>'updatedAt')::timestamptz <> '2026-09-14T00:00:00Z'::timestamptz
    or v_delta->>'updatedAt' is null then
    raise exception 'Delta must expose record_updated_at';
  end if;

  update public.mobile_reference_records set received_at=clock_timestamp(),publish_token='retry'
  where owner_id=v_owner and record_type='task' and record_id=v_id;
  if exists(select 1 from public.mobile_reference_records where owner_id=v_owner and record_id=v_id
     and (server_sequence<>v_sequence or server_version<>v_version)) then
    raise exception 'Retry metadata must not advance the cursor';
  end if;

  update public.mobile_reference_records set data=data || '{"name":"Changed"}'::jsonb
  where owner_id=v_owner and record_type='task' and record_id=v_id;
  if not exists(select 1 from public.mobile_reference_records where owner_id=v_owner and record_id=v_id
     and server_sequence>v_sequence and server_version=v_version+1) then
    raise exception 'Content changes must advance the cursor and version';
  end if;
  if (select count(*) from public.mobile_reference_records) <> v_count+1 then
    raise exception 'The migration must retain all existing records';
  end if;
end $$;
rollback;
