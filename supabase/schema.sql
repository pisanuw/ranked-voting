-- ============================================================
-- Ranked Voting — Supabase Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles: mirrors auth.users, created automatically on signup
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now()
);

-- Contests
create table if not exists contests (
  id                        uuid primary key default gen_random_uuid(),
  admin_id                  uuid not null references profiles(id) on delete cascade,
  title                     text not null,
  description               text,
  -- shareable token for voting/results URLs (never the contest id)
  vote_token                text unique not null default encode(gen_random_bytes(18), 'hex'),
  max_winners               integer not null default 1 check (max_winners >= 1),
  -- denormalized cache of whitelist state (maintained by trigger below)
  require_login             boolean not null default true,
  results_visible_to_voters boolean not null default true,
  randomize_options         boolean not null default true,
  -- when false, voters can rank + comment but cannot submit yet
  submissions_open          boolean not null default false,
  -- when true, voters must comment on every option before submitting
  comments_required         boolean not null default false,
  end_date                  timestamptz,
  status                    text not null default 'draft'
                              check (status in ('draft', 'open', 'closed')),
  created_at                timestamptz default now()
);

-- Contest options/candidates
create table if not exists contest_options (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references contests(id) on delete cascade,
  title       text not null,
  description text,
  order_index integer not null default 0,
  created_at  timestamptz default now()
);

