// What every RankedVote function shares: a Supabase client on the shared HintWise project,
// scoped to the app's schema, that acts as the caller. With the caller's own access token it
// is that signed-in person (row level security and auth.uid() apply); without one it is an
// anonymous visitor with the public anon key. No function holds the service-role key.
//
// The URL and anon key are public by design (claude-built-apps platform/supabase.json; the
// browser bundle carries the same values from netlify.toml). They are written here rather than
// read from the site's environment, which still names the deleted project.
// src/__tests__/public-config.test.js keeps them equal to netlify.toml's.
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://auth.hintwise.org'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3R4bHJseWNlZmZ5b3pkd2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODEwMTAsImV4cCI6MjA5MjQ1NzAxMH0.Vuku-irT3kAHZYibK23q6dpyOEqV_Eg5zB78I3dyshE'
const APP_SCHEMA = 'app_ranked_voting'

/** A Supabase access token is a JWT: three base64url parts, well under 8 KB. */
const ACCESS_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const MAX_TOKEN_CHARS = 8192

/** The caller's access token, if it looks like one; anything else counts as no token. */
function accessToken(value) {
  const token = typeof value === 'string' ? value.replace(/^Bearer\s+/i, '').trim() : ''
  return token && token.length <= MAX_TOKEN_CHARS && ACCESS_TOKEN.test(token) ? token : null
}

/** The token in the request's Authorization header, or null. */
function bearer(event) {
  const headers = event?.headers ?? {}
  return accessToken(headers.authorization ?? headers.Authorization ?? '')
}

/** A client that acts as the caller: the signed-in person for `token`, else anonymous. */
function appClient(token, create = createClient) {
  return create(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: APP_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
}

/**
 * The HTTP status for a failed call. The schema's functions raise PostgREST's PTnnn codes
 * (PT404 is a 404, and so on); an expired or bad token is a 401; anything else is our fault.
 */
function statusFor(error) {
  const code = String(error?.code ?? '')
  const pt = /^PT([1-5][0-9]{2})$/.exec(code)
  if (pt) return Number(pt[1])
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || error?.status === 401) return 401
  return 500
}

/** The message to show for a failed call: the function's own words for 4xx, a generic one otherwise. */
function messageFor(error, status, fallback) {
  if (status === 401) return 'Your session has expired. Sign in again.'
  if (status >= 400 && status < 500 && typeof error?.message === 'string' && error.message) return error.message
  return fallback
}

module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY, APP_SCHEMA, accessToken, bearer, appClient, statusFor, messageFor }
