-- The complete reference mirror can grow beyond PostgreSQL's per-statement
-- response budget when it is aggregated into one JSON value. Clean-device
-- restore therefore walks the primary-key index in bounded pages.

create or replace function public.get_mobile_reference_records_page(
  p_record_types text[] default null,
  p_after_record_type text default null,
  p_after_record_id text default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_limit integer := greatest(1,least(500,coalesce(p_limit,250)));
begin
  if v_owner_id is null or not public.is_tapestry_owner() then
    raise exception 'This account is not approved for Tapestry.' using errcode='42501';
  end if;
  if p_record_types is not null
     and coalesce(array_length(p_record_types,1),0) not between 1 and 50 then
    raise exception 'Reference record filters must contain between 1 and 50 types.' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(page.record order by page.record_type,page.record_id)
    from (
      select
        record_type,
        record_id,
        jsonb_build_object(
          'recordType',record_type,
          'recordId',record_id,
          'workspaceId',workspace_id,
          'playerId',player_id,
          'data',data,
          'updatedAt',record_updated_at
        ) as record
      from public.mobile_reference_records
      where owner_id=v_owner_id
        and (p_record_types is null or record_type=any(p_record_types))
        and (
          p_after_record_type is null
          or (record_type,record_id)>(p_after_record_type,coalesce(p_after_record_id,''))
        )
      order by record_type,record_id
      limit v_limit
    ) page
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_mobile_reference_records_page(text[],text,text,integer)
  from public,anon;
grant execute on function public.get_mobile_reference_records_page(text[],text,text,integer)
  to authenticated;
