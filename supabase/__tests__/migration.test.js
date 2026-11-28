// supabase/migrations/0001_app_ranked_voting.sql against real Postgres (PGlite, harness.js):
// who can read and write what, and every rule submit_vote enforces. No network.
import { beforeAll, describe, expect, it } from 'vitest'
import { addUser, as, failure, freshDb, MIGRATION, rpc } from './harness.js'

let db

beforeAll(async () => {
  db = await freshDb()
}, 60_000)

const S = 'app_ranked_voting'

/** Creates a contest as `admin` with options A, B, C (and an optional voter list); returns its row and options. */
async function makeContest(admin, { emails = null, comments = false, results = true, open = true, gate = true } = {}) {
  const id = await rpc(db, admin,
    `${S}.create_contest_with_relations('Board election', 'Pick two', 1, $1, false, $2, null, '[{"title":"A"},{"title":"B"},{"title":"C"}]'::jsonb, $3::text[])`,
    [results, comments, emails])
  if (open) {
    await as(db, admin, (tx) => tx.query(`update ${S}.contests set status = 'open', submissions_open = $2 where id = $1`, [id, gate]))
  }
  const contest = (await db.query(`select * from ${S}.contests where id = $1`, [id])).rows[0]
  const options = (await db.query(`select id, title from ${S}.contest_options where contest_id = $1 order by order_index`, [id])).rows
  return { ...contest, options }
}

const ballot = (options, order = [0, 1, 2]) => JSON.stringify(order.map((i, rank) => ({ option_id: options[i].id, rank: rank + 1 })))

const vote = (who, c, { rankings = ballot(c.options), comments = null, token = null } = {}) =>
  rpc(db, who, `${S}.submit_vote($1, $2::jsonb, $3::jsonb, $4)`, [c.vote_token, rankings, comments, token])

const code = async (promise) => (await failure(promise))?.code ?? null

