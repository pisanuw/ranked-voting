// The move to https://ranked-voting.hintwise.org: the old netlify.app address
// answers 301 to the same path there, and nothing redirects on the new host.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')

/** The [[redirects]] blocks in file order, as { from, to, status, force }. */
function redirects(text) {
  return text.split('[[redirects]]').slice(1).map((block) => {
    const body = block.split(/\n\s*\[/)[0]
    const field = (k) => body.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm'))?.[1].trim().replace(/^"|"$/g, '')
    return { from: field('from'), to: field('to'), status: Number(field('status')), force: field('force') === 'true' }
  })
}

describe('netlify.toml redirects', () => {
  const rules = redirects(toml)

  it('sends https and http on ranked-voting.netlify.app to the new address, path kept, before any other rule', () => {
    expect(rules.slice(0, 2)).toEqual([
      { from: 'https://ranked-voting.netlify.app/*', to: 'https://ranked-voting.hintwise.org/:splat', status: 301, force: true },
      { from: 'http://ranked-voting.netlify.app/*', to: 'https://ranked-voting.hintwise.org/:splat', status: 301, force: true },
    ])
  })

  it('has no rule that matches the new host, so it cannot loop', () => {
    for (const r of rules) expect(r.from).not.toMatch(/hintwise\.org/)
  })

  it('keeps the API and SPA rules after the move', () => {
    expect(rules.slice(2)).toEqual([
      { from: '/api/*', to: '/.netlify/functions/:splat', status: 200, force: true },
      { from: '/*', to: '/index.html', status: 200, force: false },
    ])
  })
})
