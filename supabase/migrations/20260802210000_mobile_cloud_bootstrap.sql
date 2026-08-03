-- Expand the read-only mobile reference mirror into a bounded clean-device
-- bootstrap. Normal mutations continue through command-specific sync RPCs.
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
    'friendship','notification','routine-run','routine-step-receipt','effect-interval'
  ));

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
    raise exception 'Bootstrap records must be an array of at most 1000 entries.' using errcode='22023';
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
         'friendship','notification','routine-run','routine-step-receipt','effect-interval'
       )
       or coalesce(char_length(v_id),0) not between 1 and 500
       or jsonb_typeof(v_record->'data')<>'object'
       or octet_length((v_record->'data')::text)>1048576 then
      raise exception 'A mobile bootstrap record is invalid.' using errcode='22023';
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
      'recordType',record_type,'recordId',record_id,'playerId',player_id,
      'data',data,'updatedAt',record_updated_at
    ) order by record_type,record_id)
    from public.mobile_reference_records
    where owner_id=v_owner_id and record_type=any(p_record_types)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_mobile_reference_records_by_type(text[]) from public,anon;
grant execute on function public.get_mobile_reference_records_by_type(text[]) to authenticated;
