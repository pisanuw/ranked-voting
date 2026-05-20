const { createClient } = require('@supabase/supabase-js')

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const authHeader = event.headers.authorization ?? event.headers.Authorization ?? ''
  const authToken = authHeader.replace('Bearer ', '').trim() || null

  const user = await getAuthenticatedUser(authToken)
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) }
  }

  const db = supabaseAdmin()

  // Find contests where the user is whitelisted or has already voted.
  // Return only open/closed contests (not drafts), with vote status.
  const { data: rows, error } = await db.rpc('get_voter_contests', {
    p_user_id: user.id,
    p_user_email: user.email,
  })

  if (error) {
    // Fallback: query directly if RPC not yet deployed
    const { data: votedContests } = await db
      .from('votes')
      .select('contest_id, contests!inner(id, title, status, vote_token, end_date, created_at)')
      .eq('voter_id', user.id)

    const { data: whitelistedContests } = await db
      .from('allowed_voters')
      .select('contest_id, contests!inner(id, title, status, vote_token, end_date, created_at)')
      .eq('email', user.email.toLowerCase())

    // Merge and deduplicate
    const contestMap = {}
    for (const row of (votedContests ?? [])) {
      const c = row.contests
      if (c.status === 'draft') continue
      contestMap[c.id] = { ...c, has_voted: true }
    }
    for (const row of (whitelistedContests ?? [])) {
      const c = row.contests
      if (c.status === 'draft') continue
      if (contestMap[c.id]) continue
      contestMap[c.id] = { ...c, has_voted: false }
    }

    const contests = Object.values(contestMap).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    )

    return { statusCode: 200, headers, body: JSON.stringify(contests) }
  }

  return { statusCode: 200, headers, body: JSON.stringify(rows ?? []) }
}
