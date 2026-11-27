// The browser's Supabase values, checked before a Netlify build (vite.config.js): RankedVote
// runs on the shared HintWise project, with its public anon key. A build that would ship
// another project (the site's old variables name the deleted one) or a key whose role is not
// anon (a service-role key must never reach a browser) stops with a message that names the
// variable, never its value.
export const HINTWISE_SUPABASE_URL = 'https://auth.hintwise.org'
export const HINTWISE_PROJECT_REF = 'arktxlrlyceffyozdwhq'

/** The claims of a JWT's payload, or null when it is not one. Not verified: only read. */
export function jwtClaims(token) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json)
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null
  } catch {
    return null
  }
}

/** What is wrong with the build's VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, if anything. */
export function publicEnvProblems(env) {
  const problems = []
  if (env.VITE_SUPABASE_URL !== HINTWISE_SUPABASE_URL) {
    problems.push(`VITE_SUPABASE_URL must be ${HINTWISE_SUPABASE_URL} (netlify.toml [build.environment]).`)
  }
  const claims = jwtClaims(env.VITE_SUPABASE_ANON_KEY)
  if (!claims || claims.role !== 'anon' || claims.ref !== HINTWISE_PROJECT_REF) {
    problems.push(`VITE_SUPABASE_ANON_KEY must be the shared project's public anon key (claude-built-apps platform/supabase.json).`)
  }
  return problems
}
