# AI Log — Ranked Voting App

## 2026-04-21

### Instructions

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

**IRV details**
- Sequential IRV for multi-winner contests
- All options must be ranked by voters
- Options randomized per-voter (not one fixed random order)
- Rounds displayed showing vote counts, eliminations, and winners
