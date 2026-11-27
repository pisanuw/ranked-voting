// submit-vote.js
// Records one ballot (POST JSON { contest_vote_token, rankings, comments?, voter_token?,
// auth_token? }). It calls app_ranked_voting.submit_vote as the voter: with their access token
// when signed in, else as an anonymous browser identified by voter_token. The database function
// checks everything (the contest is open, the submission gate, the end date, the voter list
// with its @domain rules, every option ranked once, required comments, one ballot per voter)
// and answers with an HTTP status in its error code. No service-role key is used.
const { accessToken, appClient, messageFor, statusFor } = require('./_lib/supabase')

/** The body is read only up to this size: 100 options with 2000-character comments fit. */
const MAX_BODY_BYTES = 256 * 1024
/** More entries than any contest has options is refused before the database sees it. */
const MAX_ENTRIES = 500

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) })

function makeHandler({ client = appClient } = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' })

    const raw = typeof event.body === 'string' ? event.body : ''
    const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw
    // The size cap comes before JSON.parse, so a huge body costs nothing to refuse.
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return reply(413, { error: 'The ballot is too large' })

    let body
    try {
      body = JSON.parse(text)
    } catch {
      return reply(400, { error: 'Invalid JSON' })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid JSON' })

    const { contest_vote_token, rankings, comments, voter_token, auth_token } = body
    if (typeof contest_vote_token !== 'string' || !contest_vote_token || !Array.isArray(rankings) || rankings.length === 0) {
      return reply(400, { error: 'Missing required fields' })
    }
    if (rankings.length > MAX_ENTRIES || (Array.isArray(comments) && comments.length > MAX_ENTRIES)) {
      return reply(400, { error: 'Invalid rankings: all options must be ranked exactly once' })
    }

    const token = accessToken(auth_token)
    const { error } = await client(token).rpc('submit_vote', {
      p_token: contest_vote_token,
      p_rankings: rankings,
      p_comments: Array.isArray(comments) ? comments : null,
      p_voter_token: token ? null : (typeof voter_token === 'string' ? voter_token : null),
    })

    if (error) {
      const status = statusFor(error)
      if (status >= 500) console.error('submit_vote failed:', error.code, error.message)
      return reply(status, { error: messageFor(error, status, 'Failed to record vote') })
    }
    return reply(200, { success: true })
  }
}

exports.makeHandler = makeHandler
exports.MAX_BODY_BYTES = MAX_BODY_BYTES
exports.MAX_ENTRIES = MAX_ENTRIES
exports.handler = makeHandler()
