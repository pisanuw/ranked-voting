const { createClient } = require('@supabase/supabase-js')

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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { contest_vote_token, rankings, voter_token, auth_token } = body

  if (!contest_vote_token || !Array.isArray(rankings) || rankings.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
  }

  const db = supabaseAdmin()

  // ── Load contest + options ────────────────────────────────────────────
  const { data: contest, error: cErr } = await db
    .from('contests')
    .select('*, contest_options(id)')
    .eq('vote_token', contest_vote_token)
    .single()

  if (cErr || !contest) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
  }

  // Check contest is open
  if (contest.status !== 'open') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'This contest is not currently open for voting' }) }
  }

  // Check end date
  if (contest.end_date && new Date(contest.end_date) < new Date()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'This contest has passed its end date' }) }
  }

  // ── Resolve voter identity ────────────────────────────────────────────
  // Always try to identify the user if an auth token is provided.
  // Login is only *required* if there is a voter whitelist.
  let voter_id   = null
  let voterEmail = null

  if (auth_token) {
    const authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${auth_token}` } } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      voter_id   = user.id
      voterEmail = user.email
    }
  }

  // ── Email whitelist check ─────────────────────────────────────────────
  const { data: allowedVoters } = await db
    .from('allowed_voters')
    .select('email')
    .eq('contest_id', contest.id)

  if (allowedVoters && allowedVoters.length > 0) {
    if (!voterEmail) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'You must be logged in to vote in this contest' }) }
    }
    const allowed = allowedVoters.some(av => av.email.toLowerCase() === voterEmail.toLowerCase())
    if (!allowed) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Your email is not on the voter list for this contest' }) }
    }
  }

  // ── Validate all options are ranked exactly once ──────────────────────
  const optionIds   = (contest.contest_options ?? []).map(o => o.id)
  const rankedIds   = rankings.map(r => r.option_id)
  const rankedRanks = rankings.map(r => r.rank)

  const allRanked        = optionIds.every(id => rankedIds.includes(id))
  const noExtras         = rankedIds.every(id => optionIds.includes(id))
  const correctCount     = rankings.length === optionIds.length
  const ranksAreUnique   = new Set(rankedRanks).size === rankedRanks.length
  const ranksAreSequential = rankedRanks.sort((a, b) => a - b).every((r, i) => r === i + 1)

  if (!allRanked || !noExtras || !correctCount || !ranksAreUnique || !ranksAreSequential) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid rankings: all options must be ranked exactly once' }) }
  }

  // ── Duplicate vote check ──────────────────────────────────────────────
  if (voter_id) {
    const { data: existing } = await db
      .from('votes')
      .select('id')
      .eq('contest_id', contest.id)
      .eq('voter_id', voter_id)
      .maybeSingle()
    if (existing) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'You have already voted in this contest' }) }
    }
  } else if (voter_token) {
    const { data: existing } = await db
      .from('votes')
      .select('id')
      .eq('contest_id', contest.id)
      .eq('voter_token', voter_token)
      .maybeSingle()
    if (existing) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'You have already voted in this contest' }) }
    }
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No voter identity provided' }) }
  }

  const { error: submitErr } = await db.rpc('submit_vote_with_rankings', {
    p_contest_id: contest.id,
    p_voter_id: voter_id,
    p_voter_token: voter_id ? null : voter_token,
    p_rankings: rankings,
  })

  if (submitErr) {
    console.error('Vote submission error:', submitErr)

    if (submitErr.code === '23505') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'You have already voted in this contest' }) }
    }

    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to record vote' }) }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
}
