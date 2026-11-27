// get-comments.js
// The admin's download of a contest's voter comments (GET ?contest_id=&format=json|csv|markdown),
// grouped by option, options best-ranked first. It calls app_ranked_voting.contest_feedback with
// the admin's own access token: a security definer function that answers only the contest's
// admin, with every comment and its option but never the ballot or voter it came from. No
// service-role key.
const { appClient, bearer, messageFor, statusFor } = require('./_lib/supabase')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
const json = { ...cors, 'Content-Type': 'application/json' }

/**
 * Comments grouped by option title, options in order of average rank (lower is better; by
 * title when there are no ballots yet), options without comments left out.
 */
function groupComments(feedback) {
  const options = [...(feedback?.options ?? [])]
  const hasRankings = options.some(o => o.avg_rank !== null && o.avg_rank !== undefined)
  options.sort((a, b) => {
    if (hasRankings) return (a.avg_rank ?? Infinity) - (b.avg_rank ?? Infinity)
    return a.title.localeCompare(b.title)
  })
  const titleById = Object.fromEntries(options.map(o => [o.id, o.title]))
  const grouped = {}
  for (const o of options) grouped[o.title] = []
  for (const row of feedback?.comments ?? []) {
    const title = titleById[row.option_id] ?? 'Unknown'
    if (!grouped[title]) grouped[title] = []
    grouped[title].push(row.comment)
  }
  for (const title of Object.keys(grouped)) {
    if (grouped[title].length === 0) delete grouped[title]
  }
  return grouped
}

const csvCell = value => `"${String(value).replace(/"/g, '""')}"`

function toCsv(grouped) {
  let csv = 'Option,Comment\n'
  for (const [option, cmts] of Object.entries(grouped)) {
    for (const c of cmts) csv += `${csvCell(option)},${csvCell(c)}\n`
  }
  return csv
}

function toMarkdown(title, grouped) {
  let md = `# ${title} - Voter Comments\n\n`
  for (const [option, cmts] of Object.entries(grouped)) {
    md += `## ${option}\n\n`
    for (const c of cmts) md += `- ${c}\n`
    md += '\n'
  }
  if (Object.keys(grouped).length === 0) md += '_No comments submitted._\n'
  return md
}

/** A file name for Content-Disposition: the title without quotes, slashes or control characters. */
const fileName = (title, ext) => `${String(title).replace(/["\\/\r\n\t\0-\x1f]/g, '').slice(0, 150)} - Comments.${ext}`

function makeHandler({ client = appClient } = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: json, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    const contestId = event.queryStringParameters?.contest_id
    const format = event.queryStringParameters?.format ?? 'json'
    if (!contestId) return { statusCode: 400, headers: json, body: JSON.stringify({ error: 'Missing contest_id' }) }
    if (!UUID.test(contestId)) return { statusCode: 403, headers: json, body: JSON.stringify({ error: 'Access denied' }) }

    const token = bearer(event)
    if (!token) return { statusCode: 401, headers: json, body: JSON.stringify({ error: 'Authentication required' }) }

    const { data: feedback, error } = await client(token).rpc('contest_feedback', { p_contest_id: contestId })
    if (error) {
      const status = statusFor(error)
      if (status >= 500) console.error('contest_feedback failed:', error.code, error.message)
      return { statusCode: status, headers: json, body: JSON.stringify({ error: messageFor(error, status, 'Failed to fetch comments') }) }
    }

    const title = feedback?.title ?? 'Contest'
    const grouped = groupComments(feedback)

    if (format === 'csv') {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${fileName(title, 'csv')}"` },
        body: toCsv(grouped),
      }
    }
    if (format === 'markdown') {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="${fileName(title, 'md')}"` },
        body: toMarkdown(title, grouped),
      }
    }
    return { statusCode: 200, headers: json, body: JSON.stringify({ contest_title: title, comments_by_option: grouped }) }
  }
}

exports.groupComments = groupComments
exports.toCsv = toCsv
exports.toMarkdown = toMarkdown
exports.fileName = fileName
exports.makeHandler = makeHandler
exports.handler = makeHandler()
