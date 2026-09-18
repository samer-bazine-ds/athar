-- Agency Portal shared schema generated from SHARED_SPEC.md sections 6-9.
-- AUTHORITATIVE shared migration.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- ILIKE / similarity indexes for search


create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));


create table public.agencies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(trim(name)) between 1 and 120),
  slug            text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  logo_url        text,
  primary_color   text not null default '#3F5BF6'
                    check (primary_color ~* '^#[0-9a-f]{6}$'),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index agencies_created_by_idx on public.agencies (created_by);


create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 120),
  contact_email text,
  notes         text,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index clients_agency_idx on public.clients (agency_id) where archived_at is null;
create unique index clients_agency_name_uidx
  on public.clients (agency_id, lower(name)) where archived_at is null;


create table public.agency_members (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null check (role in ('owner','team','client')),
  client_id    uuid references public.clients(id) on delete cascade,
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agency_members_unique unique (agency_id, profile_id),
  constraint agency_members_client_anchor check (
    (role = 'client'  and client_id is not null) or
    (role in ('owner','team') and client_id is null)
  )
);

create index agency_members_profile_idx on public.agency_members (profile_id);
create index agency_members_agency_role_idx on public.agency_members (agency_id, role);
create index agency_members_client_idx on public.agency_members (client_id);


create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  email         text not null check (position('@' in email) > 1),
  intended_role text not null check (intended_role in ('owner','team','client')),
  client_id     uuid references public.clients(id) on delete cascade,
  invited_by    uuid not null references public.profiles(id) on delete cascade,
  token         uuid not null unique default gen_random_uuid(),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','revoked','expired')),
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint invitations_client_anchor check (
    (intended_role = 'client'  and client_id is not null) or
    (intended_role in ('owner','team') and client_id is null)
  )
);

create unique index invitations_pending_uidx
  on public.invitations (agency_id, lower(email)) where status = 'pending';
create index invitations_agency_idx on public.invitations (agency_id, status);
create index invitations_token_idx on public.invitations (token);


create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  parent_id   uuid references public.folders(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 120),
  color       text not null default '#8A90A6' check (color ~* '^#[0-9a-f]{6}$'),
  position    integer not null default 0,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index folders_agency_parent_idx on public.folders (agency_id, parent_id, position);
create index folders_parent_idx on public.folders (parent_id);
create index folders_name_trgm_idx on public.folders using gin (name gin_trgm_ops);


