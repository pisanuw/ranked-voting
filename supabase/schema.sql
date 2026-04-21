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
  require_login             boolean not null default true,
  results_visible_to_voters boolean not null default true,
  randomize_options         boolean not null default true,
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

-- Allowed voter emails (whitelist). If no rows for a contest, everyone can vote.
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

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on new user signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
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

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles         enable row level security;
alter table contests         enable row level security;
alter table contest_options  enable row level security;
alter table allowed_voters   enable row level security;
alter table votes            enable row level security;
alter table vote_rankings    enable row level security;

-- profiles
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- contests: admin full access; anyone authenticated can read open contests by vote_token
-- (the Netlify functions use the service key and bypass RLS)
create policy "Admin manages their contests"
  on contests for all using (auth.uid() = admin_id);

-- Anyone with the vote_token URL can read open contests (token = 128-bit random hex)
create policy "Anyone can read open contests"
  on contests for select using (status = 'open');

-- contest_options: follow parent contest permissions
create policy "Admin manages options"
  on contest_options for all
  using (exists (
    select 1 from contests where id = contest_id and admin_id = auth.uid()
  ));

create policy "Anyone can read options of open contests"
  on contest_options for select
  using (exists (select 1 from contests where id = contest_id and status = 'open'));

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
