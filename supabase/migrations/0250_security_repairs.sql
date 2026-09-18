-- Agency Portal: consolidated SQL/RLS reliability + security patch
-- Run once AFTER 0001_shared_schema.sql.
-- Safe to re-run: objects/policies/triggers are replaced idempotently where practical.

begin;

-- ============================================================
-- 1) AGENCY CREATION / INSERT ... RETURNING BOOTSTRAP
-- ============================================================
-- During INSERT ... RETURNING the owner membership created by the AFTER INSERT
-- trigger may not yet be visible to the STABLE membership helper used by the
-- SELECT policy. This helper lets only the creator read the row during the
-- tiny bootstrap window in which the agency still has no membership rows.

create or replace function public.agency_has_any_member(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.agency_members m
    where m.agency_id = p_agency
  );
$$;

drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies
  for select to authenticated
  using (
    public.is_agency_member(id)
    or (
      created_by = auth.uid()
      and not public.agency_has_any_member(id)
    )
  );

-- Re-assert the owner bootstrap trigger for future agencies.
create or replace function public.handle_new_agency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.agency_members (agency_id, profile_id, role, client_id)
  values (new.id, new.created_by, 'owner', null)
  on conflict (agency_id, profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_agency_created on public.agencies;
create trigger on_agency_created
  after insert on public.agencies
  for each row execute function public.handle_new_agency();

-- Repair only agencies that currently have NO owner at all.
-- This does not add the creator back when another owner already exists.
insert into public.agency_members (agency_id, profile_id, role, client_id)
select a.id, a.created_by, 'owner', null
from public.agencies a
where not exists (
  select 1
  from public.agency_members m
  where m.agency_id = a.id
    and m.role = 'owner'
)
on conflict (agency_id, profile_id)
do update set role = 'owner', client_id = null;

-- ============================================================
-- 2) FOLDER INSERT ... RETURNING + ARCHIVED ANCESTOR RULE
-- ============================================================
-- Staff can be authorized directly from agency_id, so a freshly inserted
-- folder does not need can_access_folder(id) to see itself in RETURNING.

drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or public.can_access_folder(id)
  );

-- Restore the strict insert rule (supersedes the earlier temporary creator fallback).
drop policy if exists folders_insert_staff on public.folders;
create policy folders_insert_staff on public.folders
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
  );

-- A client must lose access to an entire subtree if ANY folder in the path is archived.
create or replace function public.can_access_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency   uuid;
  v_client   uuid;
  v_blocked  boolean;
  v_ok       boolean;
begin
  if p_folder is null or auth.uid() is null then
    return false;
  end if;

  select f.agency_id
    into v_agency
  from public.folders f
  where f.id = p_folder;

  if v_agency is null then
    return false;
  end if;

  if public.is_agency_staff(v_agency) then
    return true;
  end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then
    return false;
  end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f
     where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p
      join chain c on p.id = c.parent_id
  )
  select
    exists (select 1 from chain where archived_at is not null),
    exists (
      select 1
      from chain c
      join public.folder_permissions fp on fp.folder_id = c.id
      where fp.client_id = v_client
    )
  into v_blocked, v_ok;

  if v_blocked then
    return false;
  end if;

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
  v_agency   uuid;
  v_client   uuid;
  v_blocked  boolean;
  v_ok       boolean;
begin
  if p_folder is null or auth.uid() is null then
    return false;
  end if;

  select f.agency_id
    into v_agency
  from public.folders f
  where f.id = p_folder;

  if v_agency is null then
    return false;
  end if;

  if public.is_agency_staff(v_agency) then
    return true;
  end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then
    return false;
  end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f
     where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p
      join chain c on p.id = c.parent_id
  )
  select
    exists (select 1 from chain where archived_at is not null),
    exists (
      select 1
      from chain c
      join public.folder_permissions fp on fp.folder_id = c.id
      where fp.client_id = v_client
        and fp.can_upload = true
    )
  into v_blocked, v_ok;

  if v_blocked then
    return false;
  end if;

  return coalesce(v_ok, false);
end;
$$;

