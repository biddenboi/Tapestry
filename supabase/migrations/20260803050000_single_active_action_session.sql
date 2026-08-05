-- Online desktop and mobile clients can race before either observes the
-- other's Action Session. Resolve that race on the shared server using the
-- canonical start clock and record id, then retain only one active session per
-- profile. Client preflight prevents the ordinary case; these triggers cover
-- truly simultaneous requests and delayed offline uploads.

create or replace function public.reconcile_reference_active_action_session()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_newer_exists boolean := false;
begin
  if new.record_type<>'action-session'
     or new.player_id is null
     or coalesce(new.data->>'outcome','')<>'active' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.owner_id::text||':'||new.player_id||':active-action-session',0)
  );
  select exists(
    select 1
    from public.mobile_reference_records current
    where current.owner_id=new.owner_id
      and current.record_type='action-session'
      and current.player_id=new.player_id
      and current.record_id<>new.record_id
      and coalesce(current.data->>'outcome','')='active'
      and (current.record_updated_at,current.record_id)>(new.record_updated_at,new.record_id)
  ) into v_newer_exists;

  if v_newer_exists then
    new.data := jsonb_set(
      jsonb_set(new.data,'{outcome}','"stopped"'::jsonb,true),
      '{endedAt}',to_jsonb(new.record_updated_at),true
    );
    return new;
  end if;

  update public.mobile_reference_records current
  set data=jsonb_set(
        jsonb_set(current.data,'{outcome}','"stopped"'::jsonb,true),
        '{endedAt}',to_jsonb(new.record_updated_at),true
      ),
      record_updated_at=greatest(current.record_updated_at,new.record_updated_at),
      received_at=now()
  where current.owner_id=new.owner_id
    and current.record_type='action-session'
    and current.player_id=new.player_id
    and current.record_id<>new.record_id
    and coalesce(current.data->>'outcome','')='active';
  return new;
end;
$$;

drop trigger if exists reconcile_reference_active_action_session
  on public.mobile_reference_records;
create trigger reconcile_reference_active_action_session
before insert or update of data,record_updated_at on public.mobile_reference_records
for each row execute function public.reconcile_reference_active_action_session();

-- Normalize the command mirror too. Older command versions stored the latest
-- session below a nested `session` key for pause/resume/finalize mutations.
create or replace function public.reconcile_entity_active_action_session()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_newer_exists boolean := false;
begin
  if new.entity_type<>'action-session' then return new; end if;
  if jsonb_typeof(new.data->'session')='object' then new.data:=new.data->'session'; end if;
  if new.player_id is null or coalesce(new.data->>'outcome','')<>'active' then return new; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.owner_id::text||':'||new.player_id||':active-action-session',0)
  );
  select exists(
    select 1
    from public.sync_entities current
    where current.owner_id=new.owner_id
      and current.entity_type='action-session'
      and current.player_id=new.player_id
      and current.entity_id<>new.entity_id
      and current.deleted_at is null
      and coalesce(current.data->>'outcome','')='active'
      and (current.updated_at,current.entity_id)>(new.updated_at,new.entity_id)
  ) into v_newer_exists;

  if v_newer_exists then
    new.data:=jsonb_set(
      jsonb_set(new.data,'{outcome}','"stopped"'::jsonb,true),
      '{endedAt}',to_jsonb(new.updated_at),true
    );
    return new;
  end if;

  update public.sync_entities current
  set data=jsonb_set(
        jsonb_set(current.data,'{outcome}','"stopped"'::jsonb,true),
        '{endedAt}',to_jsonb(new.updated_at),true
      ),
      updated_at=greatest(current.updated_at,new.updated_at)
  where current.owner_id=new.owner_id
    and current.entity_type='action-session'
    and current.player_id=new.player_id
    and current.entity_id<>new.entity_id
    and current.deleted_at is null
    and coalesce(current.data->>'outcome','')='active';
  return new;
end;
$$;

drop trigger if exists reconcile_entity_active_action_session on public.sync_entities;
create trigger reconcile_entity_active_action_session
before insert or update of data,updated_at on public.sync_entities
for each row execute function public.reconcile_entity_active_action_session();

-- Repair historical duplicates before adding the final invariant.
with ranked as (
  select owner_id,record_type,record_id,
         row_number() over(
           partition by owner_id,player_id
           order by record_updated_at desc,record_id desc
         ) as position
  from public.mobile_reference_records
  where record_type='action-session' and player_id is not null
    and coalesce(data->>'outcome','')='active'
)
update public.mobile_reference_records target
set data=jsonb_set(
      jsonb_set(target.data,'{outcome}','"stopped"'::jsonb,true),
      '{endedAt}',to_jsonb(now()),true
    ),
    record_updated_at=now(),received_at=now()
from ranked
where ranked.position>1
  and target.owner_id=ranked.owner_id
  and target.record_type=ranked.record_type
  and target.record_id=ranked.record_id;

with ranked as (
  select owner_id,entity_type,entity_id,
         row_number() over(
           partition by owner_id,player_id
           order by updated_at desc,entity_id desc
         ) as position
  from public.sync_entities
  where entity_type='action-session' and player_id is not null and deleted_at is null
    and coalesce(data->>'outcome','')='active'
)
update public.sync_entities target
set data=jsonb_set(
      jsonb_set(target.data,'{outcome}','"stopped"'::jsonb,true),
      '{endedAt}',to_jsonb(now()),true
    ),
    updated_at=now()
from ranked
where ranked.position>1
  and target.owner_id=ranked.owner_id
  and target.entity_type=ranked.entity_type
  and target.entity_id=ranked.entity_id;

create unique index if not exists mobile_reference_one_active_action_session
  on public.mobile_reference_records(owner_id,player_id)
  where record_type='action-session' and player_id is not null
    and coalesce(data->>'outcome','')='active';

create unique index if not exists sync_entity_one_active_action_session
  on public.sync_entities(owner_id,player_id)
  where entity_type='action-session' and player_id is not null and deleted_at is null
    and coalesce(data->>'outcome','')='active';
