-- Add timestamp support for video review comments. Safe to run after 0430_media_review_comments.sql.
alter table public.media_review_comments
  add column if not exists time_seconds numeric(12,3)
  check (time_seconds is null or time_seconds >= 0);

create index if not exists media_review_comments_video_time_idx
  on public.media_review_comments(attachment_id, time_seconds)
  where time_seconds is not null;