-- ============================================================
-- 3) TENANT IDENTITY: agency_id MUST NOT MOVE BETWEEN AGENCIES
-- ============================================================
create or replace function public.guard_agency_id_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.agency_id is distinct from old.agency_id then
    raise exception 'agency_id cannot be changed after creation';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients','agency_members','invitations','folders','folder_permissions',
    'conversations','messages','boards','board_columns','tasks','task_comments',
    'docs','files','invoices','invoice_line_items','payments','activity_logs'
  ]
  loop
    execute format('drop trigger if exists guard_agency_id_%1$s on public.%1$s', t);
    execute format(
      'create trigger guard_agency_id_%1$s before update on public.%1$s '
      'for each row execute function public.guard_agency_id_immutable()', t
    );
  end loop;
end;
$$;

-- ============================================================
-- 4) MEMBERSHIP / INVITATION INTEGRITY
-- ============================================================
-- An owner may only anchor a client membership to a client company in the same agency.
drop policy if exists agency_members_insert_owner on public.agency_members;
create policy agency_members_insert_owner on public.agency_members
  for insert to authenticated
  with check (
    public.is_agency_owner(agency_id)
    and (
      (role in ('owner','team') and client_id is null)
      or (
        role = 'client'
        and exists (
          select 1
          from public.clients c
          where c.id = client_id
            and c.agency_id = agency_id
            and c.archived_at is null
        )
      )
    )
  );

drop policy if exists agency_members_update_owner on public.agency_members;
create policy agency_members_update_owner on public.agency_members
  for update to authenticated
  using (public.is_agency_owner(agency_id))
  with check (
    public.is_agency_owner(agency_id)
    and (
      (role in ('owner','team') and client_id is null)
      or (
        role = 'client'
        and exists (
          select 1
          from public.clients c
          where c.id = client_id
            and c.agency_id = agency_id
            and c.archived_at is null
        )
      )
    )
  );

-- Invitation role/client/agency/token identity is immutable after creation.
-- This prevents a team member from turning a pending client invitation into an owner invitation.
create or replace function public.guard_invitation_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or lower(new.email) is distinct from lower(old.email)
     or new.intended_role is distinct from old.intended_role
     or new.client_id is distinct from old.client_id
     or new.invited_by is distinct from old.invited_by
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at then
    raise exception 'Invitation identity fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_invitation_identity_trg on public.invitations;
create trigger guard_invitation_identity_trg
  before update on public.invitations
  for each row execute function public.guard_invitation_identity();

-- Folder permission rows are grants. To change folder/client, delete and recreate the grant.
create or replace function public.guard_folder_permission_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.folder_id is distinct from old.folder_id
     or new.client_id is distinct from old.client_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Folder permission identity fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_folder_permission_identity_trg on public.folder_permissions;
create trigger guard_folder_permission_identity_trg
  before update on public.folder_permissions
  for each row execute function public.guard_folder_permission_identity();

-- Keep update policy parent relationships consistent.
drop policy if exists folder_permissions_update_staff on public.folder_permissions;
create policy folder_permissions_update_staff on public.folder_permissions
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id
    )
    and exists (
      select 1 from public.clients c
      where c.id = client_id and c.agency_id = agency_id and c.archived_at is null
    )
  );

-- ============================================================
-- 5) MESSAGE / COMMENT PARENT CONSISTENCY
-- ============================================================
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_read_conversation(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.agency_id = agency_id
    )
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true
    )
  );

drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (
    sender_id = auth.uid()
    and public.can_read_conversation(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.agency_id = agency_id
    )
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true
    )
  );

-- Enforce one-level reply roots and same-conversation replies.
create or replace function public.normalize_message_reply()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_conversation uuid;
  v_root uuid;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  if new.reply_to_message_id = new.id then
    raise exception 'A message cannot reply to itself';
  end if;

  select m.conversation_id, coalesce(m.reply_to_message_id, m.id)
    into v_conversation, v_root
  from public.messages m
  where m.id = new.reply_to_message_id;

  if v_conversation is null then
    raise exception 'Reply target is not available';
  end if;

  if v_conversation <> new.conversation_id then
    raise exception 'Reply target must be in the same conversation';
  end if;

  new.reply_to_message_id := v_root;
  return new;