describe('the schema', () => {
  it('can be applied again without changing anything', async () => {
    await db.exec(MIGRATION)
    const r = await db.query(`select count(*)::int as n from pg_tables where schemaname = $1`, [S])
    expect(r.rows[0].n).toBe(6)
  })

  it('has row level security on every table, and no table privilege for anon', async () => {
    const r = await db.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') as anon
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'r'`, [S])
    expect(r.rows).toHaveLength(6)
    for (const t of r.rows) {
      expect(t.relrowsecurity, t.relname).toBe(true)
      // Account deletion runs as the migration role; forced RLS would make it delete nothing.
      expect(t.relforcerowsecurity, t.relname).toBe(false)
      expect(t.anon, t.relname).toBe(false)
    }
  })

  it('pins search_path on every function, and exposes only the intended ones to anon', async () => {
    const r = await db.query(`
      select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 order by p.proname`, [S])
    const byName = Object.fromEntries(r.rows.map((f) => [f.proname, f]))
    expect(Object.keys(byName)).toEqual([
      'contest_ballots', 'contest_feedback', 'contest_voters', 'contests_stay_out_of_draft',
      'create_contest_with_relations', 'get_contest', 'my_voter_contests', 'submit_vote',
    ])
    for (const f of r.rows) expect(f.proconfig, f.proname).toContain('search_path=""')
    expect(byName.create_contest_with_relations.prosecdef).toBe(false)
    expect(byName.contests_stay_out_of_draft.prosecdef).toBe(false)
    expect(r.rows.filter((f) => f.anon).map((f) => f.proname)).toEqual(['contest_ballots', 'get_contest', 'submit_vote'])
    expect(r.rows.filter((f) => !f.authed).map((f) => f.proname)).toEqual(['contests_stay_out_of_draft'])
  })

  it('makes 32-hex voting codes', async () => {
    const admin = await addUser(db, 'codes@example.org')
    const c = await makeContest(admin, { open: false })
    expect(c.vote_token).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('creating and managing a contest', () => {
  it('needs a signed-in admin and sane input', async () => {
    const admin = await addUser(db, 'admin1@example.org')
    const call = (who, opts, winners = 1, emails = null) => rpc(db, who,
      `${S}.create_contest_with_relations('T', null, $1, true, true, false, null, $2::jsonb, $3::text[])`, [winners, opts, emails])
    const two = '[{"title":"A"},{"title":"B"}]'
    expect(await code(call(null, two))).toBe('42501') // anon may not even call it
    expect(await code(call(admin, '[{"title":"A"},{"title":"  "}]'))).toBe('PT400')
    expect(await code(call(admin, two, 2))).toBe('PT400')
    expect(await code(call(admin, '{"title":"A"}'))).toBe('PT400')
    expect(await code(call(admin, JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ title: `O${i}` })))))).toBe('PT400')
    expect(await code(call(admin, JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ title: `O${i}` })))))).toBeNull()
    expect(await code(call(admin, two, 1, ['bob@']))).toBe('PT400')
    expect(await code(call(admin, two, 1, ['Bob@Example.org', ' @uw.edu ', '']))).toBeNull()
  })

  it('stores the voter list in lower case and keeps a contest to its admin', async () => {
    const admin = await addUser(db, 'admin2@example.org')
    const stranger = await addUser(db, 'stranger2@example.org')
    const c = await makeContest(admin, { emails: ['Ann@Example.org', '@UW.edu'], open: false })
    const mine = await as(db, admin, (tx) => tx.query(`select email from ${S}.allowed_voters where contest_id = $1 order by email`, [c.id]))
    expect(mine.rows.map((r) => r.email)).toEqual(['@uw.edu', 'ann@example.org'])
    for (const table of ['contests', 'contest_options', 'allowed_voters', 'votes']) {
      const seen = await as(db, stranger, (tx) => tx.query(`select count(*)::int as n from ${S}.${table}`))
      expect(seen.rows[0].n, table).toBe(0)
    }
    expect(await code(as(db, null, (tx) => tx.query(`select * from ${S}.contests`)))).toBe('42501')
    const upd = await as(db, stranger, (tx) => tx.query(`update ${S}.contests set title = 'mine' where id = $1`, [c.id]))
    expect(upd.affectedRows).toBe(0)
  })

  it('lets the admin edit settings but not the owner, code or id', async () => {
    const admin = await addUser(db, 'admin3@example.org')
    const other = await addUser(db, 'other3@example.org')
    const c = await makeContest(admin, { open: false })
    const ok = await as(db, admin, (tx) => tx.query(`update ${S}.contests set title = 'Renamed', status = 'open', submissions_open = true where id = $1`, [c.id]))
    expect(ok.affectedRows).toBe(1)
    expect(await code(as(db, admin, (tx) => tx.query(`update ${S}.contests set admin_id = $2 where id = $1`, [c.id, other])))).toBe('42501')
    expect(await code(as(db, admin, (tx) => tx.query(`update ${S}.contests set vote_token = 'x' where id = $1`, [c.id])))).toBe('42501')
    expect(await code(as(db, admin, (tx) => tx.query(`insert into ${S}.contests (admin_id, title) values ($1, 'Theirs')`, [other])))).toBe('42501')
  })

  it('never moves a contest back to draft once it has left it', async () => {
    const admin = await addUser(db, 'admin4b@example.org')
    const c = await makeContest(admin, { open: false })
    const setStatus = (status) => as(db, admin, (tx) => tx.query(`update ${S}.contests set status = $2 where id = $1`, [c.id, status]))
    // Edits to a draft, including writing 'draft' again, are fine.
    expect(await code(as(db, admin, (tx) => tx.query(`update ${S}.contests set title = 'Still a draft' where id = $1`, [c.id])))).toBeNull()
    expect(await code(setStatus('draft'))).toBeNull()
    expect(await code(setStatus('open'))).toBeNull()
    expect(await code(setStatus('draft'))).toBe('PT400')
    expect(await code(setStatus('closed'))).toBeNull()
    expect(await code(setStatus('draft'))).toBe('PT400')
    expect((await db.query(`select status from ${S}.contests where id = $1`, [c.id])).rows[0].status).toBe('closed')
  })

  it('keeps a ballot\'s options: no way back to draft, so no option can be removed after voting', async () => {
    const admin = await addUser(db, 'admin4c@example.org')
    const c = await makeContest(admin)
    expect(await code(vote(null, c, { token: 'draft-token-4c' }))).toBeNull()
    expect(await code(as(db, admin, (tx) => tx.query(`update ${S}.contests set status = 'draft' where id = $1`, [c.id])))).toBe('PT400')
    const del = await as(db, admin, (tx) => tx.query(`delete from ${S}.contest_options where id = $1`, [c.options[0].id]))
    expect(del.affectedRows).toBe(0)
    const ranks = await db.query(`select count(*)::int as n from ${S}.vote_rankings vr join ${S}.votes v on v.id = vr.vote_id where v.contest_id = $1`, [c.id])
    expect(ranks.rows[0].n).toBe(3)
  })

  it('changes options only while the contest is a draft', async () => {
    const admin = await addUser(db, 'admin4@example.org')
    const c = await makeContest(admin, { open: false })
    const add = (tx) => tx.query(`insert into ${S}.contest_options (contest_id, title, order_index) values ($1, 'D', 3)`, [c.id])
    await as(db, admin, add)
    await as(db, admin, (tx) => tx.query(`update ${S}.contests set status = 'open' where id = $1`, [c.id]))
    expect(await code(as(db, admin, add))).toBe('42501')
    const del = await as(db, admin, (tx) => tx.query(`delete from ${S}.contest_options where contest_id = $1`, [c.id]))
    expect(del.affectedRows).toBe(0)
  })
})

describe('get_contest', () => {
  it('answers anyone with the code, except for a draft, and never names the admin', async () => {
    const admin = await addUser(db, 'admin5@example.org')
    const draft = await makeContest(admin, { open: false })
    expect(await rpc(db, null, `${S}.get_contest($1)`, [draft.vote_token])).toBeNull()
    const c = await makeContest(admin, { emails: ['@uw.edu'] })
    const got = await rpc(db, null, `${S}.get_contest($1)`, [c.vote_token])
    expect(got.title).toBe('Board election')
    expect(got.require_login).toBe(true)
    expect(got.contest_options.map((o) => o.title)).toEqual(['A', 'B', 'C'])
    expect(JSON.stringify(got)).not.toContain(admin)
    expect(got).not.toHaveProperty('admin_id')
    expect(await rpc(db, null, `${S}.get_contest($1)`, ['0'.repeat(32)])).toBeNull()
    const open = await makeContest(admin)
    expect((await rpc(db, null, `${S}.get_contest($1)`, [open.vote_token])).require_login).toBe(false)
  })

  it('reads no code longer than 128 characters, in any of the code functions', async () => {
    const long = 'a'.repeat(129)
    expect(await rpc(db, null, `${S}.get_contest($1)`, [long])).toBeNull()
    expect(await code(rpc(db, null, `${S}.submit_vote($1, '[]'::jsonb, null, 'browser-token-long')`, [long]))).toBe('PT404')
    expect(await code(rpc(db, null, `${S}.submit_vote(null, '[]'::jsonb, null, 'browser-token-long')`))).toBe('PT404')
    expect(await code(rpc(db, null, `${S}.contest_ballots($1, null)`, [long]))).toBe('PT404')
    expect(await code(rpc(db, null, `${S}.contest_ballots(null, null)`))).toBe('PT404')
    expect(await rpc(db, null, `${S}.get_contest($1)`, ['a'.repeat(128)])).toBeNull()
  })
})

describe('submit_vote', () => {
  it('takes one anonymous ballot per browser when there is no voter list', async () => {
    const admin = await addUser(db, 'admin6@example.org')
    const c = await makeContest(admin)
    expect(await code(vote(null, c, { token: 'browser-token-1' }))).toBeNull()
    expect(await code(vote(null, c, { token: 'browser-token-1' }))).toBe('PT409')
    expect(await code(vote(null, c, { token: 'browser-token-2' }))).toBeNull()
    expect(await code(vote(null, c))).toBe('PT400') // no identity
    expect(await code(vote(null, c, { token: 'short' }))).toBe('PT400')
    const n = await db.query(`select count(*)::int as n from ${S}.votes where contest_id = $1`, [c.id])
    expect(n.rows[0].n).toBe(2)
  })

  it('counts a signed-in voter by their account, once', async () => {
    const admin = await addUser(db, 'admin7@example.org')
    const voter = await addUser(db, 'voter7@example.org')
    const c = await makeContest(admin)
    expect(await code(vote(voter, c, { token: 'ignored-token-7' }))).toBeNull()
    expect(await code(vote(voter, c, { token: 'another-token-7' }))).toBe('PT409')
    const row = await db.query(`select voter_id, voter_token from ${S}.votes where contest_id = $1`, [c.id])
    expect(row.rows).toEqual([{ voter_id: voter, voter_token: null }])
  })

  it('refuses an unknown code, a draft, a closed contest, the submission gate and a past end date', async () => {
    const admin = await addUser(db, 'admin8@example.org')
    const voter = await addUser(db, 'voter8@example.org')
    expect(await code(vote(voter, { vote_token: 'f'.repeat(32), options: [{ id: '00000000-0000-4000-8000-000000000000' }] }, { rankings: '[]' }))).toBe('PT404')
    const draft = await makeContest(admin, { open: false })
    expect(await code(vote(voter, draft))).toBe('PT404')
    const gated = await makeContest(admin, { gate: false })
    expect(await code(vote(voter, gated))).toBe('PT400')
    const closed = await makeContest(admin)
    await as(db, admin, (tx) => tx.query(`update ${S}.contests set status = 'closed' where id = $1`, [closed.id]))
    expect(await code(vote(voter, closed))).toBe('PT400')
    const ended = await makeContest(admin)
    await as(db, admin, (tx) => tx.query(`update ${S}.contests set end_date = now() - interval '1 minute' where id = $1`, [ended.id]))
    expect(await code(vote(voter, ended))).toBe('PT400')
    const future = await makeContest(admin)
    await as(db, admin, (tx) => tx.query(`update ${S}.contests set end_date = now() + interval '1 day' where id = $1`, [future.id]))
    expect(await code(vote(voter, future))).toBeNull()
  })

  it('applies the voter list: exact addresses and @domain rules, signed in only', async () => {
    const admin = await addUser(db, 'admin9@example.org')
    const ann = await addUser(db, 'Ann@Example.org')
    const uw = await addUser(db, 'bob@uw.edu')
    const sub = await addUser(db, 'carol@cs.uw.edu')
    const lookalike = await addUser(db, 'dan@evil-uw.edu')
    const outsider = await addUser(db, 'eve@example.org')
    const c = await makeContest(admin, { emails: ['ann@example.org', '@uw.edu'] })
    expect(await code(vote(null, c, { token: 'anon-token-9' }))).toBe('PT403')
    expect(await code(vote(outsider, c))).toBe('PT403')
    expect(await code(vote(sub, c))).toBe('PT403')
    expect(await code(vote(lookalike, c))).toBe('PT403')
    expect(await code(vote(ann, c))).toBeNull()
    expect(await code(vote(uw, c))).toBeNull()
  })

  it('needs every option ranked exactly once, ranks 1 to n', async () => {
    const admin = await addUser(db, 'admin10@example.org')
    const voter = await addUser(db, 'voter10@example.org')
    const c = await makeContest(admin)
    const other = await makeContest(admin)
    const [a, b, cc] = c.options.map((o) => o.id)
    const bad = [
      [{ option_id: a, rank: 1 }, { option_id: b, rank: 2 }],
      [{ option_id: a, rank: 1 }, { option_id: b, rank: 1 }, { option_id: cc, rank: 3 }],
      [{ option_id: a, rank: 1 }, { option_id: a, rank: 2 }, { option_id: cc, rank: 3 }],
      [{ option_id: a, rank: 0 }, { option_id: b, rank: 1 }, { option_id: cc, rank: 2 }],
      [{ option_id: a, rank: 1 }, { option_id: b, rank: 2 }, { option_id: cc, rank: 4 }],
      [{ option_id: a, rank: 1 }, { option_id: b, rank: 2 }, { option_id: other.options[0].id, rank: 3 }],
      [{ option_id: 'not-a-uuid', rank: 1 }, { option_id: b, rank: 2 }, { option_id: cc, rank: 3 }],
      [{ option_id: a, rank: '1' }, { option_id: b, rank: 2 }, { option_id: cc, rank: 3 }],
      [{ option_id: a, rank: 1.5 }, { option_id: b, rank: 2 }, { option_id: cc, rank: 3 }],
      [a, b, cc],
    ]
    for (const r of bad) expect(await code(vote(voter, c, { rankings: JSON.stringify(r) })), JSON.stringify(r)).toBe('PT400')
    expect(await code(vote(voter, c, { rankings: '{"a":1}' }))).toBe('PT400')
    expect(await code(vote(voter, c, { rankings: JSON.stringify([{ option_id: cc.toUpperCase(), rank: 1 }, { option_id: a, rank: 2 }, { option_id: b, rank: 3 }]) }))).toBeNull()
    const stored = await db.query(`select option_id, rank from ${S}.vote_rankings vr join ${S}.votes v on v.id = vr.vote_id where v.contest_id = $1 order by rank`, [c.id])
    expect(stored.rows.map((r) => r.option_id)).toEqual([cc, a, b])
  })

  it('checks comments: one per option of this contest, at most 2000 characters, and required when asked', async () => {
    const admin = await addUser(db, 'admin11@example.org')
    const c = await makeContest(admin, { comments: true })
    const other = await makeContest(admin)
    const [a, b, cc] = c.options.map((o) => o.id)
    const all = (text = 'fine') => [{ option_id: a, comment: text }, { option_id: b, comment: text }, { option_id: cc, comment: text }]
    const v = async (comments, n) => code(vote(null, c, { comments: JSON.stringify(comments), token: `comment-token-${n}` }))
    expect(await v(all().slice(0, 2), 1)).toBe('PT400')
    expect(await v([...all().slice(0, 2), { option_id: cc, comment: '   ' }], 2)).toBe('PT400')
    expect(await v([{ option_id: a, comment: 'one' }, { option_id: a, comment: 'again' }, { option_id: cc, comment: 'fine' }], 3)).toBe('PT400')
    expect(await v([{ option_id: a, comment: 'one' }, { option_id: b, comment: 'two' }, { option_id: other.options[0].id, comment: 'elsewhere' }], 4)).toBe('PT400')
    expect(await v(all('x'.repeat(2001)), 5)).toBe('PT400')
    expect(await v([{ option_id: a, comment: 7 }], 6)).toBe('PT400')
    expect(await code(vote(null, c, { comments: null, token: 'comment-token-7' }))).toBe('PT400')
    expect(await v(all('x'.repeat(2000)), 8)).toBeNull()
    expect(await v(all('  padded  '), 9)).toBeNull()
    const kept = await db.query(`select comment from ${S}.vote_comments vc join ${S}.votes v on v.id = vc.vote_id where v.voter_token = 'comment-token-9'`)
    expect(kept.rows.map((r) => r.comment)).toEqual(['padded', 'padded', 'padded'])

    // No more entries than options, blank or not, before any entry is read.
    expect(await v([...all(), { option_id: a, comment: ' ' }], 11)).toBe('PT400')
    expect(await v(Array.from({ length: 20000 }, () => ({ option_id: a, comment: ' ' })), 12)).toBe('PT400')

    const optional = await makeContest(admin)
    const [oa] = optional.options.map((o) => o.id)
    expect(await code(vote(null, optional, { comments: JSON.stringify([{ option_id: oa, comment: 'only one' }, { option_id: optional.options[1].id, comment: ' ' }]), token: 'comment-token-10' }))).toBeNull()
    const n = await db.query(`select count(*)::int as n from ${S}.vote_comments vc join ${S}.votes v on v.id = vc.vote_id where v.voter_token = 'comment-token-10'`)
    expect(n.rows[0].n).toBe(1)
    const blanks = optional.options.map((o) => ({ option_id: o.id, comment: ' ' }))
    expect(await code(vote(null, optional, { comments: JSON.stringify(blanks), token: 'comment-token-13' }))).toBeNull()
    expect(await code(vote(null, optional, { comments: JSON.stringify([...blanks, blanks[0]]), token: 'comment-token-14' }))).toBe('PT400')
  })
})

describe('reading ballots', () => {
  it('lets nobody read rankings or comments, or the anonymous token, through the tables', async () => {
    const admin = await addUser(db, 'admin12@example.org')
    const voter = await addUser(db, 'voter12@example.org')
    const c = await makeContest(admin)
    await vote(voter, c)
    for (const who of [admin, voter]) {
      expect(await code(as(db, who, (tx) => tx.query(`select * from ${S}.vote_rankings`)))).toBe('42501')
      expect(await code(as(db, who, (tx) => tx.query(`select * from ${S}.vote_comments`)))).toBe('42501')
    }
    const adminSees = await as(db, admin, (tx) => tx.query(`select id from ${S}.votes where contest_id = $1`, [c.id]))
    expect(adminSees.rows).toHaveLength(0)
    const own = await as(db, voter, (tx) => tx.query(`select id, contest_id, voter_id, created_at from ${S}.votes where contest_id = $1 and voter_id = $2`, [c.id, voter]))
    expect(own.rows).toHaveLength(1)
    expect(await code(as(db, voter, (tx) => tx.query(`select voter_token from ${S}.votes`)))).toBe('42501')
    expect(await code(as(db, voter, (tx) => tx.query(`insert into ${S}.votes (contest_id, voter_id) values ($1, $2)`, [c.id, voter])))).toBe('42501')
  })

  it('gives the results to the admin always, and to voters after voting when shown', async () => {
    const admin = await addUser(db, 'admin13@example.org')
    const voter = await addUser(db, 'voter13@example.org')
    const late = await addUser(db, 'late13@example.org')
    const c = await makeContest(admin)
    const ballots = (who, token = null) => rpc(db, who, `${S}.contest_ballots($1, $2)`, [c.vote_token, token])
    expect((await ballots(admin)).ballots).toEqual([])
    expect(await code(ballots(voter))).toBe('PT403')
    await vote(voter, c, { rankings: ballot(c.options, [2, 0, 1]) })
    await vote(null, c, { token: 'results-token-13' })
    const r = await ballots(voter)
    expect(r.contest).toEqual({ title: 'Board election', max_winners: 1 })
    expect(r.options.map((o) => o.title)).toEqual(['A', 'B', 'C'])
    expect(r.ballots).toHaveLength(2)
    const ids = c.options.map((o) => o.id)
    expect(r.ballots).toContainEqual([ids[2], ids[0], ids[1]])
    expect(r.ballots).toContainEqual(ids)
    expect(await code(ballots(null, 'results-token-13'))).toBeNull()
    expect(await code(ballots(null, 'wrong-token-13'))).toBe('PT403')
    expect(await code(ballots(null))).toBe('PT403')
    expect(await code(ballots(late))).toBe('PT403')
    expect(await code(rpc(db, null, `${S}.contest_ballots($1, null)`, ['e'.repeat(32)]))).toBe('PT404')

    await as(db, admin, (tx) => tx.query(`update ${S}.contests set results_visible_to_voters = false where id = $1`, [c.id]))
    expect(await code(ballots(voter))).toBe('PT403')
    expect(await code(ballots(null, 'results-token-13'))).toBe('PT403')
    expect((await ballots(admin)).ballots).toHaveLength(2)
  })

  it('tells the admin who voted and when, never how, and nobody else', async () => {
    const admin = await addUser(db, 'admin14@example.org')
    const voter = await addUser(db, 'voter14@example.org')
    const c = await makeContest(admin)
    await vote(voter, c)
    await vote(null, c, { token: 'voters-token-14' })
    const voters = await as(db, admin, (tx) => tx.query(`select * from ${S}.contest_voters($1)`, [c.id]))
    expect(voters.rows.map((r) => r.email)).toEqual(['voter14@example.org', null])
    expect(Object.keys(voters.rows[0]).sort()).toEqual(['email', 'voted_at'])
    const theirs = await as(db, voter, (tx) => tx.query(`select * from ${S}.contest_voters($1)`, [c.id]))
    expect(theirs.rows).toHaveLength(0)
    expect(await code(as(db, null, (tx) => tx.query(`select * from ${S}.contest_voters($1)`, [c.id])))).toBe('42501')
  })

  it('gives the admin the comments with average ranks, without ballots', async () => {
    const admin = await addUser(db, 'admin15@example.org')
    const voter = await addUser(db, 'voter15@example.org')
    const c = await makeContest(admin)
    const [a, b] = c.options.map((o) => o.id)
    await vote(voter, c, { rankings: ballot(c.options, [1, 0, 2]), comments: JSON.stringify([{ option_id: a, comment: 'Solid' }]) })
    await vote(null, c, { rankings: ballot(c.options, [1, 2, 0]), comments: JSON.stringify([{ option_id: b, comment: 'Best' }]), token: 'feedback-token-15' })
    const f = await rpc(db, admin, `${S}.contest_feedback($1)`, [c.id])
    expect(f.title).toBe('Board election')
    expect(f.options.map((o) => [o.title, o.avg_rank])).toEqual([['A', 2.5], ['B', 1], ['C', 2.5]])
    expect(f.comments).toHaveLength(2)
    expect(f.comments).toContainEqual({ option_id: a, comment: 'Solid' })
    for (const row of f.comments) expect(Object.keys(row).sort()).toEqual(['comment', 'option_id'])
    expect(await code(rpc(db, voter, `${S}.contest_feedback($1)`, [c.id]))).toBe('PT403')
  })
})

describe('my_voter_contests', () => {
  it('lists the contests a person voted in or is named on, never drafts or domain-only ones', async () => {
    const admin = await addUser(db, 'admin16@example.org')
    const me = await addUser(db, 'Me16@uw.edu')
    const named = await makeContest(admin, { emails: ['me16@uw.edu'] })
    const domainOnly = await makeContest(admin, { emails: ['@uw.edu'] })
    const voted = await makeContest(admin)
    await makeContest(admin, { emails: ['me16@uw.edu'], open: false })
    await vote(me, voted)
    const rows = await as(db, me, (tx) => tx.query(`select * from ${S}.my_voter_contests()`))
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]))
    expect(Object.keys(byId).sort()).toEqual([named.id, voted.id].sort())
    expect(byId[voted.id].has_voted).toBe(true)
    expect(byId[named.id].has_voted).toBe(false)
    expect(byId[domainOnly.id]).toBeUndefined()
    expect(await code(as(db, null, (tx) => tx.query(`select * from ${S}.my_voter_contests()`)))).toBe('42501')
  })
})

describe('account deletion', () => {
  it('takes a deleted voter\'s ballots, rankings and comments with the account', async () => {
    const admin = await addUser(db, 'admin17@example.org')
    const voter = await addUser(db, 'voter17@example.org')
    const c = await makeContest(admin)
    await vote(voter, c, { comments: JSON.stringify([{ option_id: c.options[0].id, comment: 'Mine' }]) })
    await vote(null, c, { token: 'deletion-token-17' })
    await db.query('delete from auth.users where id = $1', [voter])
    const left = await db.query(`select voter_id, voter_token from ${S}.votes where contest_id = $1`, [c.id])
    expect(left.rows).toEqual([{ voter_id: null, voter_token: 'deletion-token-17' }])
    const comments = await db.query(`select count(*)::int as n from ${S}.vote_comments vc join ${S}.contest_options o on o.id = vc.option_id where o.contest_id = $1`, [c.id])
    expect(comments.rows[0].n).toBe(0)
    const rankings = await db.query(`select count(*)::int as n from ${S}.vote_rankings vr join ${S}.contest_options o on o.id = vr.option_id where o.contest_id = $1`, [c.id])
    expect(rankings.rows[0].n).toBe(3)
    expect((await rpc(db, admin, `${S}.contest_ballots($1, null)`, [c.vote_token])).ballots).toHaveLength(1)
  })

  it('never holds two ballots for one listed address: a returning voter votes again only because the first ballot is gone', async () => {
    const admin = await addUser(db, 'admin18@example.org')
    const c = await makeContest(admin, { emails: ['v18@example.org'] })
    const ballots = async () => (await db.query(`select count(*)::int as n from ${S}.votes where contest_id = $1`, [c.id])).rows[0].n
    const first = await addUser(db, 'v18@example.org')
    expect(await code(vote(first, c))).toBeNull()
    expect(await code(vote(first, c))).toBe('PT409')
    // What "Delete my account" does: platform.delete_hintwise_data deletes the rows whose key
    // cascades, then the Auth admin API deletes the sign-in (which would cascade anyway).
    await db.query(`delete from ${S}.votes where voter_id = $1`, [first])
    await db.query('delete from auth.users where id = $1', [first])
    expect(await ballots()).toBe(0)
    const again = await addUser(db, 'v18@example.org') // same address, new account
    expect(await code(vote(again, c))).toBeNull()
    expect(await ballots()).toBe(1)
    expect(await code(vote(again, c))).toBe('PT409')
    expect(await ballots()).toBe(1)
    // Deleting the sign-in alone (no platform step first) cascades the same way.
    await db.query('delete from auth.users where id = $1', [again])
    expect(await ballots()).toBe(0)
  })

  it('removes a deleted admin\'s contests with everything under them', async () => {
    const admin = await addUser(db, 'admin19@example.org')
    const c = await makeContest(admin)
    await vote(null, c, { token: 'deletion-token-19' })
    await db.query('delete from auth.users where id = $1', [admin])
    for (const table of ['contests', 'contest_options', 'votes']) {
      const left = await db.query(`select count(*)::int as n from ${S}.${table} where ${table === 'contests' ? 'id' : 'contest_id'} = $1`, [c.id])
      expect(left.rows[0].n, table).toBe(0)
    }
  })

  it('keeps every ballot either a signed-in voter\'s or an anonymous browser\'s, never both or neither', async () => {
    const admin = await addUser(db, 'admin20@example.org')
    const voter = await addUser(db, 'voter20@example.org')
    const c = await makeContest(admin)
    const insert = (voterId, token) => db.query(`insert into ${S}.votes (contest_id, voter_id, voter_token) values ($1, $2, $3)`, [c.id, voterId, token])
    expect(await code(insert(null, null))).toBe('23514')
    expect(await code(insert(voter, 'browser-token-20'))).toBe('23514')
  })
})
