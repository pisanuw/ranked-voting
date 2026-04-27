# Reminder: Record all user instructions verbatim, EXACTLY as typed by user, in this file before doing any other work or writing any response. Each entry must include a timestamp with `date "+%Y-%m-%dT%H:%M"` and start with "User to Github CoPilot version XXX:". Do not write any private API keys or secrets; use REDACTED.

# AI Log — Ranked Voting App

## 2026-04-21T14:46 — Security fix: move VotingPage contest fetch through Netlify function

Move VotingPage's contest fetch through a Netlify function (using service key server-side) and tighten RLS so the anon key cannot read contest rows at all. This prevents enumeration of all open contests and their vote_tokens via the public anon key.

---

## 2026-04-21T14:44 — Security question: anon key access to contest tables

User asked: "Can anybody use the VITE_SUPABASE_ANON_KEY to read the contest tables?"

Answer: Yes — the anon key is baked into the public JS bundle and anyone can extract it. With the current RLS policies, anyone with the key can enumerate all open contests including their vote_tokens, defeating the URL-as-gate security model. Votes, voter emails, and profiles are protected by RLS. Fix proposed: move VotingPage contest fetch through a Netlify function and tighten RLS to block anon key DB access entirely.

---

## 2026-04-21T14:44 — AI-log compliance check

User asked: "Did you update AI-log.md with my last query?" — confirmed I had not logged the previous entry before responding. Corrected retroactively.

---

## 2026-04-21T14:41 — Logging policy update

Record all user instructions in AI-log.md in the project directory. Each entry must include a timestamp with hour and minute. Update this file BEFORE starting any work after receiving an instruction. Do not write any private API keys or secrets to this file — indicate removed information with REDACTED.

---

## 2026-04-21T (session start) — Initial build instructions

Build a ranked voting web app with the following requirements:

**Auth**
- Login via Google OAuth or magic link (Supabase Auth)
- Separate URLs for administering and participating in a contest

**Contest Administration**
- Admin provides multiple options/candidates
- Set number of winners
- Close contest manually or via end date
- Require login to vote (or allow anonymous)
- Results visible to all voters or admin-only
- Specify allowed voter emails (blocks non-listed emails)
- Toggle option randomization per voter

**Voting**
- Drag-and-drop ballot (rank all options)
- Options randomized per voter if admin enables it

**Results**
- Step-by-step IRV (Instant Runoff Voting) simulation showing rounds until winner(s)
- Contests never visible to unauthenticated public (always require login to view results)

**Deployment**
- Netlify (frontend + serverless functions)
- Supabase (PostgreSQL + Auth)

**Tech Stack chosen**
- React + Vite
- Tailwind CSS
- Supabase (Auth + DB)
- @dnd-kit/core + @dnd-kit/sortable (drag-and-drop ballot)
- Netlify Functions (vote submission, IRV results computation)
- React Router v6

**IRV clarifications (follow-up answers)**
- Implement IRV (confirmed)
- Block non-listed emails (confirmed)
- Contests not visible to public (confirmed)
- Per-voter randomization (confirmed)
- All options must be ranked by voters (confirmed)

---

## 2026-04-21T (session) — Deploy to Netlify and Supabase

- Install necessary programs
- Push code to GitHub repo: https://github.com/pisanuw/ranked-voting
- Deploy to Netlify: ranked-voting.netlify.app
- Set up Supabase database (project ref: REDACTED)
- Supabase DB password: REDACTED
- Supabase publishable key: REDACTED
- Supabase service role key: REDACTED
- Run schema SQL against Supabase
- Configure Netlify environment variables

---

## 2026-04-21T (session) — Fix Google Auth error

Google Auth giving error: `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`

Instruction: fix Google OAuth — need to enable provider in Supabase dashboard and create Google Cloud Console credentials.

---

## 2026-04-21T (session) — Fix "Database error saving new user"

Magic link login giving: "Database error saving new user"

