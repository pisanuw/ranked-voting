// The Netlify functions with a fake Supabase client: what each sends to the database (as whom,
// which function, which arguments), how it answers, and the input it refuses before calling.
// The database side of each call is tested in supabase/__tests__/migration.test.js.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lib = require('../_lib/supabase.js')
const getContest = require('../get-contest.js')
const submitVote = require('../submit-vote.js')
const getResults = require('../get-results.js')
const getComments = require('../get-comments.js')
const myContests = require('../my-contests.js')

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl'
const TOKEN = '0123456789abcdef0123456789abcdef'
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

/** A fake appClient: records each call and answers with `answer` (or answer(fn, args)). */
function fake(answer = { data: null, error: null }) {
  const calls = []
  const client = (token) => ({
    rpc: async (fn, args) => {
      calls.push({ token, fn, args })
      return typeof answer === 'function' ? answer(fn, args) : answer
    },
  })
  return { calls, client }
}

const get = (query = {}, headers = {}) => ({ httpMethod: 'GET', queryStringParameters: query, headers })
const post = (body, extra = {}) => ({ httpMethod: 'POST', headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body), ...extra })
const parse = (res) => JSON.parse(res.body)

describe('_lib/supabase', () => {
  it('accepts only something shaped like an access token', () => {
    expect(lib.accessToken(JWT)).toBe(JWT)
    expect(lib.accessToken(`Bearer ${JWT}`)).toBe(JWT)
    expect(lib.accessToken(`bearer   ${JWT} `)).toBe(JWT)
    for (const bad of [null, undefined, 42, '', 'Bearer ', 'not a token', 'a.b', 'a.b.c.d', 'a.b.c d', `${'a'.repeat(8190)}.b.c`]) {
      expect(lib.accessToken(bad), String(bad).slice(0, 20)).toBeNull()
    }
    expect(lib.accessToken(`${'a'.repeat(8188)}.b.c`)).toHaveLength(8192)
  })

  it('reads the Authorization header in either case', () => {
    expect(lib.bearer({ headers: { authorization: `Bearer ${JWT}` } })).toBe(JWT)
    expect(lib.bearer({ headers: { Authorization: `Bearer ${JWT}` } })).toBe(JWT)
    expect(lib.bearer({ headers: {} })).toBeNull()
    expect(lib.bearer({})).toBeNull()
  })

  it('makes a client on the shared project, in the app schema, as the caller', () => {
    const made = []
    const create = (...args) => { made.push(args); return {} }
    lib.appClient(JWT, create)
    lib.appClient(null, create)
    expect(made[0][0]).toBe('https://auth.hintwise.org')
    expect(made[0][1]).toBe(lib.SUPABASE_ANON_KEY)
    expect(made[0][2].db).toEqual({ schema: 'app_ranked_voting' })
    expect(made[0][2].global.headers).toEqual({ Authorization: `Bearer ${JWT}` })
    expect(made[0][2].auth.persistSession).toBe(false)
    expect(made[1][2].global.headers).toEqual({})
    // The real client, too: nothing is sent until a call is made.
    expect(typeof lib.appClient(null).rpc).toBe('function')
  })

  it('maps database errors to HTTP statuses and messages', () => {
    expect(lib.statusFor({ code: 'PT404' })).toBe(404)
    expect(lib.statusFor({ code: 'PT403' })).toBe(403)
    expect(lib.statusFor({ code: 'PT409' })).toBe(409)
    expect(lib.statusFor({ code: 'PT400' })).toBe(400)
    expect(lib.statusFor({ code: 'PGRST301' })).toBe(401)
    expect(lib.statusFor({ code: 'XX', status: 401 })).toBe(401)
    expect(lib.statusFor({ code: 'PT999' })).toBe(500)
    expect(lib.statusFor({ code: '42501' })).toBe(500)
    expect(lib.statusFor(null)).toBe(500)
    expect(lib.messageFor({ message: 'Nope' }, 403, 'fallback')).toBe('Nope')
    expect(lib.messageFor({ message: '' }, 403, 'fallback')).toBe('fallback')
    expect(lib.messageFor({ message: 'relation does not exist' }, 500, 'fallback')).toBe('fallback')
    expect(lib.messageFor({}, 401, 'fallback')).toMatch(/Sign in again/)
  })
})

