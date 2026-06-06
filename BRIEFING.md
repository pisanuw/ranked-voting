# Ranked Voting App

## Purpose
A web app for running ranked-choice (STV/IRV) elections. Admins create contests with options, share a voting URL, and view step-by-step results with surplus redistribution.

## Architecture
- **Frontend:** React + Vite, Tailwind CSS, @dnd-kit for drag-and-drop ballots
- **Backend:** Supabase (PostgreSQL + Auth), Netlify Functions (serverless, CommonJS)
- **Auth:** Google OAuth + magic links via Supabase Auth
- **Routing:** React Router v6, SPA with Netlify redirects

## Key Design Decisions
- Voter-facing DB reads go through Netlify Functions (service key) to prevent anon key enumeration
- Admin reads use Supabase client with RLS (auth JWT)
- Voting is URL-gated by default; login only required when a voter whitelist exists
- Whitelist (`allowed_voters`) entries are either a full email or a domain rule beginning with `@` (e.g. `@uw.edu`); matching logic is `isVoterAllowed()` in submit-vote.js
- STV algorithm (Droop quota, fractional surplus redistribution) runs server-side in get-results function
- Ballot option order is shuffled once per user and persisted to localStorage (not re-shuffled on re-renders)
- Voter comments are stored per-option, downloadable by admin as CSV/Markdown (anonymous, no voter identity)
- Admins can see who voted (email + timestamp) but not how they voted
- Post-login redirect returns user to the contest voting page they came from
- Dashboard shows both admin contests and contests the user can vote in
- Submission gate: `contests.submissions_open` (default false) lets voters rank + comment while a contest is open but blocks the actual submit until the owner opens submissions (toggle on AdminContest, enforced in submit-vote)
- Mandatory comments: `contests.comments_required` (default false) requires a non-empty comment on every option before submit (enforced client-side and in submit-vote)
- Per-option comments are multi-line, up to 2000 chars

## Non-Goals
- No real-time/WebSocket updates
- No public contest discovery (all access is URL-gated or whitelist-gated)
- No editing votes after submission

## Deployment
- Netlify: ranked-voting.netlify.app (frontend + functions)
- Supabase: PostgreSQL + Auth (project ref in env vars)
- Schema changes require running SQL in Supabase SQL Editor manually

## Key Files
- `supabase/schema.sql` - Full DB schema, RPC functions, RLS policies
- `netlify/functions/` - Server-side functions (get-contest, submit-vote, get-results, get-comments, my-contests)
- `src/pages/VotingPage.jsx` - Ballot UI with localStorage persistence
- `src/pages/AdminContest.jsx` - Contest management, voter list, comment downloads
- `src/pages/Dashboard.jsx` - Admin contests + voter contests sections
- `src/components/ballot/DragDropBallot.jsx` - Drag-and-drop with per-option comment inputs
