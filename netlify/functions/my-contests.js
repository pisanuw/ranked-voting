// my-contests.js
// The signed-in person's contests as a voter (GET, Authorization: Bearer <access token>): open
// or closed contests they voted in, or whose voter list names their address. It calls
// app_ranked_voting.my_voter_contests with their own token. No service-role key.
const { appClient, bearer, messageFor, statusFor } = require('./_lib/supabase')

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function makeHandler({ client = appClient } = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    const token = bearer(event)
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) }

    const { data: rows, error } = await client(token).rpc('my_voter_contests')
    if (error) {
      const status = statusFor(error)
      if (status >= 500) console.error('my_voter_contests failed:', error.code, error.message)
      return { statusCode: status, headers, body: JSON.stringify({ error: messageFor(error, status, 'Failed to load your contests') }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify(rows ?? []) }
  }
}

exports.makeHandler = makeHandler
exports.handler = makeHandler()
