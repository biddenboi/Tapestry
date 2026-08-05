-- Durable convergence hardening for the operation/reference sync runtime.
-- Active-profile and working-set manifest records were already emitted by the
-- current clients, but the earlier table constraint rejected them and rolled
-- the whole merge RPC back. Keep tombstones as records so an offline client
-- cannot resurrect a task after another device deletes it.

alter table public.mobile_reference_records
  drop constraint if exists mobile_reference_type;

alter table public.mobile_reference_records
  add constraint mobile_reference_type check(record_type in (
    'profile','active-profile-state','mobile-working-set-manifest',
    'task','completed-task','task-completion-event','task-completion-receipt','reminder',
    'goal','goal-area','goal-milestone','goal-update','goal-link','goal-participant','goal-contribution',
    'action-plan','action-session','handoff','match','match-score-event','reward-provenance',
    'world-consequence-receipt','shop-catalog','inventory','transaction','journal',
    'chronicle-entry-metadata','chronicle-entry-revision','chronicle-entry-access',
    'chronicle-story','chronicle-story-entry','chronicle-entry-link','chronicle-reaction',
    'event','event-log','event-buff','achievement-event','achievement-state','achievement-receipt',
    'friendship','notification','routine-run','routine-step-receipt','effect-interval','effect-cancellation'
  ));

create or replace function public.prune_mobile_reference_after_sync_delete()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_record_type text;
  v_deleted_at timestamptz;
begin
  if new.status<>'accepted' then return new; end if;
  v_record_type := case new.command_type
    when 'deleteTask' then 'task'
    when 'deleteReminder' then 'reminder'
    when 'deleteMoment' then 'journal'
    else null
  end;
  if v_record_type is null then return new; end if;

  v_deleted_at := coalesce(new.occurred_at,new.accepted_at,now());
  insert into public.mobile_reference_records(
    owner_id,record_type,record_id,player_id,workspace_id,data,
    record_updated_at,received_at,publish_token
  ) values(
    new.owner_id,v_record_type,new.entity_id,new.player_id,new.workspace_id,
    jsonb_build_object(
      'UUID',new.entity_id,
      '__deleted',true,
      'deletedAt',v_deleted_at,
      'syncUpdatedAt',v_deleted_at
    ),
    v_deleted_at,now(),null
  )
  on conflict(owner_id,record_type,record_id) do update set
    player_id=excluded.player_id,
    workspace_id=excluded.workspace_id,
    data=excluded.data || jsonb_build_object(
      'deletedAt',greatest(
        excluded.record_updated_at,
        public.mobile_reference_records.record_updated_at + interval '1 millisecond'
      ),
      'syncUpdatedAt',greatest(
        excluded.record_updated_at,
        public.mobile_reference_records.record_updated_at + interval '1 millisecond'
      )
    ),
    record_updated_at=greatest(
      excluded.record_updated_at,
      public.mobile_reference_records.record_updated_at + interval '1 millisecond'
    ),
    received_at=excluded.received_at,
    publish_token=null;
  return new;
end;
$$;

-- The replace-all token protocol is fully retired. Removing its entry points
-- prevents a stale code path from invalidating another device's publication.
drop function if exists public.finalize_mobile_reference_publish(text);
drop function if exists public.merge_mobile_reference_publish(text,jsonb);
drop function if exists public.begin_mobile_reference_publish();
drop table if exists public.mobile_reference_publish_sessions;
