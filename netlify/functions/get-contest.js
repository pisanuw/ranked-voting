// get-contest.js
// Returns a single contest + its options by vote_token.
// Uses the service key so the anon key never needs DB read access to contests.
// Callers only get data for the exact token they already know — no enumeration possible.

const { createClient } = require('@supabase/supabase-js')

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const token = event.queryStringParameters?.token
  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing token' }) }
  }

  const { data: contest, error } = await db()
    .from('contests')
    .select('id, title, description, vote_token, status, end_date, require_login, results_visible_to_voters, randomize_options, max_winners, contest_options(id, title, description, order_index)')
    .eq('vote_token', token)
    .single()

  if (error || !contest) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contest not found' }) }
  }

  // Never expose admin_id or internal fields to the client
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(contest),
  }
}
