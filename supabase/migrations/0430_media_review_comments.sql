-- Pinned image-review comments for conversation attachments.
create table if not exists public.media_review_comments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  attachment_id uuid not null references public.message_attachments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  x_percent numeric(6,3) check (x_percent is null or (x_percent between 0 and 100)),
  y_percent numeric(6,3) check (y_percent is null or (y_percent between 0 and 100)),
  created_at timestamptz not null default now(),
  constraint media_review_pin_pair check ((x_percent is null) = (y_percent is null))
);
create index if not exists media_review_comments_attachment_idx on public.media_review_comments(attachment_id,created_at);
alter table public.media_review_comments enable row level security;
drop policy if exists media_review_comments_select on public.media_review_comments;
create policy media_review_comments_select on public.media_review_comments for select to authenticated using (
  exists(select 1 from public.message_attachments a join public.messages m on m.id=a.message_id where a.id=attachment_id and public.can_read_conversation(m.conversation_id) and (public.is_agency_staff(m.agency_id) or m.client_visible=true))
);
drop policy if exists media_review_comments_insert on public.media_review_comments;
create policy media_review_comments_insert on public.media_review_comments for insert to authenticated with check (
  author_id=auth.uid() and exists(select 1 from public.message_attachments a join public.messages m on m.id=a.message_id where a.id=attachment_id and a.agency_id=media_review_comments.agency_id and public.can_read_conversation(m.conversation_id) and (public.is_agency_staff(m.agency_id) or m.client_visible=true))
);
drop policy if exists media_review_comments_delete on public.media_review_comments;
create policy media_review_comments_delete on public.media_review_comments for delete to authenticated using (author_id=auth.uid() or public.is_agency_staff(agency_id));