create table public.folder_permissions (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  folder_id   uuid not null references public.folders(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  can_upload  boolean not null default true,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint folder_permissions_unique unique (folder_id, client_id)
);

create index folder_permissions_client_idx on public.folder_permissions (client_id);
create index folder_permissions_agency_idx on public.folder_permissions (agency_id);


create table public.conversations (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 160),
  client_visible boolean not null default false,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  last_message_at timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index conversations_folder_idx
  on public.conversations (folder_id, last_message_at desc nulls last);
create index conversations_agency_idx on public.conversations (agency_id);


create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  sender_id           uuid not null references public.profiles(id) on delete restrict,
  body                text not null check (char_length(body) between 1 and 20000),
  client_visible      boolean not null default true,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  edited_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_agency_idx on public.messages (agency_id);
create index messages_body_trgm_idx on public.messages using gin (body gin_trgm_ops);


create table public.boards (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 160),
  description    text,
  client_visible boolean not null default false,
  position       integer not null default 0,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index boards_folder_idx on public.boards (folder_id, position);
create index boards_agency_idx on public.boards (agency_id);


create table public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  color      text not null default '#8A90A6' check (color ~* '^#[0-9a-f]{6}$'),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index board_columns_board_idx on public.board_columns (board_id, position);


create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  board_id       uuid not null references public.boards(id) on delete cascade,
  column_id      uuid not null references public.board_columns(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 200),
  description    text,
  assignee_id    uuid references public.profiles(id) on delete set null,
  due_date       date,
  priority       text not null default 'normal'
                   check (priority in ('low','normal','high','urgent')),
  client_visible boolean not null default false,
  position       integer not null default 0,
  completed_at   timestamptz,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index tasks_column_idx on public.tasks (column_id, position);
create index tasks_board_idx on public.tasks (board_id);
create index tasks_folder_idx on public.tasks (folder_id);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_title_trgm_idx on public.tasks using gin (title gin_trgm_ops);


create table public.task_comments (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  task_id        uuid not null references public.tasks(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete restrict,
  body           text not null check (char_length(body) between 1 and 10000),
  client_visible boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);


create table public.docs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 200),
  content_html   text not null default '',
  content_text   text not null default '',
  client_visible boolean not null default false,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  last_edited_by uuid references public.profiles(id) on delete set null,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index docs_folder_idx on public.docs (folder_id, updated_at desc);
create index docs_title_trgm_idx on public.docs using gin (title gin_trgm_ops);
create index docs_text_trgm_idx on public.docs using gin (content_text gin_trgm_ops);


create table public.files (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  uploaded_by    uuid not null references public.profiles(id) on delete restrict,
  bucket_name    text not null default 'project-files'
                   check (bucket_name = 'project-files'),
  storage_path   text not null unique,
  original_name  text not null check (char_length(original_name) between 1 and 255),
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  client_visible boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index files_folder_idx on public.files (folder_id, created_at desc);
create index files_agency_idx on public.files (agency_id);
create index files_name_trgm_idx on public.files using gin (original_name gin_trgm_ops);


create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  folder_id       uuid references public.folders(id) on delete set null,
  client_id       uuid not null references public.clients(id) on delete restrict,
  invoice_number  text not null,
  status          text not null default 'draft'
                    check (status in ('draft','sent','paid','overdue','void')),
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  issue_date      date not null default current_date,
  due_date        date,
  subtotal_cents  bigint not null default 0 check (subtotal_cents >= 0),
  tax_rate_bp     integer not null default 0 check (tax_rate_bp between 0 and 10000),
  tax_cents       bigint not null default 0 check (tax_cents >= 0),
  discount_cents  bigint not null default 0 check (discount_cents >= 0),
  total_cents     bigint not null default 0 check (total_cents >= 0),
  notes           text,
  sent_at         timestamptz,
  paid_at         timestamptz,
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoices_number_unique unique (agency_id, invoice_number)
);

create index invoices_client_idx on public.invoices (client_id, status);
create index invoices_folder_idx on public.invoices (folder_id);
create index invoices_agency_idx on public.invoices (agency_id, issue_date desc);


create table public.invoice_line_items (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  description      text not null check (char_length(trim(description)) between 1 and 300),
  quantity_milli   bigint not null default 1000 check (quantity_milli > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents     bigint not null default 0 check (amount_cents >= 0),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, position);


create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  amount_cents        bigint not null check (amount_cents > 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  provider            text not null default 'stripe' check (provider in ('stripe','manual')),
  provider_session_id text,
  provider_payment_id text,
  status              text not null default 'pending'
                        check (status in ('pending','succeeded','failed','refunded')),
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index payments_provider_payment_uidx
  on public.payments (provider_payment_id) where provider_payment_id is not null;
create index payments_invoice_idx on public.payments (invoice_id);


create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null check (action in (
                'folder.created','folder.archived','folder.shared','folder.unshared',
                'client.created','client.invited','member.invited','member.removed',
                'task.completed','file.uploaded','file.deleted',
                'invoice.sent','invoice.paid','branding.updated'
              )),
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activity_logs_agency_idx on public.activity_logs (agency_id, created_at desc);


create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','agencies','clients','agency_members','invitations','folders',
    'folder_permissions','conversations','messages','boards','board_columns',
    'tasks','task_comments','docs','files','invoices','invoice_line_items','payments'
  ]
  loop
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;


-- Is the current user any kind of member of this agency?
create or replace function public.is_agency_member(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid()
  );
$$;

-- Is the current user the owner of this agency?
create or replace function public.is_agency_owner(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Is the current user specifically a 'team' member (not owner)?
create or replace function public.is_agency_team(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid() and m.role = 'team'
  );
$$;

-- owner OR team. This is the predicate used by almost every write policy.
create or replace function public.is_agency_staff(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid()
      and m.role in ('owner','team')
  );
$$;

-- Is the current user a client of this agency whose client company is still live?
create or replace function public.is_agency_client(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.agency_members m
    join public.clients c on c.id = m.client_id
    where m.agency_id = p_agency and m.profile_id = auth.uid()
      and m.role = 'client' and c.archived_at is null
  );
$$;

-- Which client company does the current user belong to in this agency? NULL for staff.
create or replace function public.current_client_id(p_agency uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.client_id
  from public.agency_members m
  join public.clients c on c.id = m.client_id
  where m.agency_id = p_agency and m.profile_id = auth.uid()
    and m.role = 'client' and c.archived_at is null
  limit 1;
$$;

-- May the current user view this profile at all?
create or replace function public.can_view_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_profile = auth.uid()
    or exists (                              -- I am staff somewhere they are a member
      select 1
      from public.agency_members me
      join public.agency_members them on them.agency_id = me.agency_id
      where me.profile_id = auth.uid() and me.role in ('owner','team')
        and them.profile_id = p_profile
    )
    or exists (                              -- I am a client; I may see staff of that agency
      select 1
      from public.agency_members me
      join public.agency_members them on them.agency_id = me.agency_id
      where me.profile_id = auth.uid() and me.role = 'client'
        and them.profile_id = p_profile
        and (them.role in ('owner','team') or them.client_id = me.client_id)
    );
$$;


create or replace function public.can_access_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency   uuid;
  v_archived timestamptz;
  v_client   uuid;
  v_ok       boolean;
begin
  if p_folder is null or auth.uid() is null then
    return false;
  end if;

  select f.agency_id, f.archived_at into v_agency, v_archived
  from public.folders f where f.id = p_folder;

  if v_agency is null then
    return false;                      -- folder does not exist: indistinguishable from denied
  end if;

  if public.is_agency_staff(v_agency) then
    return true;                       -- staff read every folder in their agency, archived included
  end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then
    return false;
  end if;

  if v_archived is not null then
    return false;                      -- clients never see archived folders
  end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p
      join chain c on p.id = c.parent_id
  )
  select exists (
    select 1
    from chain c
    join public.folder_permissions fp on fp.folder_id = c.id
    where fp.client_id = v_client
      and c.archived_at is null
  ) into v_ok;

  return coalesce(v_ok, false);
end;
$$;


-- May the current user place new objects in this folder?
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
  v_ok     boolean;
begin
  select f.agency_id into v_agency from public.folders f
  where f.id = p_folder and f.archived_at is null;
  if v_agency is null then return false; end if;

  if public.is_agency_staff(v_agency) then return true; end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then return false; end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p join chain c on p.id = c.parent_id
  )
  select exists (
    select 1 from chain c
    join public.folder_permissions fp on fp.folder_id = c.id
    where fp.client_id = v_client and fp.can_upload = true and c.archived_at is null
  ) into v_ok;

  return coalesce(v_ok, false);
end;
$$;


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
      and public.can_access_folder(c.folder_id)
      and (
        public.is_agency_staff(c.agency_id)
        or (c.client_visible = true and c.archived_at is null)
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
      and public.can_access_folder(b.folder_id)
      and (
        public.is_agency_staff(b.agency_id)
        or (b.client_visible = true and b.archived_at is null)
      )
  );
$$;

create or replace function public.can_read_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and public.can_read_board(t.board_id)
      and (public.is_agency_staff(t.agency_id) or t.client_visible = true)
  );
$$;

create or replace function public.can_read_invoice(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = p_invoice
      and (
        public.is_agency_staff(i.agency_id)
        or (i.client_id = public.current_client_id(i.agency_id) and i.status <> 'draft')
      )
  );
$$;


create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


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

create trigger on_agency_created
  after insert on public.agencies
  for each row execute function public.handle_new_agency();


create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_count integer;
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;

  if old.role = 'owner' then
    select count(*) into v_owner_count
    from public.agency_members
    where agency_id = old.agency_id and role = 'owner' and id <> old.id;

    if v_owner_count = 0 then
      raise exception 'An agency must keep at least one owner';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_last_owner_trg
  before update or delete on public.agency_members
  for each row execute function public.guard_last_owner();


create or replace function public.guard_folder_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'A folder cannot be its own parent';
  end if;

  with recursive chain as (
    select f.id, f.parent_id from public.folders f where f.id = new.parent_id
    union all
    select p.id, p.parent_id from public.folders p join chain c on p.id = c.parent_id
  )
  select exists (select 1 from chain where id = new.id) into v_cycle;

  if v_cycle then
    raise exception 'A folder cannot be moved inside one of its own descendants';
  end if;

  -- parent must live in the same agency
  if not exists (
    select 1 from public.folders f
    where f.id = new.parent_id and f.agency_id = new.agency_id
  ) then
    raise exception 'Parent folder belongs to a different agency';
  end if;

  return new;
end;
$$;

create trigger guard_folder_cycle_trg
  before insert or update of parent_id on public.folders
  for each row execute function public.guard_folder_cycle();


create or replace function public.compute_line_item_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.amount_cents = round(new.quantity_milli::numeric * new.unit_price_cents / 1000.0);
  return new;
end;
$$;

create trigger compute_line_item_amount_trg
  before insert or update on public.invoice_line_items
  for each row execute function public.compute_line_item_amount();

create or replace function public.recalculate_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice  uuid := coalesce(new.invoice_id, old.invoice_id);
  v_subtotal bigint;
  v_discount bigint;
  v_rate     integer;
  v_tax      bigint;
begin
  select coalesce(sum(amount_cents), 0) into v_subtotal
  from public.invoice_line_items where invoice_id = v_invoice;

  select discount_cents, tax_rate_bp into v_discount, v_rate
  from public.invoices where id = v_invoice;

  v_discount := least(coalesce(v_discount, 0), v_subtotal);
  v_tax := round((v_subtotal - v_discount)::numeric * coalesce(v_rate, 0) / 10000.0);

  update public.invoices
  set subtotal_cents = v_subtotal,
      tax_cents      = v_tax,
      discount_cents = v_discount,
      total_cents    = v_subtotal - v_discount + v_tax
  where id = v_invoice;

  return null;
end;
$$;

create trigger recalculate_invoice_totals_trg
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.recalculate_invoice_totals();

-- Re-run when the invoice's own rate/discount changes.
create or replace function public.recalculate_invoice_totals_self()
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
  select coalesce(sum(amount_cents), 0) into v_subtotal
  from public.invoice_line_items where invoice_id = new.id;

  v_discount := least(coalesce(new.discount_cents, 0), v_subtotal);
  v_tax := round((v_subtotal - v_discount)::numeric * coalesce(new.tax_rate_bp, 0) / 10000.0);

  new.subtotal_cents := v_subtotal;
  new.discount_cents := v_discount;
  new.tax_cents      := v_tax;
  new.total_cents    := v_subtotal - v_discount + v_tax;
  return new;
end;
$$;

create trigger recalculate_invoice_totals_self_trg
  before update of tax_rate_bp, discount_cents on public.invoices
  for each row execute function public.recalculate_invoice_totals_self();


create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next integer;
begin
  if new.invoice_number is not null and trim(new.invoice_number) <> '' then
    return new;
  end if;

  select coalesce(max(substring(invoice_number from '\d+$')::integer), 0) + 1
  into v_next
  from public.invoices
  where agency_id = new.agency_id and invoice_number ~ '^INV-\d+$';

  new.invoice_number := 'INV-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create trigger assign_invoice_number_trg
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();


create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return null;
end;
$$;

create trigger touch_conversation_trg
  after insert on public.messages
  for each row execute function public.touch_conversation();


create or replace function public.accept_invitation(p_token uuid)
returns table (agency_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv        public.invitations%rowtype;
  v_email    text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into inv from public.invitations
  where token = p_token for update;

  if inv.id is null then
    raise exception 'Invitation not found';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Invitation is no longer valid';
  end if;
  if inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(inv.email) <> lower(v_email) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  insert into public.agency_members (agency_id, profile_id, role, client_id, invited_by)
  values (inv.agency_id, auth.uid(), inv.intended_role, inv.client_id, inv.invited_by)
  on conflict (agency_id, profile_id) do nothing;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return query select inv.agency_id, inv.intended_role;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;


create or replace function public.folder_breadcrumb(p_folder uuid)
returns table (id uuid, name text, color text, depth integer)
language sql
stable
security invoker
as $$
  with recursive chain as (
    select f.id, f.parent_id, f.name, f.color, 0 as depth
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.name, p.color, c.depth + 1
      from public.folders p join chain c on p.id = c.parent_id
  )
  select id, name, color, depth from chain order by depth desc;
$$;


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
   where t.agency_id = p_agency and t.title ilike q.pattern
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


alter table public.profiles            enable row level security;
alter table public.agencies            enable row level security;
alter table public.clients             enable row level security;
alter table public.agency_members      enable row level security;
alter table public.invitations         enable row level security;
alter table public.folders             enable row level security;
alter table public.folder_permissions  enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.boards              enable row level security;
alter table public.board_columns       enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_comments       enable row level security;
alter table public.docs                enable row level security;
alter table public.files               enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_line_items  enable row level security;
alter table public.payments            enable row level security;
alter table public.activity_logs       enable row level security;


create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_view_profile(id));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


create policy agencies_select on public.agencies
  for select to authenticated
  using (public.is_agency_member(id));

create policy agencies_insert on public.agencies
  for insert to authenticated
  with check (created_by = auth.uid());

create policy agencies_update_owner on public.agencies
  for update to authenticated
  using (public.is_agency_owner(id))
  with check (public.is_agency_owner(id));

create policy agencies_delete_owner on public.agencies
  for delete to authenticated
  using (public.is_agency_owner(id));


create policy agency_members_select on public.agency_members
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_agency_staff(agency_id)
    or (public.is_agency_client(agency_id) and client_id = public.current_client_id(agency_id))
  );

