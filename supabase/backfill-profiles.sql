-- ============================================================
-- Ranked Voting — One-time profiles backfill
-- Creates/updates public.profiles rows for all existing auth.users.
-- Safe to re-run.
-- ============================================================

begin;

insert into public.profiles (id, email)
select
  u.id,
  coalesce(u.email, u.raw_user_meta_data->>'email', '') as email
from auth.users u
on conflict (id) do update
  set email = excluded.email;

commit;
