-- Additive repair: retain all records and existing cursor values.
-- The previous delta RPC used a nonexistent updated_at column; retries also
-- advanced the delta feed solely because received_at had changed.
begin;

create or replace function public.stamp_mobile_reference_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Serialize owner writes before allocating cursors, including concurrent devices.
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  if tg_op = 'INSERT' then
    new.server_sequence := nextval('public.mobile_reference_change_sequence'::regclass);
    new.server_version := 1;
    return new;
  end if;

  -- Ignore sequence/version themselves when deciding whether the canonical
  -- record changed. A duplicate merge must not manufacture another delta.
  if (to_jsonb(new) - 'server_sequence' - 'server_version' - 'received_at' - 'publish_token')
       is distinct from
     (to_jsonb(old) - 'server_sequence' - 'server_version' - 'received_at' - 'publish_token') then
    new.server_sequence := nextval('public.mobile_reference_change_sequence'::regclass);
    new.server_version := greatest(1, coalesce(old.server_version, 1) + 1);
  else
    new.server_sequence := old.server_sequence;
    new.server_version := old.server_version;
  end if;

  return new;
end;
$$;

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
    'updatedAt', row_json->>'record_updated_at',
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


commit;
