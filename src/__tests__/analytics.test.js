// HintWise first-party analytics for an app in its own repository
// (claude-built-apps docs/new-app-guide.md, section 6, "Analytics"): the
// platform's hw-events.js copied unchanged and served at /hw-events.js, its tag
// once in <head>, and the share codes in /vote/ and /results/ masked.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const SCRIPT_SHA256 = 'd2833162b9f18f9f2fdb36dbd62440c13ee26c6600200d8e55ad32b907f00633'
const TAG = '<script defer src="/hw-events.js" data-app="ranked-voting" data-mask="/vote/ /results/ /admin/"></script>'
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url))

describe('analytics script', () => {
  it("is the platform's hw-events.js, unchanged, in public/ (served at /hw-events.js)", () => {
    expect(createHash('sha256').update(read('public/hw-events.js')).digest('hex')).toBe(SCRIPT_SHA256)
  })

  it('index.html has the tag once, in the head', () => {
    const html = read('index.html').toString('utf8')
    expect(html.split(TAG)).toHaveLength(2)
    expect(html.split('hw-events.js')).toHaveLength(2)
    expect(html.indexOf(TAG)).toBeLessThan(html.indexOf('</head>'))
  })

  it('loads from the site root on every route: no relative base in the build', () => {
    expect(read('vite.config.js').toString('utf8')).not.toMatch(/\bbase\s*:/)
  })

  it('no Content-Security-Policy blocks the beacon to auth.hintwise.org', () => {
    const toml = read('netlify.toml').toString('utf8')
    if (/Content-Security-Policy/i.test(toml)) expect(toml).toMatch(/connect-src[^;"]*https:\/\/auth\.hintwise\.org/)
  })
})
