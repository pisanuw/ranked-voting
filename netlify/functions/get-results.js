const { createClient } = require('@supabase/supabase-js')

// ── STV (Single Transferable Vote) Algorithm ─────────────────────────────────
// Implements proper ranked-choice voting with:
//   - Droop quota: floor(total / (winners+1)) + 1
//   - Excess vote redistribution (fractional transfer)
//   - Tie-breaking by fewest overall ranking appearances
//
// votes:      [{ vote_rankings: [{ option_id, rank }] }]
// options:    [{ id, title, description }]
// maxWinners: number
function runIRV(votes, options, maxWinners) {
  const totalBallots = votes.length
  // Droop quota — minimum votes guaranteed to win a seat
  const quota = Math.floor(totalBallots / (maxWinners + 1)) + 1

  // Ballots carry fractional weights for surplus redistribution
  const ballots = votes.map(vote => ({
    rankings: [...vote.vote_rankings]
      .sort((a, b) => a.rank - b.rank)
      .map(r => r.option_id),
    weight: 1.0,
  }))

  let remaining = new Set(options.map(o => o.id))
  const winners = []
  const rounds  = []

  // Returns the highest-ranked still-remaining option for a ballot
  function firstChoice(ballot) {
    return ballot.rankings.find(id => remaining.has(id))
  }

  while (winners.length < maxWinners && remaining.size > 0) {
    // Count weighted first-choice votes
    const counts = {}
    for (const id of remaining) counts[id] = 0
    for (const ballot of ballots) {
      const fc = firstChoice(ballot)
      if (fc !== undefined) counts[fc] += ballot.weight
    }

    const seatsRemaining = maxWinners - winners.length

    // If the remaining candidates exactly fill the remaining seats,
    // they are all elected without further eliminations.
    if (remaining.size <= seatsRemaining) {
      const orderedRemaining = [...remaining].sort((a, b) => counts[b] - counts[a])
      for (const candidateId of orderedRemaining) {
        rounds.push({
          counts,
          quota,
          winner: candidateId,
          winner_surplus: null,
          eliminated: null,
          auto_elected: true,
        })
        winners.push(candidateId)
      }
      break
    }

    // Find a winner (any candidate meeting or exceeding quota)
    const winnerId = [...remaining].find(id => counts[id] >= quota) ?? null

    if (winnerId) {
      const surplus      = counts[winnerId] - quota
      const transferRatio = counts[winnerId] > 0 ? surplus / counts[winnerId] : 0

      // Redistribute excess votes at reduced weight to next ranked choice
      for (const ballot of ballots) {
        if (firstChoice(ballot) === winnerId) {
          ballot.weight *= transferRatio
        }
      }

      rounds.push({ counts, quota, winner: winnerId, winner_surplus: Math.round(surplus * 100) / 100, eliminated: null })
      winners.push(winnerId)
      remaining.delete(winnerId)

    } else {
      // Eliminate the lowest vote-getter
      const minCount = Math.min(...[...remaining].map(id => counts[id]))
      const tied = [...remaining].filter(id => Math.abs(counts[id] - minCount) < 0.001)

      let loserId
      if (tied.length === 1) {
        loserId = tied[0]
      } else {
        // Tie-break: eliminate the option with the fewest total ranking appearances
        const appearances = {}
        for (const id of tied) {
          appearances[id] = ballots.filter(b => b.rankings.includes(id)).length
        }
        const minAppearances = Math.min(...tied.map(id => appearances[id]))
        loserId = tied.find(id => appearances[id] === minAppearances) ?? tied[0]
      }

      rounds.push({ counts, quota, winner: null, winner_surplus: null, eliminated: loserId })
      remaining.delete(loserId)
    }
  }

  return { winners, rounds, quota }
}

// ─────────────────────────────────────────────────────────────────────────────

const supabaseAdmin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

async function getAuthenticatedUser(authToken) {
  if (!authToken) return null

  const authClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${authToken}` } } }
  )

  const { data: { user } } = await authClient.auth.getUser()
  return user ?? null
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Voter-Token',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const token = event.queryStringParameters?.token
  const authHeader = event.headers.authorization ?? event.headers.Authorization ?? ''
  const authToken = authHeader.replace('Bearer ', '').trim() || null
  const anonymousVoterToken = event.headers['x-voter-token'] ?? event.headers['X-Voter-Token'] ?? null

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
  // Admin-only results: only the admin may view.
  // Voter-visible results: admin may always view; everyone else must prove they voted.
  const user = await getAuthenticatedUser(authToken)
  const isAdmin = user?.id === contest.admin_id

  if (!contest.results_visible_to_voters && !isAdmin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Results are restricted to the contest admin' }) }
  }

  if (contest.results_visible_to_voters && !isAdmin) {
    let voterQuery = null

    if (user?.id) {
      voterQuery = db
        .from('votes')
        .select('id')
        .eq('contest_id', contest.id)
        .eq('voter_id', user.id)
        .maybeSingle()
    } else if (anonymousVoterToken) {
      voterQuery = db
        .from('votes')
        .select('id')
        .eq('contest_id', contest.id)
        .eq('voter_token', anonymousVoterToken)
        .maybeSingle()
    }

    if (!voterQuery) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Results are only available to recorded voters or the contest admin' }) }
    }

    const { data: recordedVote } = await voterQuery
    if (!recordedVote) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Results are only available to recorded voters or the contest admin' }) }
    }
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

  // ── Run STV ───────────────────────────────────────────────────────────
  const { winners, rounds, quota } = runIRV(votes, options, contest.max_winners)

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      contest: { title: contest.title, max_winners: contest.max_winners },
      options,
      total_votes,
      quota,
      rounds,
      winners,
    }),
  }
}
