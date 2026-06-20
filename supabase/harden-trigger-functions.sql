-- Migration: security hardening for trigger functions
-- Addresses Supabase advisors:
--   - function_search_path_mutable
--   - anon/authenticated_security_definer_function_executable
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Pin search_path on the two trigger functions (others already set it).
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into profiles (id, email)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data->>'email', '')
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block user creation even if profile insert fails
  return new;
end;
$$;

create or replace function sync_contest_require_login_from_whitelist()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_contest_id uuid;
begin
  v_contest_id := coalesce(new.contest_id, old.contest_id);
  if v_contest_id is null then
    return coalesce(new, old);
  end if;

  update contests c
  set require_login = exists (
    select 1
    from allowed_voters av
    where av.contest_id = c.id
  )
  where c.id = v_contest_id;

  return coalesce(new, old);
end;
$$;

-- 2. These are trigger-only functions; they should not be callable as RPCs.
--    Triggers still fire regardless of these grants.
revoke all on function handle_new_user() from public, anon, authenticated;
revoke all on function sync_contest_require_login_from_whitelist() from public, anon, authenticated;

-- 3. create_contest_with_relations should only be callable by signed-in users.
--    Supabase grants EXECUTE to anon by default, so revoke it explicitly
--    (the function also blocks anon internally via auth.uid()).
revoke all on function create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) from anon;
