-- Migration: submission gate + required comments + longer comments
-- Run once in the Supabase SQL editor on the existing project.
-- Safe to re-run (idempotent).

-- 1. New contest flags
alter table contests
  add column if not exists submissions_open  boolean not null default false,
  add column if not exists comments_required boolean not null default false;

-- Preserve behavior for contests that are already open: they were accepting
-- submissions before this migration, so keep submissions open for them.
-- New contests start with submissions locked (the default).
update contests set submissions_open = true where status = 'open';

-- 2. Allow longer, multi-line comments (was 500)
alter table vote_comments
  drop constraint if exists vote_comments_comment_check;
alter table vote_comments
  add constraint vote_comments_comment_check check (char_length(comment) <= 2000);

-- 3. Replace create RPC with new p_comments_required parameter.
--    Drop the old 8-arg overload first so the name is unambiguous.
drop function if exists create_contest_with_relations(
  text, text, integer, boolean, boolean, timestamptz, jsonb, text[]
);

create or replace function create_contest_with_relations(
  p_title text,
  p_description text,
  p_max_winners integer,
  p_results_visible_to_voters boolean,
  p_randomize_options boolean,
  p_comments_required boolean,
  p_end_date timestamptz,
  p_options jsonb,
  p_allowed_emails text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_contest_id uuid;
  v_option jsonb;
  v_email text;
  v_valid_option_count integer := 0;
  v_order_index integer := 0;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Contest title is required';
  end if;

  if p_max_winners is null or p_max_winners < 1 then
    raise exception 'Contest must have at least one winner';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'Contest options must be an array';
  end if;

  select count(*)
    into v_valid_option_count
  from jsonb_array_elements(p_options) option_item
  where coalesce(btrim(option_item->>'title'), '') <> '';

  if v_valid_option_count < 2 then
    raise exception 'At least 2 options are required';
  end if;

  if p_max_winners >= v_valid_option_count then
    raise exception 'Number of winners must be less than the number of options';
  end if;

  insert into profiles (id, email)
  select
    u.id,
    coalesce(u.email, u.raw_user_meta_data->>'email', '')
  from auth.users u
  where u.id = v_admin_id
  on conflict (id) do update
    set email = excluded.email;

  insert into contests (
    admin_id,
    title,
    description,
    max_winners,
    require_login,
    results_visible_to_voters,
    randomize_options,
    comments_required,
    end_date,
    status
  )
  values (
    v_admin_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_max_winners,
    coalesce(array_length(p_allowed_emails, 1), 0) > 0,
    coalesce(p_results_visible_to_voters, true),
    coalesce(p_randomize_options, true),
    coalesce(p_comments_required, false),
    p_end_date,
    'draft'
  )
  returning id into v_contest_id;

  for v_option in
    select value from jsonb_array_elements(p_options)
  loop
    if coalesce(btrim(v_option->>'title'), '') = '' then
      continue;
    end if;

    insert into contest_options (contest_id, title, description, order_index)
    values (
      v_contest_id,
      btrim(v_option->>'title'),
      nullif(btrim(coalesce(v_option->>'description', '')), ''),
      v_order_index
    );

    v_order_index := v_order_index + 1;
  end loop;

  foreach v_email in array coalesce(p_allowed_emails, array[]::text[])
  loop
    v_email := lower(btrim(v_email));
    if v_email = '' then
      continue;
    end if;

    insert into allowed_voters (contest_id, email)
    values (v_contest_id, v_email)
    on conflict (contest_id, email) do nothing;
  end loop;

  return v_contest_id;
end;
$$;

revoke all on function create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) from public;
grant execute on function create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) to authenticated;