create policy agency_members_insert_owner on public.agency_members
  for insert to authenticated
  with check (public.is_agency_owner(agency_id));

create policy agency_members_update_owner on public.agency_members
  for update to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

create policy agency_members_delete on public.agency_members
  for delete to authenticated
  using (public.is_agency_owner(agency_id) or profile_id = auth.uid());


create policy clients_select on public.clients
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or id = public.current_client_id(agency_id)
  );

create policy clients_insert_staff on public.clients
  for insert to authenticated
  with check (public.is_agency_staff(agency_id) and created_by = auth.uid());

create policy clients_update_staff on public.clients
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy clients_delete_owner on public.clients
  for delete to authenticated
  using (public.is_agency_owner(agency_id));


create policy invitations_select_staff on public.invitations
  for select to authenticated
  using (public.is_agency_staff(agency_id));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and (
      -- only owners may invite staff
      (intended_role in ('owner','team') and public.is_agency_owner(agency_id))
      -- owner or team may invite clients, and must anchor to a client of this agency
      or (
        intended_role = 'client'
        and public.is_agency_staff(agency_id)
        and exists (
          select 1 from public.clients c
          where c.id = client_id and c.agency_id = agency_id and c.archived_at is null
        )
      )
    )
  );

create policy invitations_update_staff on public.invitations
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id) and status in ('pending','revoked','expired'));

