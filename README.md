# Ranked Voting

A full-stack ranked-choice voting web app. Admins create contests, invite voters, and let the app compute winners using a step-by-step Single Transferable Vote (STV/IRV) algorithm.

**Live app:** https://ranked-voting.hintwise.org/login (part of [HintWise](https://studio.hintwise.org/); the old address, https://ranked-voting.netlify.app, answers 301 to the same path there)

## Features

### For Admins
- Create contests with a title, description, list of candidates/options, and number of winners
- Set an optional end date (in your local time) for automatic closing, or close manually
- **Two-phase opening:** open a contest so voters can rank and comment, then separately open *submissions* when everyone is ready to commit their ballots
- Restrict voting to a whitelist of allowed email addresses, **or whole domains** (e.g. `@uw.edu` allows any address on that domain)
- Require a comment on every option, or leave comments optional (the default)
- Toggle per-voter option randomization (each voter sees candidates in a different order)
- Control whether results are visible to all voters or admin-only
- Share a unique voting URL (token-based, not the contest ID) with participants
- See who voted and when (the list does not show how) and download per-option comments, without voter names, as CSV or Markdown

### For Voters
- Drag-and-drop ballot to rank all candidates in order of preference
- Leave an optional (or required) multi-line comment on each option; progress is saved on your device
- Rank and comment while a contest is open even before submissions are unlocked
- Duplicate-vote prevention (per user account or anonymous browser token)
- Anonymous voting supported when no email/domain whitelist is configured

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
| Sign-in | HintWise sign-in (Supabase Auth on the shared HintWise project): Google, or a 6-digit code by email |
| Database | Supabase Postgres on the shared HintWise project, schema `app_ranked_voting`, row level security |
| Serverless functions | Netlify Functions (Node.js) |
| Deployment | Netlify |

## Architecture

RankedVote's data lives in the shared HintWise Supabase project (`https://auth.hintwise.org`), in its own schema `app_ranked_voting` (claude-built-apps `docs/platform.md`). Its earlier Supabase project of its own was deleted on 27 Nov 2026; nothing was carried over, so contests and accounts from before then are gone.

**No service-role key.** The browser and the Netlify functions use only the public anon key and, when someone is signed in, that person's own access token. Row level security is on for every table. What a visitor may do that row level security alone cannot express goes through a few `security definer` database functions, each with one narrow job (`supabase/migrations/0001_app_ranked_voting.sql`):

| Function | Who | What |
|---|---|---|
| `get_contest(code)` | anyone with the voting code | one open or closed contest and its options; never a draft, the admin or a ballot |
| `submit_vote(code, rankings, comments, browser token)` | voters, signed in or anonymous | checks the contest is open, the submission gate, the end date, the voter list (full addresses and `@domain` rules), every option ranked once, required comments and one ballot per voter, then records it |
| `contest_ballots(code, browser token)` | the admin; voters after voting, when results are shown to voters | the ballots as option ids in rank order, in random order, without vote ids |
| `contest_voters(contest)` | the admin | who voted (address, or anonymous) and when, not how |
| `contest_feedback(contest)` | the admin | the comments with their option and each option's average rank, without the ballot they came with |
| `my_voter_contests()` | signed-in people | contests they voted in or whose voter list names their address |

`create_contest_with_relations` (contest, options and voter list in one transaction) runs as the caller, so row level security applies to it like any other write. Ballots and comments are never returned with a voter's identity; an admin who watches the results while voting is under way can still infer how an individual voted (the newest ballot belongs to the newest name under "Who Voted").

```
netlify/functions/
  _lib/supabase.js  — the client that acts as the caller (anon key + their token), error mapping
  get-contest.js    — a contest + options by voting code (GET), via get_contest
  submit-vote.js    — record a ballot (POST, body capped at 256 KiB), via submit_vote
  get-results.js    — run STV on contest_ballots and return round-by-round results (GET)
  get-comments.js   — the admin's comments download as JSON, CSV or Markdown (GET), via contest_feedback
  my-contests.js    — contests the signed-in user can vote in (GET), via my_voter_contests

src/
  pages/
    Login.jsx         — the HintWise sign-in
    Dashboard.jsx     — your contests, contests to vote in, and the HintWise sign-in controls (Sign out, Delete my account)
    CreateContest.jsx — contest creation form
    AdminContest.jsx  — manage an existing contest (open/close, share link, who voted)
    VotingPage.jsx    — drag-and-drop ballot (and the sign-in step for contests with a voter list)
    ResultsPage.jsx   — STV results with per-round breakdown
  components/
    SignIn.jsx                 — mounts the HintWise sign-in controls
    ballot/DragDropBallot.jsx  — drag-and-drop ranking UI
    results/IRVRounds.jsx      — round-by-round results display
  contexts/AuthContext.jsx     — who is signed in
  lib/
    db.js                      — the app's Supabase client
    supabase.ts, auth.ts, account.ts, signin-styles.ts, google-g-light.svg
                               — the HintWise template's sign-in modules, copied unchanged
                                 (claude-built-apps platform/templates/app; tests in test/)

supabase/
  migrations/0001_app_ranked_voting.sql — schema, tables, row level security, functions, grants
  __tests__/                            — the migration run against real Postgres (PGlite, in-process)
```

## Sign-in

