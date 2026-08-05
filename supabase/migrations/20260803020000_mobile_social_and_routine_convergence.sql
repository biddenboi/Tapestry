-- Keep mobile comments and routine dismissal in the same durable reference
-- mirror used by fresh clients. This prevents an older active routine row from
-- reappearing after Return and makes Chronicle conversations cross-device.

alter table public.mobile_reference_records
  drop constraint if exists mobile_reference_type;

alter table public.mobile_reference_records
  add constraint mobile_reference_type check(record_type in (
    'profile','active-profile-state','mobile-working-set-manifest',
    'task','completed-task','task-completion-event','task-completion-receipt','reminder',
    'goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution',
    'action-plan','action-session','handoff','match','match-score-event','reward-provenance',
    'world-consequence-receipt','shop-catalog','inventory','transaction','journal','journal-comment',
    'chronicle-entry-metadata','chronicle-entry-revision','chronicle-entry-access',
    'chronicle-story','chronicle-story-entry','chronicle-entry-link','chronicle-reaction',
    'event','event-log','event-buff','achievement-event','achievement-state','achievement-receipt',
    'friendship','notification','routine-run','routine-step-receipt','effect-interval','effect-cancellation'
  ));

create or replace function public.mirror_routine_entity_to_mobile_reference()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_updated_at timestamptz;
begin
  if new.entity_type<>'routine-run' or new.deleted_at is not null then return new; end if;
  v_updated_at := coalesce(
    nullif(new.data->>'updatedAt','')::timestamptz,
    new.updated_at,
    now()
  );
  insert into public.mobile_reference_records(
    owner_id,record_type,record_id,player_id,workspace_id,data,
    record_updated_at,received_at,publish_token
  ) values(
    new.owner_id,'routine-run',new.entity_id,new.player_id,null,new.data,
    v_updated_at,now(),null
  )
  on conflict(owner_id,record_type,record_id) do update set
    player_id=excluded.player_id,
    workspace_id=null,
    data=excluded.data,
    record_updated_at=excluded.record_updated_at,
    received_at=excluded.received_at,
    publish_token=null
  where public.mobile_reference_records.record_updated_at<=excluded.record_updated_at;
  return new;
end;
$$;

drop trigger if exists sync_entity_mirror_routine_reference on public.sync_entities;
create trigger sync_entity_mirror_routine_reference
after insert or update of data,updated_at,deleted_at on public.sync_entities
for each row
when (new.entity_type='routine-run')
execute function public.mirror_routine_entity_to_mobile_reference();

-- Repair the mirror for the latest routine entity already accepted before
-- this trigger existed. Later explicit Return actions continue through it.
insert into public.mobile_reference_records(
  owner_id,record_type,record_id,player_id,workspace_id,data,
  record_updated_at,received_at,publish_token
)
select owner_id,'routine-run',entity_id,player_id,null,data,updated_at,now(),null
from public.sync_entities
where entity_type='routine-run' and deleted_at is null
on conflict(owner_id,record_type,record_id) do update set
  player_id=excluded.player_id,
  workspace_id=null,
  data=excluded.data,
  record_updated_at=excluded.record_updated_at,
  received_at=excluded.received_at,
  publish_token=null
where public.mobile_reference_records.record_updated_at<=excluded.record_updated_at;
