import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import DragDropBallot from '../components/ballot/DragDropBallot'

function getStorageKey(prefix, voteToken) {
  return `${prefix}_${voteToken}`
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Persistent anonymous voter token per contest URL
function getAnonymousToken(voteToken) {
  const key = getStorageKey('rv_voter', voteToken)
  let token = localStorage.getItem(key)
  if (!token) { token = crypto.randomUUID(); localStorage.setItem(key, token) }
  return token
}

function hasVoted(voteToken) {
  return !!localStorage.getItem(getStorageKey('rv_voted', voteToken))
}

function markVoted(voteToken) {
  localStorage.setItem(getStorageKey('rv_voted', voteToken), '1')
}

export default function VotingPage() {
  const { token } = useParams()
  const { user, loading: authLoading, signInWithGoogle, signInWithMagicLink } = useAuth()

  const [contest, setContest]         = useState(null)
  const [options, setOptions]         = useState([])
  const [pageState, setPageState]     = useState('loading') // loading | needLogin | notAllowed | open | alreadyVoted | submitted | closed | notFound
  const [ranked, setRanked]           = useState([])
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Magic link state (inline mini-login)
  const [magicEmail, setMagicEmail]   = useState('')
  const [magicSent, setMagicSent]     = useState(false)

  useEffect(() => {
    if (authLoading) return

    async function load() {
      // Fetch contest via server-side function — never uses the anon key for DB reads,
      // preventing enumeration of all contests by anyone who extracts the anon key.
      const res = await fetch(`/api/get-contest?token=${token}`)
      if (!res.ok) { setPageState('notFound'); return }
      const c = await res.json()

      setContest(c)

      // Closed?
      const isPastEndDate = c.end_date && new Date(c.end_date) < new Date()
      if (c.status === 'closed' || isPastEndDate) { setPageState('closed'); return }
      if (c.status === 'draft') { setPageState('notFound'); return }

      // Needs login?
      if (c.require_login && !user) { setPageState('needLogin'); return }

      // Already voted (authenticated)?
      if (user) {
        const { data: existing } = await supabase
          .from('votes')
          .select('id')
          .eq('contest_id', c.id)
          .eq('voter_id', user.id)
          .maybeSingle()
        if (existing) { setPageState('alreadyVoted'); return }

        // Whitelist check is enforced server-side in submit-vote;
        // allowed_voters is admin-only via RLS so we can't read it here anyway.
      } else {
        // Anonymous — check localStorage
        if (hasVoted(token)) { setPageState('alreadyVoted'); return }
      }

      // Prepare ballot
      const opts = c.contest_options ?? []
      const ordered = c.randomize_options ? shuffle(opts) : [...opts].sort((a, b) => a.order_index - b.order_index)
      setOptions(ordered)
      setRanked(ordered)
      setPageState('open')
    }

    load()
  }, [token, user, authLoading])

  async function handleSubmit() {
    if (ranked.length !== options.length) {
      setSubmitError('Please rank all options before submitting.')
      return
    }
    setSubmitError('')
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token ?? null

    const body = {
      contest_vote_token: token,
      rankings: ranked.map((opt, i) => ({ option_id: opt.id, rank: i + 1 })),
      voter_token: user ? null : getAnonymousToken(token),
      auth_token:  authToken,
    }

    const res = await fetch('/api/submit-vote', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    const data = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      if (res.status === 403) {
        setPageState('notAllowed')
        return
      }
      setSubmitError(data.error ?? 'Failed to submit vote. Please try again.')
      return
    }

    if (!user) markVoted(token)
    setPageState('submitted')
  }

  async function handleMagicLink(e) {
    e.preventDefault()
    await signInWithMagicLink(magicEmail)
    setMagicSent(true)
  }

  // ─── Render states ────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return <CenteredLayout><p className="text-slate-400">Loading…</p></CenteredLayout>
  }

  if (pageState === 'notFound') {
    return (
      <CenteredLayout>
        <div className="text-center space-y-3">
          <div className="text-5xl">🔍</div>
          <p className="font-semibold text-slate-800">Contest not found</p>
          <p className="text-sm text-slate-500">This link may be invalid or the contest hasn't opened yet.</p>
        </div>
      </CenteredLayout>
    )
  }

  if (pageState === 'closed') {
    return (
      <CenteredLayout>
        <div className="text-center space-y-3">
          <div className="text-5xl">🔒</div>
          <p className="font-semibold text-slate-800">Voting is closed</p>
          <p className="text-sm text-slate-500">This contest has ended. Thank you to everyone who participated.</p>
        </div>
      </CenteredLayout>
    )
  }

  if (pageState === 'notAllowed') {
    return (
      <CenteredLayout>
        <div className="text-center space-y-3">
          <div className="text-5xl">🚫</div>
          <p className="font-semibold text-slate-800">Not on the voter list</p>
          <p className="text-sm text-slate-500">
            Your email (<strong>{user?.email}</strong>) is not authorized to vote in this contest.
          </p>
          <p className="text-xs text-slate-400">Contact the contest organizer if you think this is an error.</p>
        </div>
      </CenteredLayout>
    )
  }

  if (pageState === 'needLogin') {
    return (
      <CenteredLayout>
        <div className="card w-full max-w-md p-8 space-y-5">
          <div className="text-center space-y-1">
            <div className="text-3xl">🗳️</div>
            <h1 className="text-xl font-bold">{contest?.title}</h1>
            <p className="text-sm text-slate-500">Sign in to cast your vote</p>
          </div>
          <button onClick={signInWithGoogle} className="btn-secondary w-full py-2.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center text-xs text-slate-400"><span className="bg-white px-2">or magic link</span></div>
          </div>
          {magicSent ? (
            <p className="text-center text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
              Magic link sent to <strong>{magicEmail}</strong>!
            </p>
          ) : (
            <form onSubmit={handleMagicLink} className="flex gap-2">
              <input className="input flex-1 text-sm" type="email" required
                value={magicEmail} onChange={e => setMagicEmail(e.target.value)}
                placeholder="your@email.com" />
              <button type="submit" className="btn-primary text-sm flex-shrink-0">Send link</button>
            </form>
          )}
        </div>
      </CenteredLayout>
    )
  }

  if (pageState === 'alreadyVoted') {
    return (
      <CenteredLayout>
        <div className="text-center space-y-3">
          <div className="text-5xl">✅</div>
          <p className="font-semibold text-slate-800">You've already voted!</p>
          <p className="text-sm text-slate-500">Your ballot for <strong>{contest?.title}</strong> has been recorded.</p>
          {contest?.results_visible_to_voters && (
            <Link to={`/results/${token}`} className="btn-primary inline-flex">View Results</Link>
          )}
        </div>
      </CenteredLayout>
    )
  }

  if (pageState === 'submitted') {
    return (
      <CenteredLayout>
        <div className="text-center space-y-3">
          <div className="text-5xl">🎉</div>
          <p className="font-semibold text-slate-800">Vote submitted!</p>
          <p className="text-sm text-slate-500">Thanks for participating in <strong>{contest?.title}</strong>.</p>
          {contest?.results_visible_to_voters && (
            <Link to={`/results/${token}`} className="btn-primary inline-flex">View Results</Link>
          )}
        </div>
      </CenteredLayout>
    )
  }

  // Open state — show ballot
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">{contest.title}</h1>
          {contest.description && <p className="text-slate-500 text-sm">{contest.description}</p>}
        </div>

        <div className="card p-4 bg-brand-50 border-brand-200">
          <p className="text-sm text-brand-800">
            <strong>How to vote:</strong> Drag the options to rank them from most preferred (top) to least preferred (bottom).
            All {options.length} options must be ranked.
          </p>
        </div>

        <DragDropBallot items={ranked} onChange={setRanked} />

        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{submitError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary w-full py-3 text-base"
        >
          {submitting ? 'Submitting…' : 'Submit My Vote'}
        </button>
      </div>
    </div>
  )
}

function CenteredLayout({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      {children}
    </div>
  )
}
