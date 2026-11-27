// get-results.js
// The step-by-step STV count for a contest (GET ?token=), for its admin always, and for
// voters after they voted when the admin shows results to voters. The ballots come from
// app_ranked_voting.contest_ballots, called as the caller (their access token, or anonymous
// with the browser's voter token in X-Voter-Token): a security definer function that checks
// who may see them and hands them over without vote ids, in random order. No service-role key.
const { appClient, bearer, messageFor, statusFor } = require('./_lib/supabase')

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

// Exported for unit testing (pure function, no I/O).
exports.runIRV = runIRV

// ─────────────────────────────────────────────────────────────────────────────

const VOTE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/
const MAX_VOTER_TOKEN_CHARS = 100

/** contest_ballots' ballots (option ids in rank order) in the shape runIRV reads. */
function toVotes(ballots) {
  return (Array.isArray(ballots) ? ballots : []).map(ids => ({
    vote_rankings: (Array.isArray(ids) ? ids : []).map((option_id, i) => ({ option_id, rank: i + 1 })),
  }))
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Voter-Token',
}

function makeHandler({ client = appClient } = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers }
    }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    const token = event.queryStringParameters?.token
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token parameter' }) }
    }
    if (!VOTE_TOKEN.test(token)) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
    }

    const rawVoterToken = event.headers?.['x-voter-token'] ?? event.headers?.['X-Voter-Token'] ?? null
    const voterToken = typeof rawVoterToken === 'string' && rawVoterToken.length <= MAX_VOTER_TOKEN_CHARS ? rawVoterToken : null

    const { data, error } = await client(bearer(event)).rpc('contest_ballots', { p_token: token, p_voter_token: voterToken })
    if (error) {
      const status = statusFor(error)
      if (status >= 500) console.error('contest_ballots failed:', error.code, error.message)
      return { statusCode: status, headers, body: JSON.stringify({ error: messageFor(error, status, 'Failed to fetch votes') }) }
    }

    const contest = data?.contest ?? {}
    const options = [...(data?.options ?? [])].sort((a, b) => a.order_index - b.order_index)
    const votes = toVotes(data?.ballots)
    const total_votes = votes.length

    if (total_votes === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          contest: { title: contest.title, max_winners: contest.max_winners },
          options,
          total_votes: 0,
          rounds:      [],
          winners:     [],
        }),
      }
    }

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
}

exports.toVotes = toVotes
exports.makeHandler = makeHandler
exports.handler = makeHandler()