end;
$$;

drop trigger if exists normalize_message_reply_trg on public.messages;
create trigger normalize_message_reply_trg
  before insert or update of reply_to_message_id, conversation_id on public.messages
  for each row execute function public.normalize_message_reply();

-- Task comments must remain attached to a readable task in the same agency.
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_read_task(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.agency_id = agency_id
    )
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true
    )
  );

drop policy if exists task_comments_update_author on public.task_comments;
create policy task_comments_update_author on public.task_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and public.can_read_task(task_id)
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.agency_id = agency_id
    )
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true
    )
  );

-- ============================================================
-- 6) CONTENT UPDATE PARENT CONSISTENCY
-- ============================================================
drop policy if exists conversations_update_staff on public.conversations;
create policy conversations_update_staff on public.conversations
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id
    )
  );

drop policy if exists boards_update_staff on public.boards;
create policy boards_update_staff on public.boards
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id
    )
  );

drop policy if exists tasks_update_staff on public.tasks;
create policy tasks_update_staff on public.tasks
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.boards b
      where b.id = board_id
        and b.agency_id = agency_id
        and b.folder_id = folder_id
    )
    and exists (
      select 1 from public.board_columns c
      where c.id = column_id
        and c.board_id = board_id
        and c.agency_id = agency_id
    )
  );

drop policy if exists docs_update_staff on public.docs;
create policy docs_update_staff on public.docs
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id
    )
  );

-- ============================================================
-- 7) FILE METADATA + STORAGE BINDING
-- ============================================================
-- In V1 file metadata is immutable after upload except client_visible/updated_at.
create or replace function public.guard_file_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parts text[];
begin
  parts := string_to_array(new.storage_path, '/');

  if array_length(parts, 1) <> 4
     or parts[1] <> new.agency_id::text
     or parts[2] <> new.folder_id::text
     or parts[3] <> new.id::text
     or coalesce(parts[4], '') = '' then
    raise exception 'Invalid project file storage_path';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.agency_id is distinct from old.agency_id
       or new.folder_id is distinct from old.folder_id
       or new.uploaded_by is distinct from old.uploaded_by
       or new.bucket_name is distinct from old.bucket_name
       or new.storage_path is distinct from old.storage_path
       or new.original_name is distinct from old.original_name
       or new.mime_type is distinct from old.mime_type
       or new.size_bytes is distinct from old.size_bytes
       or new.created_at is distinct from old.created_at then
      raise exception 'Uploaded file metadata is immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_file_metadata_trg on public.files;
create trigger guard_file_metadata_trg
  before insert or update on public.files
  for each row execute function public.guard_file_metadata();

-- Staff may only toggle visibility on a metadata row that still belongs to a valid folder.
drop policy if exists files_update_staff on public.files;
create policy files_update_staff on public.files
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.agency_id = agency_id
    )
  );

-- A client may delete their own upload while they still have folder access,
-- even if can_upload was later switched off.
drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (
      uploaded_by = auth.uid()
      and public.can_access_folder(folder_id)
    )
  );

-- Storage upload must have a matching metadata row created first.
drop policy if exists project_files_insert on storage.objects;
create policy project_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and exists (
      select 1
      from public.files f
      where f.storage_path = storage.objects.name
        and f.uploaded_by = auth.uid()
        and f.agency_id = (storage.foldername(storage.objects.name))[1]::uuid
        and f.folder_id = (storage.foldername(storage.objects.name))[2]::uuid
        and public.can_upload_to_folder(f.folder_id)
    )
  );

-- Storage delete mirrors metadata delete: staff, or uploader with current folder access.
drop policy if exists project_files_delete on storage.objects;
create policy project_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1
      from public.files f
      where f.storage_path = storage.objects.name
        and (
          public.is_agency_staff(f.agency_id)
          or (
            f.uploaded_by = auth.uid()
            and public.can_access_folder(f.folder_id)
          )
        )
    )
  );

