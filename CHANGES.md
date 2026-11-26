# Changes

2026-05-19 [code] Fix ballot re-sorting: shuffle once per user, persist order to localStorage, survive tab switches and refreshes
2026-05-19 [code] Persist user's drag-and-drop ranked order to localStorage on every reorder, restore on page load
2026-05-19 [scope] Add per-option voter comments: vote_comments table, submit-vote accepts comments, ballot UI has text inputs
2026-05-19 [code] Admin can see who voted (email + timestamp) but not how, via voter list on AdminContest page
2026-05-19 [code] Admin can download anonymous comments grouped by option as CSV or Markdown (new get-comments function)
2026-05-19 [code] Post-login redirect: VotingPage login now redirects back to /vote/:token instead of /dashboard
2026-05-19 [code] Dashboard shows "Contests to Vote In" section via new my-contests Netlify function
2026-05-19 [doc] Created BRIEFING.md with architecture, decisions, and key files

2026-06-04 [code] Fix end_date timezone: convert datetime-local (local wall-clock) to UTC via toISOString on save in CreateContest and AdminContest; was stored as UTC and shifting on display

2026-06-06 [scope] Submission gate: new contests.submissions_open flag — voters can rank+comment while open but cannot submit until owner opens submissions (enforced in submit-vote)
2026-06-06 [scope] Mandatory comments option: new contests.comments_required flag (default off) requires a comment on every option before submit; enforced client + server
2026-06-06 [code] Comments now multi-line textarea, larger text, limit raised 500->2000 chars; migration add-submission-gate-and-required-comments.sql (run in Supabase SQL editor)

2026-06-06 [scope] Domain whitelist: allowed_voters entries can be a whole domain (@uw.edu) as well as a full email; matched in submit-vote, no schema migration needed
2026-06-06 [code] Extracted isVoterAllowed() helper in submit-vote.js (exported for unit tests) handling email + @domain matching
2026-06-06 [note] Verified migration applied + features against live Supabase: submission gate, required comments, 2000-char comments (live function tests), domain matcher (10/10 unit), require_login trigger; README updated

2026-06-06 [code] Security hardening (Supabase advisors): pinned search_path=public on handle_new_user + sync trigger fns, revoked their RPC EXECUTE, revoked anon EXECUTE on create_contest_with_relations; supabase/harden-trigger-functions.sql
2026-06-06 [note] Advisor "RLS disabled on public.whitelist" was stale: no such table (renamed to allowed_voters long ago); all 7 live tables have RLS enabled

2026-11-26 [code] HintWise move (owner, 26 Nov: "rv move yes"): primary address https://ranked-voting.hintwise.org; netlify.toml 301s https:// and http://ranked-voting.netlify.app/* there, path kept, first rule, no rule on the new host
2026-11-26 [code] HintWise footer embedded in index.html (footerHtml('ranked-voting'), sha256 test); analytics public/hw-events.js (platform copy, sha256 test), tag in head with data-mask /vote/ /results/ /admin/; privacy note on Login and VotingPage; HintWise favicon in place of the missing /ballot.svg
2026-11-26 [doc] README, BRIEFING and .env.example: the new address, and the Supabase Site URL and Redirect URLs it needs
2026-11-26 [note] The Supabase project the live bundle names does not resolve (DNS NXDOMAIN, checked 26 Nov): sign-in and contest reads fail on the live site until the owner restores that project or the app moves to the shared HintWise project. Email sign-in stays Supabase's own magic link here: the platform's emailed code needs auth and data on the same project, so it moves with the data (a separate decision)
