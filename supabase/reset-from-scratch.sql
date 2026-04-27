-- ============================================================
-- Ranked Voting — FULL RESET (DESTRUCTIVE)
-- Drops all app tables/functions/triggers/policies and recreates from scratch.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- DROP EXISTING OBJECTS
-- ------------------------------------------------------------

drop trigger if exists on_allowed_voters_changed on public.allowed_voters;
drop function if exists public.sync_contest_require_login_from_whitelist();

drop function if exists public.submit_vote_with_rankings(uuid, uuid, text, jsonb);
drop function if exists public.create_contest_with_relations(text, text, integer, boolean, boolean, timestamptz, jsonb, text[]);

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.vote_rankings cascade;
drop table if exists public.votes cascade;
drop table if exists public.allowed_voters cascade;
drop table if exists public.contest_options cascade;
drop table if exists public.contests cascade;
drop table if exists public.profiles cascade;

-- ------------------------------------------------------------
-- CREATE BASE OBJECTS
-- ------------------------------------------------------------

create extension if not exists "pgcrypto";

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now()
);

create table public.contests (
  id                        uuid primary key default gen_random_uuid(),
  admin_id                  uuid not null references public.profiles(id) on delete cascade,
  title                     text not null,
  description               text,
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

create table public.contest_options (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references public.contests(id) on delete cascade,
  title       text not null,
  description text,
  order_index integer not null default 0,
  created_at  timestamptz default now()
);

create table public.allowed_voters (
  id         uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now(),
  unique (contest_id, email)
);

create table public.votes (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references public.contests(id) on delete cascade,
  voter_id     uuid references public.profiles(id),
  voter_token  text,
  created_at   timestamptz default now(),
  unique (contest_id, voter_id),
  unique (contest_id, voter_token),
  constraint votes_has_identifier check (voter_id is not null or voter_token is not null)
);

create table public.vote_rankings (
  id        uuid primary key default gen_random_uuid(),
  vote_id   uuid not null references public.votes(id) on delete cascade,
  option_id uuid not null references public.contest_options(id) on delete cascade,
  rank      integer not null check (rank >= 1),
  unique (vote_id, option_id),
  unique (vote_id, rank)
);

-- ------------------------------------------------------------
-- TRIGGERS + FUNCTIONS
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data->>'email', '')
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.sync_contest_require_login_from_whitelist()
returns trigger language plpgsql security definer as $$
declare
  v_contest_id uuid;
begin
  v_contest_id := coalesce(new.contest_id, old.contest_id);
  if v_contest_id is null then
    return coalesce(new, old);
  end if;

  update public.contests c
  set require_login = exists (
    select 1
    from public.allowed_voters av
    where av.contest_id = c.id
  )
  where c.id = v_contest_id;

  return coalesce(new, old);
end;
$$;

create trigger on_allowed_voters_changed
  after insert or update or delete on public.allowed_voters
  for each row execute procedure public.sync_contest_require_login_from_whitelist();

create or replace function public.create_contest_with_relations(
  p_title text,
  p_description text,
  p_max_winners integer,
  p_results_visible_to_voters boolean,
  p_randomize_options boolean,
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

  insert into public.profiles (id, email)
  select
    u.id,
    coalesce(u.email, u.raw_user_meta_data->>'email', '')
  from auth.users u
  where u.id = v_admin_id
  on conflict (id) do update
    set email = excluded.email;

  insert into public.contests (
    admin_id,
    title,
    description,
    max_winners,
    require_login,
    results_visible_to_voters,
    randomize_options,
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

    insert into public.contest_options (contest_id, title, description, order_index)
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

    insert into public.allowed_voters (contest_id, email)
    values (v_contest_id, v_email)
    on conflict (contest_id, email) do nothing;
  end loop;

  return v_contest_id;
end;
$$;

create or replace function public.submit_vote_with_rankings(
  p_contest_id uuid,
  p_voter_id uuid,
  p_voter_token text,
  p_rankings jsonb
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
    insert into public.profiles (id, email)
    select
      u.id,
      coalesce(u.email, u.raw_user_meta_data->>'email', '')
    from auth.users u
    where u.id = p_voter_id
    on conflict (id) do update
      set email = excluded.email;
  end if;

  insert into public.votes (contest_id, voter_id, voter_token)
  values (
    p_contest_id,
    p_voter_id,
    case when p_voter_id is null then nullif(btrim(p_voter_token), '') else null end
  )
  returning id into v_vote_id;

  insert into public.vote_rankings (vote_id, option_id, rank)
  select
    v_vote_id,
    (ranking->>'option_id')::uuid,
    (ranking->>'rank')::integer
  from jsonb_array_elements(p_rankings) ranking;

  return v_vote_id;
end;
$$;

-- ------------------------------------------------------------
-- FUNCTION PERMISSIONS
-- ------------------------------------------------------------

revoke all on function public.create_contest_with_relations(text, text, integer, boolean, boolean, timestamptz, jsonb, text[]) from public;
grant execute on function public.create_contest_with_relations(text, text, integer, boolean, boolean, timestamptz, jsonb, text[]) to authenticated;

revoke all on function public.submit_vote_with_rankings(uuid, uuid, text, jsonb) from public;
revoke all on function public.submit_vote_with_rankings(uuid, uuid, text, jsonb) from anon;
revoke all on function public.submit_vote_with_rankings(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.submit_vote_with_rankings(uuid, uuid, text, jsonb) to service_role;

-- ------------------------------------------------------------
-- RLS + POLICIES
-- ------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.contests         enable row level security;
alter table public.contest_options  enable row level security;
alter table public.allowed_voters   enable row level security;
alter table public.votes            enable row level security;
alter table public.vote_rankings    enable row level security;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Admin manages their contests"
  on public.contests for all using (auth.uid() = admin_id);

create policy "Admin reads own contests"
  on public.contests for select using (auth.uid() = admin_id);

create policy "Admin manages options"
  on public.contest_options for all
  using (exists (
    select 1 from public.contests where id = contest_id and admin_id = auth.uid()
  ));

create policy "Admin manages allowed voters"
  on public.allowed_voters for all
  using (exists (
    select 1 from public.contests where id = contest_id and admin_id = auth.uid()
  ));

create policy "Admin reads votes"
  on public.votes for select
  using (exists (
    select 1 from public.contests where id = contest_id and admin_id = auth.uid()
  ));

create policy "Admin reads vote rankings"
  on public.vote_rankings for select
  using (exists (
    select 1 from public.votes v
    join public.contests c on c.id = v.contest_id
    where v.id = vote_id and c.admin_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists idx_contests_admin_id    on public.contests(admin_id);
create index if not exists idx_contests_vote_token  on public.contests(vote_token);
create index if not exists idx_contests_status      on public.contests(status);
create index if not exists idx_options_contest_id   on public.contest_options(contest_id);
create index if not exists idx_allowed_contest_id   on public.allowed_voters(contest_id);
create index if not exists idx_votes_contest_id     on public.votes(contest_id);
create index if not exists idx_rankings_vote_id     on public.vote_rankings(vote_id);

commit;
