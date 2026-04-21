# AI Log — Ranked Voting App

## 2026-04-21T00:00 — Initial build instructions

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

## 2026-04-21T01:00 — Deploy to Netlify and Supabase

- Install necessary programs
- Push code to GitHub repo: https://github.com/pisanuw/ranked-voting
- Deploy to Netlify: ranked-voting.netlify.app
- Set up Supabase database (project: iatqephvmykbkatpbwll)
- Run schema SQL against Supabase
- Configure Netlify environment variables

---

## 2026-04-21T02:00 — Fix Google Auth error

Google Auth giving error: `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`

Instruction: fix Google OAuth — need to enable provider in Supabase dashboard and create Google Cloud Console credentials.

---

## 2026-04-21T03:00 — Fix "Database error saving new user"

Magic link login giving: "Database error saving new user"

Root cause: `handle_new_user` trigger failing when `new.email` is NULL during OTP flow, rolling back user creation.

Fix: add `coalesce(new.email, new.raw_user_meta_data->>'email', '')` and `EXCEPTION WHEN OTHERS` handler to trigger.

---

## 2026-04-21T04:00 — Rework voting access model

**New requirements:**
- Any user with the correct participation URL should be able to vote (no login required by default)
- Contest should not be visible to users without the participation URL
- Voter Email Whitelist = list of users who must log in with their email to vote; login only required when whitelist is set
- Remove `require_login` toggle — login is now automatic based on whitelist presence

**Also reported:** "insert or update on table 'contests' violates foreign key constraint 'contests_admin_id_fkey'"

---

## 2026-04-21T05:00 — Fix FK constraint error on contest creation

Error: `insert or update on table "contests" violates foreign key constraint "contests_admin_id_fkey"`

Root cause: `profiles` row missing for user (signup trigger failed before fix). Added:
- Self-healing `profiles` upsert before contest insert in `CreateContest.jsx`
- INSERT RLS policy on `profiles` so authenticated users can create their own row
- SQL backfill for existing users without a profile row

---

## 2026-04-21T06:00 — Fix vote submission stuck on "Submitting"

Vote page at `/vote/feac19d5ff6a6a284673d116e7e4c175eeea` stuck on "Submitting" forever.

Root cause: `/api/*` redirect in `netlify.toml` was listed AFTER the `/*` SPA catch-all, so all `/api/` requests returned the React app HTML instead of reaching Netlify Functions.

Fix: move `/api/*` redirect before `/*` in `netlify.toml`.

---

## 2026-04-21T07:00 — Replace IRV with correct STV algorithm

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
