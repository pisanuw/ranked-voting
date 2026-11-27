# Ranked Voting App

## Purpose
A web app for running ranked-choice (STV/IRV) elections. Admins create contests with options, share a voting URL, and view step-by-step results with surplus redistribution.

## Architecture
- **Frontend:** React + Vite, Tailwind CSS, @dnd-kit for drag-and-drop ballots
- **Backend:** the shared HintWise Supabase project (https://auth.hintwise.org), schema `app_ranked_voting` with row level security; Netlify Functions (serverless, CommonJS) acting as the caller, no service-role key
- **Auth:** the HintWise sign-in (template's mountSignIn): Google, or a 6-digit emailed code through the platform's sign-in-link function; never signInWithOtp
- **Routing:** React Router v6, SPA with Netlify redirects

## Key Design Decisions
- Moved to the shared HintWise project on 27 Nov 2026 (owner, "rv to shared", "3 now"); the old project (iatqephvmykbkatpbwll) was deleted, nothing carried over
- Voter-facing reads and writes go through security definer functions (get_contest, submit_vote, contest_ballots; anon may execute only these), called by the Netlify functions with the anon key and the caller's token; no enumeration, no service-role key
- Admin reads and writes use the Supabase client with RLS (their token); options change only while a contest is a draft; who voted comes from contest_voters, comments from contest_feedback
- Nobody reads a ballot next to a voter's identity (rankings and comments only through functions, without vote ids, random order)
- No profiles table: voter addresses are read from auth.users inside contest_voters and submit_vote
- Account deletion: an admin's contests go with the account; a voter's ballots stay in the count with voter_id set to null
- Voting is URL-gated by default; login only required when a voter whitelist exists
- Whitelist (`allowed_voters`) entries are either a full email or a domain rule beginning with `@` (e.g. `@uw.edu`); matched in the database function submit_vote (the part after the last @)
- STV algorithm (Droop quota, fractional surplus redistribution) runs server-side in get-results function, on contest_ballots
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
- Netlify site `ranked-voting` (frontend + functions); primary address https://ranked-voting.hintwise.org since the HintWise move (owner, 26 Nov 2026). `netlify.toml` answers https:// and http://ranked-voting.netlify.app/* with a 301 to the same path on the new address; the rules are first and match only the netlify.app host
- HintWise footer embedded in `index.html` (footerHtml('ranked-voting'), sha256 pinned in src/__tests__/site-footer.test.js); HintWise analytics `public/hw-events.js` (unchanged platform copy, sha256 pinned in src/__tests__/analytics.test.js), tag in `<head>` with data-mask for /vote/, /results/, /admin/; privacy note in src/components/PrivacyNote.jsx on Login and VotingPage
- Sign-in returns to the page it started on; the shared project's allow list (https://*.hintwise.org/**) covers it. Email sign-in and Delete my account need `ranked-voting` in claude-built-apps EXTERNAL_APP_LABELS
- Public Supabase values in netlify.toml [build.environment] and netlify/functions/_lib/supabase.js; public-env.js stops a Netlify build with any other project or a non-anon key
- Schema changes: a new supabase/migrations/000N_*.sql, copied byte for byte into claude-built-apps ranked-voting/supabase/migrations/ and applied there by the Supabase admin workflow (migrate, expose-schema, check-schema), with the owner's yes; never by hand

## Key Files
- `supabase/migrations/0001_app_ranked_voting.sql` - schema, RLS policies, functions, grants; `supabase/__tests__/` runs it on PGlite
- `netlify/functions/` - Server-side functions (get-contest, submit-vote, get-results, get-comments, my-contests), `_lib/supabase.js` the shared client
- `src/lib/{supabase,auth,account,signin-styles}.ts` - the HintWise template's sign-in modules, unchanged; `src/components/SignIn.jsx` mounts them
- `src/pages/VotingPage.jsx` - Ballot UI with localStorage persistence
- `src/pages/AdminContest.jsx` - Contest management, voter list, comment downloads
- `src/pages/Dashboard.jsx` - Admin contests + voter contests sections
- `src/components/ballot/DragDropBallot.jsx` - Drag-and-drop with per-option comment inputs
