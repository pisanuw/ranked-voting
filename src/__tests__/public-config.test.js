// The move to the shared HintWise Supabase project: the browser and the functions use its
// public URL and anon key, a Netlify build refuses anything else, and nothing in the app uses a
// service-role key or Supabase's own magic link (the shared project's email hook refuses it).
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HINTWISE_PROJECT_REF, HINTWISE_SUPABASE_URL, jwtClaims, publicEnvProblems } from '../../public-env.js'

const require = createRequire(import.meta.url)
const lib = require('../../netlify/functions/_lib/supabase.js')
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

/** A JWT with these claims and a dummy signature (only the payload is read). */
const jwt = (claims) => ['{"alg":"HS256"}', JSON.stringify(claims)].map((p) => Buffer.from(p).toString('base64url')).join('.') + '.sig'

describe('the public Supabase values', () => {
  const toml = read('netlify.toml')
  const env = (key) => toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1]

  it('are the same in netlify.toml (the browser) and the functions', () => {
    expect(env('VITE_SUPABASE_URL')).toBe(lib.SUPABASE_URL)
    expect(env('VITE_SUPABASE_ANON_KEY')).toBe(lib.SUPABASE_ANON_KEY)
    expect(lib.APP_SCHEMA).toBe('app_ranked_voting')
  })

  it('name the shared project, with its anon key', () => {
    expect(lib.SUPABASE_URL).toBe(HINTWISE_SUPABASE_URL)
    expect(jwtClaims(lib.SUPABASE_ANON_KEY)).toMatchObject({ role: 'anon', ref: HINTWISE_PROJECT_REF })
    expect(publicEnvProblems({ VITE_SUPABASE_URL: env('VITE_SUPABASE_URL'), VITE_SUPABASE_ANON_KEY: env('VITE_SUPABASE_ANON_KEY') })).toEqual([])
  })

  it('stop a Netlify build for another project or a key that is not the anon key, without printing it', () => {
    const good = { VITE_SUPABASE_URL: HINTWISE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: lib.SUPABASE_ANON_KEY }
    const service = jwt({ role: 'service_role', ref: HINTWISE_PROJECT_REF })
    const cases = [
      [{ ...good, VITE_SUPABASE_URL: 'https://iatqephvmykbkatpbwll.supabase.co' }, /VITE_SUPABASE_URL/],
      [{ ...good, VITE_SUPABASE_URL: undefined }, /VITE_SUPABASE_URL/],
      [{ ...good, VITE_SUPABASE_ANON_KEY: service }, /VITE_SUPABASE_ANON_KEY/],
      [{ ...good, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'someotherproject' }) }, /VITE_SUPABASE_ANON_KEY/],
      [{ ...good, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }, /VITE_SUPABASE_ANON_KEY/],
      [{ ...good, VITE_SUPABASE_ANON_KEY: undefined }, /VITE_SUPABASE_ANON_KEY/],
    ]
    for (const [values, pattern] of cases) {
      const problems = publicEnvProblems(values)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(pattern)
      expect(problems.join(' ')).not.toContain(service)
    }
    expect(jwtClaims('a.%%%.c')).toBeNull()
    expect(jwtClaims(`a.${Buffer.from('[1]').toString('base64url')}.c`)).toBeNull()
  })
})

/** Every file under `dir` (relative to the repo), tests and node_modules left out. */
function sources(dir) {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === '__tests__') continue
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path))
    else if (/\.(c?js|jsx|ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

describe('the code', () => {
  const files = [...sources('src'), ...sources('netlify')]

  it('covers the app and the functions', () => {
    expect(files).toContain(join('src', 'lib', 'auth.ts'))
    expect(files).toContain(join('netlify', 'functions', 'submit-vote.js'))
  })

  it('never calls Supabase magic link, and never uses a service-role key', () => {
    for (const file of files) {
      const text = read(file)
      expect(text, file).not.toMatch(/signInWithOtp\s*\(/)
      expect(text, file).not.toMatch(/SERVICE_KEY|SERVICE_ROLE|service_role/i)
      expect(text, file).not.toMatch(/process\.env\.SUPABASE/)
    }
  })

  it('keeps the migration out of every schema but its own', () => {
    const sql = read('supabase/migrations/0001_app_ranked_voting.sql').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bpublic\./i)
    expect(sql).not.toMatch(/\bplatform\./i)
    expect(sql).not.toMatch(/\bdrop\s+(table|schema|function)/i)
    for (const m of sql.matchAll(/create (?:table|or replace function|index)(?: if not exists)? ([a-z_]+)\.?/gi)) {
      if (!/^\w+_idx$/.test(m[1])) expect(m[1]).toBe('app_ranked_voting')
    }
  })
})
