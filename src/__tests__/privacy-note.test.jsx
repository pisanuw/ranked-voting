// The privacy note says what the analytics sends, in the other HintWise apps'
// words (claude-built-apps docs/new-app-guide.md: say what stays private and
// that visits are counted without cookies; never "no tracking").
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyNote from '../components/PrivacyNote'

const text = renderToStaticMarkup(<PrivacyNote />).replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

describe('privacy note', () => {
  it('says what is counted and what is never sent', () => {
    for (const phrase of [
      "HintWise's own analytics",
      'the pages viewed',
      'how long each was on screen',
      'the kind of device',
      'the website that linked you here',
      'links followed to other sites',
      'script errors',
      'with its code replaced by :id',
      'apart from what a script error message may contain, it never includes your ballot, your comments or your email address',
      'uses no cookie',
      'Do Not Track',
      'Global Privacy Control',
    ]) {
      expect(text).toContain(phrase)
    }
    expect(text).not.toMatch(/no tracking|nothing is sent anywhere/i)
  })

  it('is shown on the sign-in page and on the ballot', () => {
    for (const page of ['Login', 'VotingPage']) {
      const src = readFileSync(new URL(`../pages/${page}.jsx`, import.meta.url), 'utf8')
      expect(src).toContain("import PrivacyNote from '../components/PrivacyNote'")
      expect(src).toContain('<PrivacyNote')
    }
  })
})