create policy invitations_delete_owner on public.invitations
  for delete to authenticated
  using (public.is_agency_owner(agency_id));


create policy folders_select on public.folders
  for select to authenticated
  using (public.can_access_folder(id));

create policy folders_insert_staff on public.folders
  for insert to authenticated
  with check (public.is_agency_staff(agency_id) and created_by = auth.uid());

create policy folders_update_staff on public.folders
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy folders_delete_staff on public.folders
  for delete to authenticated
  using (public.is_agency_staff(agency_id));


create policy folder_permissions_select on public.folder_permissions
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or client_id = public.current_client_id(agency_id)
  );

create policy folder_permissions_insert_staff on public.folder_permissions
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = agency_id)
  );

create policy folder_permissions_update_staff on public.folder_permissions
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy folder_permissions_delete_staff on public.folder_permissions
  for delete to authenticated
  using (public.is_agency_staff(agency_id));


create policy conversations_select on public.conversations
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy conversations_insert_staff on public.conversations
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy conversations_update_staff on public.conversations
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy conversations_delete_staff on public.conversations
  for delete to authenticated
  using (public.is_agency_staff(agency_id));


create policy messages_select on public.messages
  for select to authenticated
  using (
    public.can_read_conversation(conversation_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_read_conversation(conversation_id)
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true          -- a client cannot author an internal note
    )
  );