describe('get-contest', () => {
  it('answers preflight and refuses other methods', async () => {
    const h = getContest.makeHandler(fake())
    expect((await h({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await h({ httpMethod: 'POST' })).statusCode).toBe(405)
  })

  it('reads one contest by its code, as an anonymous caller', async () => {
    const f = fake({ data: { id: UUID_A, title: 'T', contest_options: [] }, error: null })
    const res = await getContest.makeHandler(f)(get({ token: TOKEN }, { authorization: `Bearer ${JWT}` }))
    expect(res.statusCode).toBe(200)
    expect(parse(res).title).toBe('T')
    expect(f.calls).toEqual([{ token: null, fn: 'get_contest', args: { p_token: TOKEN } }])
  })

  it('says not found for a missing contest or a malformed code, without asking for the latter', async () => {
    const f = fake({ data: null, error: null })
    const h = getContest.makeHandler(f)
    expect((await h(get({ token: TOKEN }))).statusCode).toBe(404)
    expect((await h(get({ token: 'a/b' }))).statusCode).toBe(404)
    expect((await h(get({ token: 'x'.repeat(129) }))).statusCode).toBe(404)
    expect((await h(get({}))).statusCode).toBe(400)
    expect(f.calls).toHaveLength(1)
  })

  it('reports a database failure as a 500', async () => {
    const res = await getContest.makeHandler(fake({ data: null, error: { code: '57014', message: 'timeout' } }))(get({ token: TOKEN }))
    expect(res.statusCode).toBe(500)
    expect(parse(res).error).toBe('Failed to load the contest')
  })
})

describe('submit-vote', () => {
  const rankings = [{ option_id: UUID_A, rank: 1 }, { option_id: UUID_B, rank: 2 }]
  const okBody = { contest_vote_token: TOKEN, rankings, voter_token: 'browser-token-1' }

  it('answers preflight and refuses other methods', async () => {
    const h = submitVote.makeHandler(fake())
    expect((await h({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await h({ httpMethod: 'GET' })).statusCode).toBe(405)
  })

  it('submits an anonymous ballot with the browser token', async () => {
    const f = fake()
    const res = await submitVote.makeHandler(f)(post({ ...okBody, comments: [{ option_id: UUID_A, comment: 'Good' }] }))
    expect(res.statusCode).toBe(200)
    expect(parse(res)).toEqual({ success: true })
    expect(f.calls).toEqual([{
      token: null,
      fn: 'submit_vote',
      args: { p_token: TOKEN, p_rankings: rankings, p_comments: [{ option_id: UUID_A, comment: 'Good' }], p_voter_token: 'browser-token-1' },
    }])
  })

  it('submits as the signed-in voter, without a browser token', async () => {
    const f = fake()
    await submitVote.makeHandler(f)(post({ ...okBody, auth_token: JWT, comments: 'not a list' }))
    expect(f.calls[0].token).toBe(JWT)
    expect(f.calls[0].args.p_voter_token).toBeNull()
    expect(f.calls[0].args.p_comments).toBeNull()
  })

  it('treats a malformed auth token as no sign-in', async () => {
    const f = fake()
    await submitVote.makeHandler(f)(post({ ...okBody, auth_token: 'garbage' }))
    expect(f.calls[0].token).toBeNull()
    expect(f.calls[0].args.p_voter_token).toBe('browser-token-1')
    await submitVote.makeHandler(f)(post({ ...okBody, voter_token: 7 }))
    expect(f.calls[1].args.p_voter_token).toBeNull()
  })

  it('caps the body before parsing it, in bytes', async () => {
    const f = fake()
    const h = submitVote.makeHandler(f)
    const cap = submitVote.MAX_BODY_BYTES
    const padded = (bytes, ch = ' ') => {
      const json = JSON.stringify(okBody)
      return json + ch.repeat(Math.floor((bytes - Buffer.byteLength(json)) / Buffer.byteLength(ch)))
    }
    const atCap = padded(cap)
    expect(Buffer.byteLength(atCap)).toBe(cap)
    expect((await h(post(atCap))).statusCode).toBe(200)
    expect((await h(post(`${atCap} `))).statusCode).toBe(413)
    // Characters are not bytes: half as many two-byte characters reach the same cap.
    const twoByte = JSON.stringify({ ...okBody, voter_token: 'é'.repeat(cap / 2) })
    expect(twoByte.length).toBeLessThan(cap)
    expect((await h(post(twoByte))).statusCode).toBe(413)
    expect(f.calls).toHaveLength(1)
  })

  it('reads a base64-encoded body', async () => {
    const f = fake()
    const res = await submitVote.makeHandler(f)(post(Buffer.from(JSON.stringify(okBody)).toString('base64'), { isBase64Encoded: true }))
    expect(res.statusCode).toBe(200)
    expect(f.calls[0].args.p_token).toBe(TOKEN)
  })

  it('refuses bad JSON and missing or oversized fields without calling the database', async () => {
    const f = fake()
    const h = submitVote.makeHandler(f)
    for (const body of ['{', 'null', '[1]', '"x"']) expect((await h(post(body))).statusCode, body).toBe(400)
    expect((await h({ httpMethod: 'POST', headers: {} })).statusCode).toBe(400)
    expect((await h(post({ rankings }))).statusCode).toBe(400)
    expect((await h(post({ contest_vote_token: TOKEN, rankings: [] }))).statusCode).toBe(400)
    expect((await h(post({ contest_vote_token: TOKEN, rankings: 'all' }))).statusCode).toBe(400)
    const many = Array.from({ length: submitVote.MAX_ENTRIES + 1 }, (_, i) => ({ option_id: UUID_A, rank: i + 1 }))
    expect((await h(post({ contest_vote_token: TOKEN, rankings: many }))).statusCode).toBe(400)
    expect((await h(post({ ...okBody, comments: many }))).statusCode).toBe(400)
    expect(f.calls).toHaveLength(0)
    const atMax = many.slice(0, submitVote.MAX_ENTRIES)
    expect((await h(post({ contest_vote_token: TOKEN, rankings: atMax, voter_token: 'browser-token-1' }))).statusCode).toBe(200)
  })

  it('passes on what the database refused, with its status and words', async () => {
    const cases = [
      [{ code: 'PT404', message: 'Contest not found' }, 404, 'Contest not found'],
      [{ code: 'PT403', message: 'Your email is not on the voter list for this contest' }, 403, 'Your email is not on the voter list for this contest'],
      [{ code: 'PT409', message: 'You have already voted in this contest' }, 409, 'You have already voted in this contest'],
      [{ code: 'PT400', message: 'Submissions are not open for this contest yet' }, 400, 'Submissions are not open for this contest yet'],
      [{ code: 'PGRST301', message: 'JWT expired' }, 401, 'Your session has expired. Sign in again.'],
      [{ code: '42883', message: 'function does not exist' }, 500, 'Failed to record vote'],
    ]
    for (const [error, status, message] of cases) {
      const res = await submitVote.makeHandler(fake({ data: null, error }))(post(okBody))
      expect(res.statusCode, error.code).toBe(status)
      expect(parse(res).error).toBe(message)
    }
  })
})

describe('get-results', () => {
  const options = [
    { id: UUID_B, title: 'B', description: null, order_index: 1 },
    { id: UUID_A, title: 'A', description: null, order_index: 0 },
    { id: UUID_C, title: 'C', description: null, order_index: 2 },
  ]

  it('answers preflight and refuses other methods and bad codes', async () => {
    const f = fake()
    const h = getResults.makeHandler(f)
    expect((await h({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await h({ httpMethod: 'POST' })).statusCode).toBe(405)
    expect((await h(get({}))).statusCode).toBe(400)
    expect((await h(get({ token: '../x' }))).statusCode).toBe(404)
    expect(f.calls).toHaveLength(0)
  })

  it('asks as the caller, with the browser token, and counts the ballots', async () => {
    const f = fake({
      data: {
        contest: { title: 'Board', max_winners: 1 },
        options,
        ballots: [[UUID_A, UUID_B, UUID_C], [UUID_A, UUID_C, UUID_B], [UUID_B, UUID_A, UUID_C]],
      },
      error: null,
    })
    const res = await getResults.makeHandler(f)(get({ token: TOKEN }, { authorization: `Bearer ${JWT}`, 'x-voter-token': 'browser-token-1' }))
    expect(f.calls).toEqual([{ token: JWT, fn: 'contest_ballots', args: { p_token: TOKEN, p_voter_token: 'browser-token-1' } }])
    expect(res.statusCode).toBe(200)
    const body = parse(res)
    expect(body.contest).toEqual({ title: 'Board', max_winners: 1 })
    expect(body.options.map((o) => o.title)).toEqual(['A', 'B', 'C'])
    expect(body.total_votes).toBe(3)
    expect(body.quota).toBe(2)
    expect(body.winners).toEqual([UUID_A])
  })

  it('answers no ballots with an empty count', async () => {
    const f = fake({ data: { contest: { title: 'Board', max_winners: 1 }, options, ballots: [] }, error: null })
    const res = await getResults.makeHandler(f)(get({ token: TOKEN }, { 'X-Voter-Token': 'x'.repeat(101) }))
    expect(f.calls[0]).toEqual({ token: null, fn: 'contest_ballots', args: { p_token: TOKEN, p_voter_token: null } })
    expect(parse(res)).toMatchObject({ total_votes: 0, rounds: [], winners: [] })
  })

  it('passes on a refusal and hides a failure', async () => {
    const refused = await getResults.makeHandler(fake({ data: null, error: { code: 'PT403', message: 'Results are restricted to the contest admin' } }))(get({ token: TOKEN }))
    expect(refused.statusCode).toBe(403)
    expect(parse(refused).error).toBe('Results are restricted to the contest admin')
    const missing = await getResults.makeHandler(fake({ data: null, error: { code: 'PT404', message: 'Contest not found' } }))(get({ token: TOKEN }))
    expect(missing.statusCode).toBe(404)
    const broken = await getResults.makeHandler(fake({ data: null, error: { code: 'XX000', message: 'internal' } }))(get({ token: TOKEN }))
    expect(broken.statusCode).toBe(500)
    expect(parse(broken).error).toBe('Failed to fetch votes')
  })

  it('turns ballots into the shape runIRV reads', () => {
    expect(getResults.toVotes([[UUID_A, UUID_B]])).toEqual([{ vote_rankings: [{ option_id: UUID_A, rank: 1 }, { option_id: UUID_B, rank: 2 }] }])
    expect(getResults.toVotes(null)).toEqual([])
    expect(getResults.toVotes(['x'])).toEqual([{ vote_rankings: [] }])
  })
})

describe('get-comments', () => {
  const feedback = {
    title: 'Board "2026"',
    options: [
      { id: UUID_A, title: 'A', avg_rank: 2.5 },
      { id: UUID_B, title: 'B, the "best"', avg_rank: 1 },
      { id: UUID_C, title: 'C', avg_rank: 2.5 },
    ],
    comments: [
      { option_id: UUID_A, comment: 'Solid' },
      { option_id: UUID_B, comment: 'Says "yes"' },
      { option_id: UUID_B, comment: 'Line one\nline two' },
    ],
  }
  const auth = { authorization: `Bearer ${JWT}` }

  it('needs a signed-in caller and a contest id', async () => {
    const f = fake({ data: feedback, error: null })
    const h = getComments.makeHandler(f)
    expect((await h({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await h({ httpMethod: 'POST' })).statusCode).toBe(405)
    expect((await h(get({}, auth))).statusCode).toBe(400)
    expect((await h(get({ contest_id: 'nope' }, auth))).statusCode).toBe(403)
    expect((await h(get({ contest_id: UUID_A }))).statusCode).toBe(401)
    expect(f.calls).toHaveLength(0)
  })

  it('asks as the admin and groups the comments, best-ranked option first', async () => {
    const f = fake({ data: feedback, error: null })
    const res = await getComments.makeHandler(f)(get({ contest_id: UUID_A }, auth))
    expect(f.calls).toEqual([{ token: JWT, fn: 'contest_feedback', args: { p_contest_id: UUID_A } }])
    expect(res.statusCode).toBe(200)
    const body = parse(res)
    expect(body.contest_title).toBe('Board "2026"')
    expect(Object.keys(body.comments_by_option)).toEqual(['B, the "best"', 'A'])
    expect(body.comments_by_option.A).toEqual(['Solid'])
  })

  it('writes CSV and Markdown downloads with a safe file name', async () => {
    const h = getComments.makeHandler(fake({ data: feedback, error: null }))
    const csv = await h(get({ contest_id: UUID_A, format: 'csv' }, auth))
    expect(csv.headers['Content-Type']).toBe('text/csv')
    expect(csv.headers['Content-Disposition']).toBe('attachment; filename="Board 2026 - Comments.csv"')
    expect(csv.body).toBe('Option,Comment\n"B, the ""best""","Says ""yes"""\n"B, the ""best""","Line one\nline two"\n"A","Solid"\n')
    const md = await h(get({ contest_id: UUID_A, format: 'markdown' }, auth))
    expect(md.headers['Content-Type']).toBe('text/markdown')
    expect(md.body.startsWith('# Board "2026" - Voter Comments\n\n## B, the "best"\n\n- Says "yes"\n')).toBe(true)
  })

  it('orders options by title before any ballot, and says when there are no comments', async () => {
    const grouped = getComments.groupComments({
      options: [{ id: UUID_B, title: 'Zed', avg_rank: null }, { id: UUID_A, title: 'Abe', avg_rank: null }],
      comments: [{ option_id: UUID_B, comment: 'z' }, { option_id: UUID_A, comment: 'a' }, { option_id: UUID_C, comment: '?' }],
    })
    expect(Object.keys(grouped)).toEqual(['Abe', 'Zed', 'Unknown'])
    expect(getComments.toMarkdown('T', {})).toBe('# T - Voter Comments\n\n_No comments submitted._\n')
    expect(getComments.groupComments(null)).toEqual({})
    expect(getComments.fileName('a/b\\c"d\r\ne', 'md')).toBe('abcde - Comments.md')
  })

  it('passes on the admin check and hides a failure', async () => {
    const denied = await getComments.makeHandler(fake({ data: null, error: { code: 'PT403', message: 'Access denied' } }))(get({ contest_id: UUID_A }, auth))
    expect(denied.statusCode).toBe(403)
    expect(parse(denied).error).toBe('Access denied')
    const broken = await getComments.makeHandler(fake({ data: null, error: { code: 'XX000', message: 'internal' } }))(get({ contest_id: UUID_A }, auth))
    expect(broken.statusCode).toBe(500)
    expect(parse(broken).error).toBe('Failed to fetch comments')
  })
})

describe('my-contests', () => {
  it('needs a signed-in caller and asks as them', async () => {
    const rows = [{ id: UUID_A, title: 'T', status: 'open', vote_token: TOKEN, has_voted: false }]
    const f = fake({ data: rows, error: null })
    const h = myContests.makeHandler(f)
    expect((await h({ httpMethod: 'OPTIONS' })).statusCode).toBe(204)
    expect((await h({ httpMethod: 'POST' })).statusCode).toBe(405)
    expect((await h(get())).statusCode).toBe(401)
    const res = await h(get({}, { Authorization: `Bearer ${JWT}` }))
    expect(res.statusCode).toBe(200)
    expect(parse(res)).toEqual(rows)
    expect(f.calls).toEqual([{ token: JWT, fn: 'my_voter_contests', args: undefined }])
  })

  it('answers an empty list for no rows, 401 for an expired session and 500 for a failure', async () => {
    const auth = { authorization: `Bearer ${JWT}` }
    expect(parse(await myContests.makeHandler(fake({ data: null, error: null }))(get({}, auth)))).toEqual([])
    expect((await myContests.makeHandler(fake({ data: null, error: { code: 'PGRST301' } }))(get({}, auth))).statusCode).toBe(401)
    const broken = await myContests.makeHandler(fake({ data: null, error: { code: 'XX000', message: 'internal' } }))(get({}, auth))
    expect(broken.statusCode).toBe(500)
    expect(parse(broken).error).toBe('Failed to load your contests')
  })
})