Root cause: `handle_new_user` trigger failing when `new.email` is NULL during OTP flow, rolling back user creation.

Fix: add `coalesce(new.email, new.raw_user_meta_data->>'email', '')` and `EXCEPTION WHEN OTHERS` handler to trigger.

---

## 2026-04-21T (session) — Rework voting access model

**New requirements:**
- Any user with the correct participation URL should be able to vote (no login required by default)
- Contest should not be visible to users without the participation URL
- Voter Email Whitelist = list of users who must log in with their email to vote; login only required when whitelist is set
- Remove `require_login` toggle — login is now automatic based on whitelist presence

**Also reported:** "insert or update on table 'contests' violates foreign key constraint 'contests_admin_id_fkey'"

---

## 2026-04-21T (session) — Fix FK constraint error on contest creation

Error: `insert or update on table "contests" violates foreign key constraint "contests_admin_id_fkey"`

Root cause: `profiles` row missing for user (signup trigger failed before fix). Added:
- Self-healing `profiles` upsert before contest insert in `CreateContest.jsx`
- INSERT RLS policy on `profiles` so authenticated users can create their own row
- SQL backfill for existing users without a profile row

---

## 2026-04-21T (session) — Fix vote submission stuck on "Submitting"

Vote page at `/vote/feac19d5ff6a6a284673d116e7e4c175eeea` stuck on "Submitting" forever.

Root cause: `/api/*` redirect in `netlify.toml` was listed AFTER the `/*` SPA catch-all, so all `/api/` requests returned the React app HTML instead of reaching Netlify Functions.

Fix: move `/api/*` redirect before `/*` in `netlify.toml`.

---

## 2026-04-21T (session) — Replace IRV with correct STV algorithm

Instruction: review the rounds/voting algorithm against the rankedvote.co description and fix discrepancies.

**Identified problems with old implementation:**
- Used 50% threshold instead of Droop quota (`floor(total / (winners+1)) + 1`)
- Did not redistribute excess votes from winners (surplus transfer)
- Ran separate IRV passes per winner instead of one continuous round sequence
- Tie-breaking was arbitrary (first in list) instead of fewest overall ranking appearances

**Implemented STV (Single Transferable Vote):**
- Droop quota for threshold
- Fractional ballot weights for surplus redistribution
- Single continuous round sequence for all winners
- Tie-breaking by fewest total ballot appearances
- Updated `IRVRounds.jsx` visualization: quota line, surplus overlay, fractional vote counts

---

User to Github CoPilot version XXX: 2026-04-26T20:17: which version of node.js does this repo use

---

User to Github CoPilot version XXX: 2026-04-26T20:26: Examine the code and make a prioritized list of things to fix, update, refactor, etc to follow good software engineering principles.

---

User to Github CoPilot version XXX: 2026-04-26T20:31: OK, go ahead with tackling 1, 2, and 4

---

User to Github CoPilot version XXX: 2026-04-26T20:35: How do I Apply the updated SQL in schema.sql:107-249 to my Supabase

---

User to Github CoPilot version XXX: 2026-04-26T20:40: OK, proceed with the rest of the fixes

---

User to Github CoPilot version XXX: 2026-04-26T20:43: Which lines should be run in Supabase sqp editor

---

User to Github CoPilot version XXX: 2026-04-26T20:46: Getting lots of errors from SQL editor. Give me an SQL file that will delete everything and create things from scratch

---

User to Github CoPilot version XXX: 2026-04-26T20:48: Done. Fix the rest

---

User to Github CoPilot version XXX: 2026-04-26T20:58: generate it

---

User to Github CoPilot version XXX: 2026-04-26T20:59: ok, what is next?

---

User to Github CoPilot version XXX: 2026-04-26T21:00: generate it

---

User to Github CoPilot version XXX: 2026-04-26T21:03: After "pm run dev" I get a blank page on "http://localhost:5173/"