-- ============================================================
-- 8) INVOICE RELATIONSHIPS + AUTHORITATIVE TOTALS / PAID STATUS
-- ============================================================
drop policy if exists invoices_update_staff on public.invoices;
create policy invoices_update_staff on public.invoices
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.clients c
      where c.id = client_id and c.agency_id = agency_id
    )
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = folder_id and f.agency_id = agency_id
      )
    )
  );

-- Manual payment rows must point to an invoice in the same agency.
drop policy if exists payments_insert_owner_manual on public.payments;
create policy payments_insert_owner_manual on public.payments
  for insert to authenticated
  with check (
    public.is_agency_owner(agency_id)
    and provider = 'manual'
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.agency_id = agency_id
    )
  );

-- Recalculate invoice totals on every invoice insert/update, ignoring direct attempts
-- to overwrite subtotal/tax/total. Also require a succeeded payment before entering paid.
create or replace function public.enforce_invoice_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_tax      bigint;
begin
  select coalesce(sum(li.amount_cents), 0)
    into v_subtotal
  from public.invoice_line_items li
  where li.invoice_id = new.id;

  v_discount := least(coalesce(new.discount_cents, 0), v_subtotal);
  v_tax := round(
    (v_subtotal - v_discount)::numeric
    * coalesce(new.tax_rate_bp, 0)
    / 10000.0
  );

  new.subtotal_cents := v_subtotal;
  new.discount_cents := v_discount;
  new.tax_cents := v_tax;
  new.total_cents := v_subtotal - v_discount + v_tax;

  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    if not exists (
      select 1
      from public.payments p
      where p.invoice_id = new.id
        and p.status = 'succeeded'
    ) then
      raise exception 'Invoice cannot be marked paid without a succeeded payment';
    end if;
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;

  return new;
end;
$$;

-- Replace the narrower old self-recalculation trigger.
drop trigger if exists recalculate_invoice_totals_self_trg on public.invoices;
drop trigger if exists enforce_invoice_integrity_trg on public.invoices;
create trigger enforce_invoice_integrity_trg
  before insert or update on public.invoices
  for each row execute function public.enforce_invoice_integrity();

-- ============================================================
-- 9) SEARCH: TASK TITLE + DESCRIPTION (idempotent 0200 migration)
-- ============================================================
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
   where f.agency_id = p_agency
     and f.archived_at is null
     and f.name ilike q.pattern
  union all
  select 'task', t.id, t.folder_id, t.title,
         left(coalesce(t.description,''), 160), t.updated_at
    from public.tasks t, q
   where t.agency_id = p_agency
     and (t.title ilike q.pattern or coalesce(t.description,'') ilike q.pattern)
  union all
  select 'doc', d.id, d.folder_id, d.title,
         left(d.content_text, 160), d.updated_at
    from public.docs d, q
   where d.agency_id = p_agency
     and d.archived_at is null
     and (d.title ilike q.pattern or d.content_text ilike q.pattern)
  union all
  select 'conversation', c.id, c.folder_id, c.title, null, c.updated_at
    from public.conversations c, q
   where c.agency_id = p_agency
     and c.archived_at is null
     and c.title ilike q.pattern
  union all
  select 'file', fi.id, fi.folder_id, fi.original_name, fi.mime_type, fi.updated_at
    from public.files fi, q
   where fi.agency_id = p_agency
     and fi.original_name ilike q.pattern
  order by updated_at desc
  limit 60;
$$;

commit;

-- ============================================================
-- VERIFICATION QUERIES (read-only)
-- ============================================================
-- 1) Every agency should have at least one owner.
select
  a.id,
  a.name,
  count(m.id) filter (where m.role = 'owner') as owner_count
from public.agencies a
left join public.agency_members m on m.agency_id = a.id
group by a.id, a.name
order by a.name;

-- 2) Show memberships for troubleshooting.
select
  a.name as agency,
  p.email,
  m.role,
  m.client_id
from public.agency_members m
join public.agencies a on a.id = m.agency_id
join public.profiles p on p.id = m.profile_id
order by a.name, m.role, p.email;
