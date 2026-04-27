-- ============================================================
-- Ranked Voting — Hotfix
-- Fix FK failures when authenticated voters are missing profiles rows.
-- Safe to run multiple times.
-- ============================================================

begin;

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

commit;
