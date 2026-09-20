-- Conversation messages may have an optional caption and one or more private attachments.
alter table public.messages
  alter column body set default '';

alter table public.messages
  drop constraint if exists messages_body_check;

alter table public.messages
  add constraint messages_body_check
  check (char_length(body) between 0 and 20000);

create table public.message_attachments (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id      uuid not null references public.messages(id) on delete cascade,
  uploaded_by     uuid not null references public.profiles(id) on delete restrict,
  storage_path    text not null unique,
  original_name   text not null check (char_length(original_name) between 1 and 255),
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at      timestamptz not null default now()
);

create index message_attachments_message_idx on public.message_attachments(message_id, created_at);
create index message_attachments_conversation_idx on public.message_attachments(conversation_id);

alter table public.message_attachments enable row level security;

create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_id
        and m.conversation_id = message_attachments.conversation_id
        and public.can_read_conversation(m.conversation_id)
        and (public.is_agency_staff(m.agency_id) or m.client_visible = true)
    )
  );

create policy message_attachments_insert on public.message_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.messages m
      where m.id = message_id
        and m.agency_id = message_attachments.agency_id
        and m.conversation_id = message_attachments.conversation_id
        and m.sender_id = auth.uid()
        and public.can_read_conversation(m.conversation_id)
        and (public.is_agency_staff(m.agency_id) or m.client_visible = true)
    )
  );

create policy message_attachments_delete on public.message_attachments
  for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or public.is_agency_staff(agency_id)
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('conversation-attachments', 'conversation-attachments', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

create policy conversation_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
      where a.storage_path = storage.objects.name
        and public.can_read_conversation(m.conversation_id)
        and (public.is_agency_staff(m.agency_id) or m.client_visible = true)
    )
  );

create policy conversation_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
      where a.storage_path = storage.objects.name
        and a.uploaded_by = auth.uid()
        and m.sender_id = auth.uid()
        and public.can_read_conversation(m.conversation_id)
        and (public.is_agency_staff(m.agency_id) or m.client_visible = true)
    )
  );

create policy conversation_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1
      from public.message_attachments a
      where a.storage_path = storage.objects.name
        and (a.uploaded_by = auth.uid() or public.is_agency_staff(a.agency_id))
    )
  );