create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (
    sender_id = auth.uid()
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy messages_delete on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.is_agency_owner(agency_id));


create policy boards_select on public.boards
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy boards_insert_staff on public.boards
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy boards_update_staff on public.boards
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy boards_delete_staff on public.boards
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

create policy board_columns_select on public.board_columns
  for select to authenticated
  using (public.can_read_board(board_id));

create policy board_columns_write_staff on public.board_columns
  for all to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (select 1 from public.boards b where b.id = board_id and b.agency_id = agency_id)
  );


create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.can_read_board(board_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy tasks_insert_staff on public.tasks
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.boards b
      where b.id = board_id and b.agency_id = agency_id and b.folder_id = folder_id
    )
    and exists (select 1 from public.board_columns c where c.id = column_id and c.board_id = board_id)
  );

create policy tasks_update_staff on public.tasks
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (select 1 from public.board_columns c where c.id = column_id and c.board_id = board_id)
  );

create policy tasks_delete_staff on public.tasks
  for delete to authenticated
  using (public.is_agency_staff(agency_id));


create policy task_comments_select on public.task_comments
  for select to authenticated
  using (
    public.can_read_task(task_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_read_task(task_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_update_author on public.task_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_agency_owner(agency_id));


create policy docs_select on public.docs
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy docs_insert_staff on public.docs
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy docs_update_staff on public.docs
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy docs_delete_staff on public.docs
  for delete to authenticated
  using (public.is_agency_staff(agency_id));


create policy files_select on public.files
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy files_insert on public.files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.can_upload_to_folder(folder_id)
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true          -- client uploads are visible to the client who made them
    )
  );