-- Allowed voter emails (whitelist). If no rows for a contest, anyone with the voting URL may vote.
create table if not exists allowed_voters (
  id         uuid primary key default gen_random_uuid(),
  contest_id uuid not null references contests(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now(),
  unique (contest_id, email)
);

-- Votes (one per voter per contest)
create table if not exists votes (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references contests(id) on delete cascade,
  voter_id     uuid references profiles(id),        -- null for anonymous
  voter_token  text,                                -- anonymous browser token
  created_at   timestamptz default now(),
  -- prevent double-voting
  unique (contest_id, voter_id),
  unique (contest_id, voter_token),
  -- must have at least one identifier
  constraint votes_has_identifier check (voter_id is not null or voter_token is not null)
);

-- Vote rankings (the actual ballot)
create table if not exists vote_rankings (
  id        uuid primary key default gen_random_uuid(),
  vote_id   uuid not null references votes(id) on delete cascade,
  option_id uuid not null references contest_options(id) on delete cascade,
  rank      integer not null check (rank >= 1),
  unique (vote_id, option_id),
  unique (vote_id, rank)
);

-- Vote comments (optional per-option feedback from voters)
create table if not exists vote_comments (
  id          uuid primary key default gen_random_uuid(),
  vote_id     uuid not null references votes(id) on delete cascade,
  option_id   uuid not null references contest_options(id) on delete cascade,
  comment     text not null check (char_length(comment) <= 2000),
  created_at  timestamptz default now(),
  unique (vote_id, option_id)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on new user signup
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Keep contests.require_login synchronized with whitelist presence.
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

drop trigger if exists on_allowed_voters_changed on allowed_voters;
create trigger on_allowed_voters_changed
  after insert or update or delete on allowed_voters
  for each row execute procedure sync_contest_require_login_from_whitelist();

-- These are trigger-only functions; they should not be callable as PostgREST RPCs.
-- Triggers still fire regardless of these grants.
revoke all on function handle_new_user() from public, anon, authenticated;
revoke all on function sync_contest_require_login_from_whitelist() from public, anon, authenticated;

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

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

create or replace function submit_vote_with_rankings(
  p_contest_id uuid,
  p_voter_id uuid,
  p_voter_token text,
  p_rankings jsonb,
  p_comments jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote_id uuid;
begin
  if p_contest_id is null then
    raise exception 'Contest id is required';
  end if;

  if p_voter_id is null and nullif(btrim(coalesce(p_voter_token, '')), '') is null then
    raise exception 'No voter identity provided';
  end if;

  if p_rankings is null or jsonb_typeof(p_rankings) <> 'array' or jsonb_array_length(p_rankings) = 0 then
    raise exception 'Rankings are required';
  end if;

  if p_voter_id is not null then
    insert into profiles (id, email)
    select
      u.id,
      coalesce(u.email, u.raw_user_meta_data->>'email', '')
    from auth.users u
    where u.id = p_voter_id
    on conflict (id) do update
      set email = excluded.email;
  end if;

  insert into votes (contest_id, voter_id, voter_token)
  values (
    p_contest_id,
    p_voter_id,
    case when p_voter_id is null then nullif(btrim(p_voter_token), '') else null end
  )
  returning id into v_vote_id;

  insert into vote_rankings (vote_id, option_id, rank)
  select
    v_vote_id,
    (ranking->>'option_id')::uuid,
    (ranking->>'rank')::integer
  from jsonb_array_elements(p_rankings) ranking;

  -- Insert optional per-option comments
  if p_comments is not null and jsonb_typeof(p_comments) = 'array' then
    insert into vote_comments (vote_id, option_id, comment)
    select
      v_vote_id,
      (c->>'option_id')::uuid,
      btrim(c->>'comment')
    from jsonb_array_elements(p_comments) c
    where btrim(coalesce(c->>'comment', '')) <> '';
  end if;

  return v_vote_id;
end;
$$;

revoke all on function create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) from public, anon;
grant execute on function create_contest_with_relations(text, text, integer, boolean, boolean, boolean, timestamptz, jsonb, text[]) to authenticated;

revoke all on function submit_vote_with_rankings(uuid, uuid, text, jsonb, jsonb) from public;
revoke all on function submit_vote_with_rankings(uuid, uuid, text, jsonb, jsonb) from anon;
revoke all on function submit_vote_with_rankings(uuid, uuid, text, jsonb, jsonb) from authenticated;
grant execute on function submit_vote_with_rankings(uuid, uuid, text, jsonb, jsonb) to service_role;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles         enable row level security;
alter table contests         enable row level security;
alter table contest_options  enable row level security;
alter table allowed_voters   enable row level security;
alter table votes            enable row level security;
alter table vote_rankings    enable row level security;
alter table vote_comments    enable row level security;

-- profiles
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Admin reads voter profiles"
  on profiles for select
  using (exists (
    select 1 from votes v
    join contests c on c.id = v.contest_id
    where v.voter_id = profiles.id and c.admin_id = auth.uid()
  ));

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- contests: admin full access
-- (the Netlify functions use the service key and bypass RLS)
create policy "Admin manages their contests"
  on contests for all using (auth.uid() = admin_id);

-- Contests are NOT readable via the anon key.
-- All public reads go through the get-contest Netlify function (service key, server-side)
-- which only returns a single contest by token — no enumeration possible.
-- Only authenticated admins can read contests directly.
create policy "Admin reads own contests"
  on contests for select using (auth.uid() = admin_id);

-- contest_options: follow parent contest permissions
create policy "Admin manages options"
  on contest_options for all
  using (exists (
    select 1 from contests where id = contest_id and admin_id = auth.uid()
  ));

-- allowed_voters: only admin
create policy "Admin manages allowed voters"
  on allowed_voters for all
  using (exists (
    select 1 from contests where id = contest_id and admin_id = auth.uid()
  ));

-- votes & vote_rankings: Netlify functions handle inserts via service key;
-- allow admin to read their contest's votes
create policy "Admin reads votes"
  on votes for select
  using (exists (
    select 1 from contests where id = contest_id and admin_id = auth.uid()
  ));

create policy "Admin reads vote rankings"
  on vote_rankings for select
  using (exists (
    select 1 from votes v
    join contests c on c.id = v.contest_id
    where v.id = vote_id and c.admin_id = auth.uid()
  ));

-- vote_comments: admin can read (comment text only, joined without voter identity)
create policy "Admin reads vote comments"
  on vote_comments for select
  using (exists (
    select 1 from votes v
    join contests c on c.id = v.contest_id
    where v.id = vote_id and c.admin_id = auth.uid()
  ));

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_contests_admin_id    on contests(admin_id);
create index if not exists idx_contests_vote_token  on contests(vote_token);
create index if not exists idx_contests_status      on contests(status);
create index if not exists idx_options_contest_id   on contest_options(contest_id);
create index if not exists idx_allowed_contest_id   on allowed_voters(contest_id);
create index if not exists idx_votes_contest_id     on votes(contest_id);
create index if not exists idx_rankings_vote_id     on vote_rankings(vote_id);
create index if not exists idx_comments_vote_id     on vote_comments(vote_id);
create index if not exists idx_comments_option_id   on vote_comments(option_id);
