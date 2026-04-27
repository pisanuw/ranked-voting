# Ranked Voting

A full-stack ranked-choice voting web app. Admins create contests, invite voters, and let the app compute winners using a step-by-step Single Transferable Vote (STV/IRV) algorithm.

**Live app:** https://ranked-voting.netlify.app/login

## Features

### For Admins
- Create contests with a title, description, list of candidates/options, and number of winners
- Set an optional end date for automatic closing, or close manually
- Restrict voting to a whitelist of allowed email addresses
- Toggle per-voter option randomization (each voter sees candidates in a different order)
- Control whether results are visible to all voters or admin-only
- Share a unique voting URL (token-based, not the contest ID) with participants

### For Voters
- Drag-and-drop ballot to rank all candidates in order of preference
- Duplicate-vote prevention (per user account or anonymous browser token)
- Anonymous voting supported when no email whitelist is configured

### Results
- Full STV (Single Transferable Vote) computation with step-by-step round display
- Uses the Droop quota: `floor(total_votes / (winners + 1)) + 1`
- Surplus votes redistributed fractionally when a candidate exceeds the quota
- Tie-breaking by fewest total ranking appearances across all ballots

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| Auth & Database | Supabase (PostgreSQL + Auth) |
| Serverless functions | Netlify Functions (Node.js) |
| Deployment | Netlify |

## Architecture

All sensitive database reads go through Netlify serverless functions using the Supabase service key — the anon key baked into the client bundle cannot enumerate contests or read vote data. Row Level Security (RLS) is enabled on every table.

```
netlify/functions/
  get-contest.js    — fetch a single contest + options by vote token (GET)
  submit-vote.js    — validate and record a ballot (POST)
  get-results.js    — run STV and return round-by-round results (GET)

src/
  pages/
    Login.jsx         — Google OAuth / magic link login
    Dashboard.jsx     — list of contests you administer
    CreateContest.jsx — contest creation form
    AdminContest.jsx  — manage an existing contest (open/close, share link)
    VotingPage.jsx    — drag-and-drop ballot
    ResultsPage.jsx   — STV results with per-round breakdown
  components/
    ballot/DragDropBallot.jsx  — drag-and-drop ranking UI
    results/IRVRounds.jsx      — round-by-round results display
  contexts/AuthContext.jsx     — Supabase auth state
  lib/supabase.js              — Supabase client

supabase/
  schema.sql   — full schema, RLS policies, indexes, triggers
```

## Database Schema

- **profiles** — mirrors `auth.users`, auto-created on signup
- **contests** — one row per contest; includes a random `vote_token` used in all public URLs
- **contest_options** — candidates for a contest
- **allowed_voters** — optional email whitelist; if empty, anyone with the voting URL may vote
- **votes** — one row per voter per contest; supports both authenticated (`voter_id`) and anonymous (`voter_token`) voters
- **vote_rankings** — the actual ranked ballot, one row per candidate per vote

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your Supabase credentials
cp .env.example .env

# 3. Run the schema in your Supabase SQL editor
#    supabase/schema.sql

# 4. Start the dev server
npm run dev
```

## Deploying to Netlify

1. Connect the repository in the Netlify dashboard.
2. Set the following environment variables in **Netlify → Site settings → Environment variables**:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_URL` | Same URL (used server-side by functions) |
| `SUPABASE_ANON_KEY` | Same anon key (used by functions to verify JWTs) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (**never expose client-side**) |

3. Push to your connected branch — Netlify builds and deploys automatically.

## Security Notes

- The `SUPABASE_SERVICE_KEY` is only used server-side inside Netlify Functions and is never shipped to the browser.
- Contest rows are not readable via the anon key. All public contest reads go through `get-contest.js` which looks up a single contest by token — no enumeration is possible.
- Every table has RLS enabled. Admins can only access their own contests, options, and vote data.
