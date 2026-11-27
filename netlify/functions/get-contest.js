// get-contest.js
// One open or closed contest and its options, by its voting code (GET ?token=). Anyone with the
// code may read it, so it calls app_ranked_voting.get_contest as an anonymous visitor: a
// security definer function that answers only for the exact code, never for a draft, and never
// with the admin or any ballot. No enumeration is possible, and no service-role key is used.
const { appClient } = require('./_lib/supabase')

/** A voting code: hex today; letters, digits, - and _ accepted, at most 128 characters. */
const VOTE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/

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

    const token = event.queryStringParameters?.token
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token' }) }
    }
    if (!VOTE_TOKEN.test(token)) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
    }

    const { data: contest, error } = await client(null).rpc('get_contest', { p_token: token })
    if (error) {
      console.error('get_contest failed:', error.code, error.message)
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load the contest' }) }
    }
    if (!contest) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify(contest) }
  }
}

exports.makeHandler = makeHandler
exports.VOTE_TOKEN = VOTE_TOKEN
exports.handler = makeHandler()
