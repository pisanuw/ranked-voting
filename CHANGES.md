# Changes

2026-05-19 [code] Fix ballot re-sorting: shuffle once per user, persist order to localStorage, survive tab switches and refreshes
2026-05-19 [code] Persist user's drag-and-drop ranked order to localStorage on every reorder, restore on page load
2026-05-19 [scope] Add per-option voter comments: vote_comments table, submit-vote accepts comments, ballot UI has text inputs
2026-05-19 [code] Admin can see who voted (email + timestamp) but not how, via voter list on AdminContest page
2026-05-19 [code] Admin can download anonymous comments grouped by option as CSV or Markdown (new get-comments function)
2026-05-19 [code] Post-login redirect: VotingPage login now redirects back to /vote/:token instead of /dashboard
2026-05-19 [code] Dashboard shows "Contests to Vote In" section via new my-contests Netlify function
2026-05-19 [doc] Created BRIEFING.md with architecture, decisions, and key files
