// The HintWise footer is embedded byte for byte, once, in the HTML the server
// sends (a declarative shadow root renders only when parsed as HTML, never when
// React inserts it). Source: footerHtml('ranked-voting') in claude-built-apps
// scripts/site-footer.mjs; when the owner changes the footer, copy the new
// markup in and update the hash (docs/new-app-guide.md, section 6).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const FOOTER_SHA256 = '554f121ce6a5a4998b25bda874c47074c548b3caf0bdaf79f5fe92bc6ce0dd31'
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('HintWise footer', () => {
  it('appears once, unchanged, after #root and before </body>', () => {
    const open = '<site-footer data-site-footer>'
    const close = '</site-footer>'
    expect(html.split('data-site-footer')).toHaveLength(2)
    const start = html.indexOf(open)
    const markup = html.slice(start, html.indexOf(close, start) + close.length)
    expect(createHash('sha256').update(markup).digest('hex')).toBe(FOOTER_SHA256)
    expect(start).toBeGreaterThan(html.indexOf('<div id="root"></div>'))
    expect(html.indexOf(close)).toBeLessThan(html.indexOf('</body>'))
  })

  it("names this app in the footer's email subject", () => {
    expect(html).toContain('mailto:builder@hintwise.org?subject=Project%20idea%20(via%20ranked-voting)')
    expect(html).toContain('<template shadowrootmode="open">')
  })

  it('uses the HintWise icon as the favicon (the old /ballot.svg was never in the repository)', () => {
    expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,[^"]*%23312E81/)
    expect(html).not.toContain('ballot.svg')
  })
})
