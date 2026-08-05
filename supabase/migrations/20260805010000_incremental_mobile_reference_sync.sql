-- Replace repeated full mobile-reference downloads with an owner-scoped,
-- monotonic delta feed. Existing full-snapshot RPCs remain available only for
-- clean-device bootstrap and explicit repair.

begin;

create sequence if not exists public.mobile_reference_change_sequence as bigint;

alter table public.mobile_reference_records
  add column if not exists server_sequence bigint,
  add column if not exists server_version bigint not null default 1;

-- Give every existing canonical row one initial change position. This causes
-- each already-installed device to perform one bounded catch-up after this
-- migration and only deltas thereafter.
update public.mobile_reference_records
set server_sequence = nextval('public.mobile_reference_change_sequence'::regclass)
where server_sequence is null;

alter table public.mobile_reference_records
  alter column server_sequence set not null;

-- The BEFORE trigger supplies every future value. Keeping a column default
-- would consume a second sequence value before the trigger replaces it.
alter table public.mobile_reference_records
  alter column server_sequence drop default;

revoke all on sequence public.mobile_reference_change_sequence from public, anon, authenticated;

create index if not exists mobile_reference_records_owner_sequence_idx
  on public.mobile_reference_records(owner_id, server_sequence);

create or replace function public.stamp_mobile_reference_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.server_sequence := nextval('public.mobile_reference_change_sequence'::regclass);
    new.server_version := 1;
    return new;
  end if;

  -- Ignore sequence/version themselves when deciding whether the canonical
  -- record changed. A duplicate merge must not manufacture another delta.
  if (to_jsonb(new) - 'server_sequence' - 'server_version')
       is distinct from
     (to_jsonb(old) - 'server_sequence' - 'server_version') then
    new.server_sequence := nextval('public.mobile_reference_change_sequence'::regclass);
    new.server_version := greatest(1, coalesce(old.server_version, 1) + 1);
  else
    new.server_sequence := old.server_sequence;
    new.server_version := old.server_version;
  end if;

  return new;
end;
$$;

revoke all on function public.stamp_mobile_reference_change() from public, anon, authenticated;

drop trigger if exists mobile_reference_change_stamp on public.mobile_reference_records;
create trigger mobile_reference_change_stamp
before insert or update on public.mobile_reference_records
for each row execute function public.stamp_mobile_reference_change();

create or replace function public.get_mobile_reference_changes(
  p_after_sequence bigint default 0,
  p_limit integer default 500
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_after bigint := greatest(0, coalesce(p_after_sequence, 0));
  v_limit integer := greatest(1, least(500, coalesce(p_limit, 500)));
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'Tapestry mobile reference access is not authorized.'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'recordType', row_json->>'record_type',
    'recordId', row_json->>'record_id',
    'workspaceId', row_json->>'workspace_id',
    'playerId', row_json->>'player_id',
    'data', coalesce(row_json->'data', '{}'::jsonb),
    'deleted', coalesce(
      nullif(row_json->>'deleted', '')::boolean,
      nullif(row_json->'data'->>'__deleted', '')::boolean,
      false
    ),
    'updatedAt', row_json->>'updated_at',
    'serverSequence', (row_json->>'server_sequence')::bigint,
    'serverVersion', (row_json->>'server_version')::bigint
  )
  from (
    select to_jsonb(r) as row_json, r.server_sequence
    from public.mobile_reference_records r
    where r.owner_id = v_owner_id
      and r.server_sequence > v_after
    order by r.server_sequence
    limit v_limit
  ) changes
  order by changes.server_sequence;
end;
$$;

create or replace function public.get_mobile_reference_head()
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_head bigint;
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'Tapestry mobile reference access is not authorized.'
      using errcode = '42501';
  end if;

  select coalesce(max(server_sequence), 0)
  into v_head
  from public.mobile_reference_records
  where owner_id = v_owner_id;

  return v_head;
end;
$$;

revoke all on function public.get_mobile_reference_changes(bigint, integer) from public, anon;
grant execute on function public.get_mobile_reference_changes(bigint, integer) to authenticated;
revoke all on function public.get_mobile_reference_head() from public, anon;
grant execute on function public.get_mobile_reference_head() to authenticated;

commit;
