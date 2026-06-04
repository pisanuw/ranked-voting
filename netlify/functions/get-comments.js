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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const contestId = event.queryStringParameters?.contest_id
  const format = event.queryStringParameters?.format ?? 'json'
  const authHeader = event.headers.authorization ?? event.headers.Authorization ?? ''
  const authToken = authHeader.replace('Bearer ', '').trim() || null

  if (!contestId) {
    return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing contest_id' }) }
  }

  // Verify admin access
  const user = await getAuthenticatedUser(authToken)
  if (!user) {
    return { statusCode: 401, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Authentication required' }) }
  }

  const db = supabaseAdmin()

  const { data: contest } = await db
    .from('contests')
    .select('id, title, admin_id')
    .eq('id', contestId)
    .eq('admin_id', user.id)
    .single()

  if (!contest) {
    return { statusCode: 403, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Access denied' }) }
  }

  // Fetch comments, options, and vote rankings in parallel
  const [commentsRes, optionsRes, rankingsRes] = await Promise.all([
    db.from('vote_comments')
      .select('comment, option_id, contest_options!inner(title)')
      .eq('contest_options.contest_id', contestId),
    db.from('contest_options')
      .select('id, title')
      .eq('contest_id', contestId),
    db.from('votes')
      .select('vote_rankings(option_id, rank)')
      .eq('contest_id', contestId),
  ])

  if (commentsRes.error) {
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to fetch comments' }) }
  }

  // Compute average rank per option (lower = better ranked)
  const rankSums = {}
  const rankCounts = {}
  for (const vote of (rankingsRes.data ?? [])) {
    for (const r of (vote.vote_rankings ?? [])) {
      rankSums[r.option_id] = (rankSums[r.option_id] ?? 0) + r.rank
      rankCounts[r.option_id] = (rankCounts[r.option_id] ?? 0) + 1
    }
  }
  const avgRank = {}
  for (const id of Object.keys(rankSums)) {
    avgRank[id] = rankSums[id] / rankCounts[id]
  }

  // Build option title lookup and sort order
  const optionTitleById = {}
  const allOptions = (optionsRes.data ?? [])
  for (const o of allOptions) optionTitleById[o.id] = o.title

  const hasRankings = Object.keys(avgRank).length > 0
  allOptions.sort((a, b) => {
    if (hasRankings) return (avgRank[a.id] ?? Infinity) - (avgRank[b.id] ?? Infinity)
    return a.title.localeCompare(b.title)
  })
  const sortedTitles = allOptions.map(o => o.title)

  // Group comments by option
  const grouped = {}
  for (const title of sortedTitles) grouped[title] = []
  for (const row of (commentsRes.data ?? [])) {
    const optionTitle = row.contest_options?.title ?? 'Unknown'
    if (!grouped[optionTitle]) grouped[optionTitle] = []
    grouped[optionTitle].push(row.comment)
  }
  // Remove options with no comments
  for (const title of Object.keys(grouped)) {
    if (grouped[title].length === 0) delete grouped[title]
  }

  if (format === 'csv') {
    let csv = 'Option,Comment\n'
    for (const [option, cmts] of Object.entries(grouped)) {
      for (const c of cmts) {
        csv += `"${option.replace(/"/g, '""')}","${c.replace(/"/g, '""')}"\n`
      }
    }
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${contest.title} - Comments.csv"` },
      body: csv,
    }
  }

  if (format === 'markdown') {
    let md = `# ${contest.title} - Voter Comments\n\n`
    for (const [option, cmts] of Object.entries(grouped)) {
      md += `## ${option}\n\n`
      for (const c of cmts) {
        md += `- ${c}\n`
      }
      md += '\n'
    }
    if (Object.keys(grouped).length === 0) {
      md += '_No comments submitted._\n'
    }
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="${contest.title} - Comments.md"` },
      body: md,
    }
  }

  // Default: JSON
  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contest_title: contest.title, comments_by_option: grouped }),
  }
}
