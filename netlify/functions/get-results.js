const { createClient } = require('@supabase/supabase-js')

// ── IRV Algorithm ─────────────────────────────────────────────────────────────
// Sequential IRV for multi-winner contests.
// votes: [{ vote_rankings: [{ option_id, rank }] }]
// options: [{ id, title, description }]
// maxWinners: number
function runIRV(votes, options, maxWinners) {
  // Convert votes to ballots: array of option_id strings sorted by rank (asc)
  const ballots = votes.map(vote =>
    [...vote.vote_rankings]
      .sort((a, b) => a.rank - b.rank)
      .map(r => r.option_id)
  )

  let remaining = options.map(o => ({ id: o.id, title: o.title }))
  const winners = []
  const rounds  = []

  while (winners.length < maxWinners && remaining.length > 0) {
    // Last candidate remaining wins without a round
    if (remaining.length === 1) {
      const last = remaining[0]
      rounds.push({
        counts:     { [last.id]: ballots.length },
        total:      ballots.length,
        winner:     last.id,
        eliminated: null,
      })
      winners.push(last.id)
      remaining = []
      break
    }

    // Count first-choice votes among remaining options
    const remainingIds = new Set(remaining.map(o => o.id))
    const counts = {}
    for (const o of remaining) counts[o.id] = 0

    for (const ballot of ballots) {
      const firstChoice = ballot.find(id => remainingIds.has(id))
      if (firstChoice !== undefined) counts[firstChoice]++
    }

    const total     = Object.values(counts).reduce((s, n) => s + n, 0)
    const threshold = total / 2  // strictly more than 50% wins

    // Find winner (majority)
    const winnerId = Object.entries(counts).find(([, c]) => c > threshold)?.[0] ?? null

    if (winnerId) {
      rounds.push({ counts, total, winner: winnerId, eliminated: null })
      winners.push(winnerId)
      remaining = remaining.filter(o => o.id !== winnerId)
    } else {
      // Eliminate lowest vote-getter (ties: eliminate the one earliest in remaining order)
      const minCount = Math.min(...Object.values(counts))
      const loser    = remaining.find(o => counts[o.id] === minCount)
      rounds.push({ counts, total, winner: null, eliminated: loser.id })
      remaining = remaining.filter(o => o.id !== loser.id)
    }
  }

  return { winners, rounds }
}

// ─────────────────────────────────────────────────────────────────────────────

const supabaseAdmin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const token     = event.queryStringParameters?.token
  const authHeader = event.headers['authorization'] ?? ''
  const authToken  = authHeader.replace('Bearer ', '').trim() || null

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token parameter' }) }
  }

  const db = supabaseAdmin()

  // ── Load contest ──────────────────────────────────────────────────────
  const { data: contest, error: cErr } = await db
    .from('contests')
    .select('*, contest_options(*)')
    .eq('vote_token', token)
    .single()

  if (cErr || !contest) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
  }

  // ── Authorization ─────────────────────────────────────────────────────
  let isAdmin  = false
  let isVoter  = false

  if (authToken) {
    const authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${authToken}` } } }
    )
    const { data: { user } } = await authClient.auth.getUser()

    if (user) {
      isAdmin = contest.admin_id === user.id

      if (!isAdmin && contest.results_visible_to_voters) {
        const { data: vote } = await db
          .from('votes')
          .select('id')
          .eq('contest_id', contest.id)
          .eq('voter_id', user.id)
          .maybeSingle()
        isVoter = !!vote
      }
    }
  }

  if (!isAdmin && !isVoter) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden: you must have voted or be the admin to view results' }) }
  }

  // ── Fetch votes ───────────────────────────────────────────────────────
  const { data: votes, error: vErr } = await db
    .from('votes')
    .select('id, vote_rankings(option_id, rank)')
    .eq('contest_id', contest.id)

  if (vErr) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch votes' }) }
  }

  const total_votes = votes?.length ?? 0
  const options     = (contest.contest_options ?? []).sort((a, b) => a.order_index - b.order_index)

  if (total_votes === 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        contest:     { title: contest.title, max_winners: contest.max_winners },
        options,
        total_votes: 0,
        rounds:      [],
        winners:     [],
      }),
    }
  }

  // ── Run IRV ───────────────────────────────────────────────────────────
  const { winners, rounds } = runIRV(votes, options, contest.max_winners)

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      contest: { title: contest.title, max_winners: contest.max_winners },
      options,
      total_votes,
      rounds,
      winners,
    }),
  }
}
