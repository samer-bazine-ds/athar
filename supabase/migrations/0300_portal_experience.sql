-- Portal Experience extensions: global Library/Inbox/Trash/Embeds.
-- Run after 0250_security_repairs.sql.

begin;

alter table public.folders add column if not exists trashed_at timestamptz;
alter table public.boards add column if not exists trashed_at timestamptz;
alter table public.conversations add column if not exists trashed_at timestamptz;
alter table public.docs add column if not exists trashed_at timestamptz;

create index if not exists folders_trashed_idx on public.folders (agency_id, trashed_at) where trashed_at is not null;
create index if not exists boards_trashed_idx on public.boards (agency_id, trashed_at) where trashed_at is not null;
create index if not exists conversations_trashed_idx on public.conversations (agency_id, trashed_at) where trashed_at is not null;
create index if not exists docs_trashed_idx on public.docs (agency_id, trashed_at) where trashed_at is not null;

create table if not exists public.embeds (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  url text not null check (url ~* '^https?://'),
  description text,
  client_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists embeds_folder_idx on public.embeds(folder_id, updated_at desc);
create index if not exists embeds_agency_idx on public.embeds(agency_id, updated_at desc);
create index if not exists embeds_title_trgm_idx on public.embeds using gin (title gin_trgm_ops);

alter table public.embeds enable row level security;

drop policy if exists embeds_select on public.embeds;
create policy embeds_select on public.embeds
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (
      trashed_at is null
      and public.can_access_folder(folder_id)
      and client_visible = true
      and archived_at is null
    )
  );

drop policy if exists embeds_insert_staff on public.embeds;
create policy embeds_insert_staff on public.embeds
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id and f.trashed_at is null
    )
  );

drop policy if exists embeds_update_staff on public.embeds;
create policy embeds_update_staff on public.embeds
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

drop policy if exists embeds_delete_staff on public.embeds;
create policy embeds_delete_staff on public.embeds
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

-- Keep updated_at automatic for embeds.
drop trigger if exists set_updated_at_embeds on public.embeds;
create trigger set_updated_at_embeds
  before update on public.embeds
  for each row execute function public.set_updated_at();

-- Trashed content must be invisible to clients and to normal folder navigation.
drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (trashed_at is null and public.can_access_folder(id))
  );

drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (
      trashed_at is null
      and public.can_access_folder(folder_id)
      and client_visible = true
      and archived_at is null
    )
  );

drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (
      trashed_at is null
      and public.can_access_folder(folder_id)
      and client_visible = true
      and archived_at is null
    )
  );

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (
      trashed_at is null
      and public.can_access_folder(folder_id)
      and client_visible = true
      and archived_at is null
    )
  );

-- Extend folder access so any trashed folder in the ancestry blocks client access.
create or replace function public.can_access_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_client uuid;
  v_blocked boolean;
  v_ok boolean;
begin
  if p_folder is null or auth.uid() is null then return false; end if;
  select f.agency_id into v_agency from public.folders f where f.id = p_folder;
  if v_agency is null then return false; end if;
  if public.is_agency_staff(v_agency) then return true; end if;
  v_client := public.current_client_id(v_agency);
  if v_client is null then return false; end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at, f.trashed_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at, p.trashed_at
      from public.folders p join chain c on p.id = c.parent_id
  )
  select
    exists(select 1 from chain where archived_at is not null or trashed_at is not null),
    exists(
      select 1 from chain c
      join public.folder_permissions fp on fp.folder_id = c.id
      where fp.client_id = v_client
    )
  into v_blocked, v_ok;

  if v_blocked then return false; end if;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.can_upload_to_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_client uuid;
  v_blocked boolean;
  v_ok boolean;
begin
  if p_folder is null or auth.uid() is null then return false; end if;
  select f.agency_id into v_agency from public.folders f where f.id = p_folder;
  if v_agency is null then return false; end if;
  if public.is_agency_staff(v_agency) then return true; end if;
  v_client := public.current_client_id(v_agency);
  if v_client is null then return false; end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at, f.trashed_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at, p.trashed_at
      from public.folders p join chain c on p.id = c.parent_id
  )
  select
    exists(select 1 from chain where archived_at is not null or trashed_at is not null),
    exists(
      select 1 from chain c
      join public.folder_permissions fp on fp.folder_id = c.id
      where fp.client_id = v_client and fp.can_upload = true
    )
  into v_blocked, v_ok;

  if v_blocked then return false; end if;
  return coalesce(v_ok, false);
end;
$$;

-- Derived readability helpers understand Trash as well.
create or replace function public.can_read_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and (
        public.is_agency_staff(c.agency_id)
        or (
          c.trashed_at is null
          and public.can_access_folder(c.folder_id)
          and c.client_visible = true
          and c.archived_at is null
        )
      )
  );
$$;

create or replace function public.can_read_board(p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board
      and (
        public.is_agency_staff(b.agency_id)
        or (
          b.trashed_at is null
          and public.can_access_folder(b.folder_id)
          and b.client_visible = true
          and b.archived_at is null
        )
      )
  );
$$;

-- Search now includes task descriptions and embeds while excluding trash.
create or replace function public.search_workspace(p_agency uuid, p_query text)
returns table (
  entity_type text,
  entity_id uuid,
  folder_id uuid,
  title text,
  snippet text,
  updated_at timestamptz
)
language sql
stable
security invoker
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  select 'folder', f.id, f.id, f.name, null, f.updated_at
    from public.folders f, q
   where f.agency_id = p_agency and f.archived_at is null and f.trashed_at is null and f.name ilike q.pattern
  union all
  select 'task', t.id, t.folder_id, t.title, left(coalesce(t.description,''),160), t.updated_at
    from public.tasks t, q
   where t.agency_id = p_agency and (t.title ilike q.pattern or coalesce(t.description,'') ilike q.pattern)
  union all
  select 'doc', d.id, d.folder_id, d.title, left(d.content_text,160), d.updated_at
    from public.docs d, q
   where d.agency_id = p_agency and d.archived_at is null and d.trashed_at is null
     and (d.title ilike q.pattern or d.content_text ilike q.pattern)
  union all
  select 'conversation', c.id, c.folder_id, c.title, null, c.updated_at
    from public.conversations c, q
   where c.agency_id = p_agency and c.archived_at is null and c.trashed_at is null and c.title ilike q.pattern
  union all
  select 'file', fi.id, fi.folder_id, fi.original_name, fi.mime_type, fi.updated_at
    from public.files fi, q
   where fi.agency_id = p_agency and fi.original_name ilike q.pattern
  union all
  select 'embed', e.id, e.folder_id, e.title, left(coalesce(e.description,e.url),160), e.updated_at
    from public.embeds e, q
   where e.agency_id = p_agency and e.archived_at is null and e.trashed_at is null
     and (e.title ilike q.pattern or e.url ilike q.pattern or coalesce(e.description,'') ilike q.pattern)
  order by updated_at desc
  limit 60;
$$;

commit;
