-- Developer B migration range 0200-0299.
-- SHARED_SPEC §27 says workspace search includes task titles + descriptions.
-- 0001 indexes task titles but its initial RPC only filters task titles; this additive migration
-- preserves the locked RPC signature while making the documented description search effective.

create index if not exists tasks_description_trgm_idx
  on public.tasks using gin (description gin_trgm_ops)
  where description is not null;

create or replace function public.search_workspace(p_agency uuid, p_query text)
returns table (
  entity_type text,
  entity_id   uuid,
  folder_id   uuid,
  title       text,
  snippet     text,
  updated_at  timestamptz
)
language sql
stable
security invoker
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  select 'folder', f.id, f.id, f.name, null, f.updated_at
    from public.folders f, q
   where f.agency_id = p_agency and f.archived_at is null and f.name ilike q.pattern
  union all
  select 'task', t.id, t.folder_id, t.title, left(coalesce(t.description,''), 160), t.updated_at
    from public.tasks t, q
   where t.agency_id = p_agency
     and (t.title ilike q.pattern or coalesce(t.description,'') ilike q.pattern)
  union all
  select 'doc', d.id, d.folder_id, d.title, left(d.content_text, 160), d.updated_at
    from public.docs d, q
   where d.agency_id = p_agency and d.archived_at is null
     and (d.title ilike q.pattern or d.content_text ilike q.pattern)
  union all
  select 'conversation', c.id, c.folder_id, c.title, null, c.updated_at
    from public.conversations c, q
   where c.agency_id = p_agency and c.archived_at is null and c.title ilike q.pattern
  union all
  select 'file', fi.id, fi.folder_id, fi.original_name, fi.mime_type, fi.updated_at
    from public.files fi, q
   where fi.agency_id = p_agency and fi.original_name ilike q.pattern
  order by updated_at desc
  limit 60;
$$;