create policy files_update_staff on public.files
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy files_delete on public.files
  for delete to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (uploaded_by = auth.uid() and public.can_upload_to_folder(folder_id))
  );


create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (client_id = public.current_client_id(agency_id) and status <> 'draft')
  );

create policy invoices_insert_staff on public.invoices
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = agency_id)
  );

create policy invoices_update_staff on public.invoices
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy invoices_delete_owner_draft on public.invoices
  for delete to authenticated
  using (public.is_agency_owner(agency_id) and status = 'draft');

create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using (public.can_read_invoice(invoice_id));

create policy invoice_line_items_write_staff on public.invoice_line_items
  for all to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.agency_id = agency_id and i.status = 'draft'
    )
  );

create policy payments_select on public.payments
  for select to authenticated
  using (public.can_read_invoice(invoice_id));

create policy payments_insert_owner_manual on public.payments
  for insert to authenticated
  with check (public.is_agency_owner(agency_id) and provider = 'manual');


create policy activity_logs_select_staff on public.activity_logs
  for select to authenticated
  using (public.is_agency_staff(agency_id));

create policy activity_logs_insert_member on public.activity_logs
  for insert to authenticated
  with check (public.is_agency_member(agency_id) and actor_id = auth.uid());


alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.board_columns;
alter publication supabase_realtime add table public.conversations;


insert into storage.buckets (id, name, public, file_size_limit)
values
  ('project-files',   'project-files',   false, 26214400),
  ('agency-branding', 'agency-branding', true,   2097152),
  ('avatars',         'avatars',         true,   2097152)
on conflict (id) do nothing;


-- ---------- project-files (private) ----------
create policy project_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = storage.objects.name
        and public.can_access_folder(f.folder_id)
        and (public.is_agency_staff(f.agency_id) or f.client_visible = true)
    )
  );

create policy project_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and public.is_agency_member((storage.foldername(name))[1]::uuid)
    and public.can_upload_to_folder((storage.foldername(name))[2]::uuid)
  );

create policy project_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-files'
    and (
      public.is_agency_staff((storage.foldername(name))[1]::uuid)
      or owner = auth.uid()
    )
  );

-- ---------- agency-branding (public read, owner write) ----------
create policy branding_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

create policy branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

create policy branding_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

-- ---------- avatars (public read, self write) ----------
create policy avatars_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