The HintWise sign-in, as in every HintWise app: "Sign in with Google", or "Email code", which emails a 6-digit code (with a link below it while HintWise apps move to the code) through the platform's `sign-in-link` function. The code works for 10 minutes, once, in the browser that asked for it. Supabase's own magic link (`signInWithOtp`) is not used: the shared project's email hook refuses it for hintwise.org pages. One account works across HintWise apps; "Sign out" here signs out of RankedVote only, and "Delete my account" (in the panel under your address on the dashboard) deletes the account and your data in every HintWise app.

Sign-in returns to the page it started on, and only to `https://*.hintwise.org`: not to `localhost`, the netlify.app address or deploy previews.

## Database Schema

All in schema `app_ranked_voting` (`supabase/migrations/0001_app_ranked_voting.sql`):

- **contests** — one row per contest, owned by `admin_id`; a random 32-hex `vote_token` is used in all public URLs, plus flags for `submissions_open` (submission gate) and `comments_required`
- **contest_options** — candidates for a contest; changeable only while the contest is a draft
- **allowed_voters** — optional voter list; each row is a full email or a domain rule beginning with `@` (e.g. `@uw.edu`). If empty, anyone with the voting URL may vote; if not, voters must sign in
- **votes** — one row per voter per contest; a signed-in voter (`voter_id`) or an anonymous browser (`voter_token`)
- **vote_rankings** — the ranked ballot, one row per option per vote
- **vote_comments** — optional per-option feedback (anonymous to admins), up to 2000 characters each

What is stored about a person: their sign-in (address) in the shared HintWise account; the contests they create; their ballots and comments, linked to their account only to stop a second ballot. Deleting an account deletes the contests it created (with their ballots) and the person's own ballots and comments in other people's contests, so those results count one ballot fewer; signing in again with the same address, the person may vote once more while a contest is open. Data is in Supabase, US East.

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template (the shared project's public URL and anon key are in it)
cp .env.example .env

# 3. Start the dev server
npm run dev

# Tests (no network: fakes, and the migration on in-process Postgres)
npm test
```

Sign-in does not return to `localhost` (above), so a local build can show contests and ballots but not sign in. Never run the migration against the shared project by hand: it is applied by the Supabase admin workflow in claude-built-apps (below).

## Deploying to Netlify

1. Netlify builds on every push to `main` (`netlify.toml`). The two public Supabase values are in `netlify.toml` `[build.environment]`, and the functions carry the same two in `netlify/functions/_lib/supabase.js`; the site needs no Supabase variable of its own. A Netlify build stops if the browser values are not the shared project's URL and anon key (`public-env.js`).
2. The site's old variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`) name the deleted project and are no longer read; delete them in Netlify, Site configuration, Environment variables.
3. The schema is applied from claude-built-apps, where `ranked-voting/supabase/migrations/` holds a byte-for-byte copy of this repository's migrations: Supabase admin `migrate ranked-voting`, `expose-schema app_ranked_voting`, then `check-schema app_ranked_voting` (claude-built-apps `docs/new-app-guide.md`, option B). A migration that has been applied never changes; changes go in a new `000N_<name>.sql`, copied there too.
4. Email sign-in and "Delete my account" need `ranked-voting` in the platform's `EXTERNAL_APP_LABELS` (claude-built-apps `platform/src/signin/validate.ts`), with `sign-in-link` and `delete-account` redeployed.

## HintWise

RankedVote is a HintWise app in its own repository (claude-built-apps `docs/new-app-guide.md`, option B):

- **Address:** https://ranked-voting.hintwise.org. `netlify.toml` sends `https://` and `http://ranked-voting.netlify.app/*` there with a 301, path and query kept; the rules match only the netlify.app host, so the new host never loops. `src/__tests__/netlify-redirects.test.js` pins them.
- **Footer:** the HintWise "built by" footer is `footerHtml('ranked-voting')` from claude-built-apps `scripts/site-footer.mjs`, embedded byte for byte in `index.html` just before `</body>`, outside `#root` (a declarative shadow root renders only when the browser parses it). `src/__tests__/site-footer.test.js` pins its sha256; when the footer changes, copy the new markup in and update the hash.
- **Analytics:** `public/hw-events.js` is the platform's cookieless analytics script, copied unchanged (`src/__tests__/analytics.test.js` pins its sha256), with its tag in `<head>`. The tag's `data-mask="/vote/ /results/ /admin/"` sends a contest's address as `/vote/:id`, never its voting code. It sends the pages viewed, time on screen, the referring site, outbound links and script errors; never a ballot, a comment or an email address. No cookie, nothing kept in the browser, and nothing sent under Do Not Track or Global Privacy Control. Visitors read the same in the privacy note (`src/components/PrivacyNote.jsx`) on the sign-in page and the ballot.
- **Favicon:** the HintWise icon (an inline SVG in `index.html`).
- **Sign-in and data:** the shared HintWise Supabase project, schema `app_ranked_voting` (sections above). `src/lib/supabase.ts`, `auth.ts`, `account.ts`, `signin-styles.ts` and `google-g-light.svg`, with `test/*.test.ts`, are the template's files (claude-built-apps `platform/templates/app/`) with only the slug filled in; copy the new versions when the template changes.

## Security Notes

- No service-role key exists anywhere in this app: not in the browser, the functions or the site's settings.
- Contests are not readable with the anon key. A contest is reached only through `get_contest` with its exact voting code, so contests cannot be enumerated, and drafts are never shown.
- Every table has row level security. Admins reach only their own contests, options and voter lists; voters only their own vote row; nobody reads rankings or comments directly.
- The admin sees who voted and when. Ballots and comments come out only without vote ids and in random order, so they are never returned with a voter's identity; an admin who watches the results while voting is under way can still infer how an individual voted.
