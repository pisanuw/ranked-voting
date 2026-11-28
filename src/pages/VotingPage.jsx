import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import PrivacyNote from '../components/PrivacyNote'
import SignIn from '../components/SignIn'
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
  const { user, loading: authLoading } = useAuth()

  const [contest, setContest]         = useState(null)
  const [options, setOptions]         = useState([])
  const [pageState, setPageState]     = useState('loading') // loading | needLogin | notAllowed | open | alreadyVoted | submitted | closed | notFound
  const [ranked, setRanked]           = useState([])
  const [comments, setComments]       = useState({}) // { optionId: text }
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState('')

  const ballotInitialized             = useRef(false)

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

      // Prepare ballot: sort/shuffle once, then persist the order so
      // re-renders (e.g. auth state changes) never re-shuffle.
      if (!ballotInitialized.current) {
        const opts = c.contest_options ?? []
        const optsById = Object.fromEntries(opts.map(o => [o.id, o]))
        const orderKey = getStorageKey('rv_order', token)
        const rankedKey = getStorageKey('rv_ranked', token)

        // Restore initial shuffle order
        const savedOrder = localStorage.getItem(orderKey)
        let ordered = null
        if (savedOrder) {
          const savedIds = JSON.parse(savedOrder)
          ordered = savedIds.map(id => optsById[id]).filter(Boolean)
          if (ordered.length !== opts.length) ordered = null
        }
        if (!ordered) {
          ordered = c.randomize_options
            ? shuffle(opts)
            : [...opts].sort((a, b) => a.order_index - b.order_index)
          localStorage.setItem(orderKey, JSON.stringify(ordered.map(o => o.id)))
        }

        // Restore in-progress ranking (user's drag-and-drop order)
        const savedRanked = localStorage.getItem(rankedKey)
        let rankedOrder = null
        if (savedRanked) {
          const rankedIds = JSON.parse(savedRanked)
          rankedOrder = rankedIds.map(id => optsById[id]).filter(Boolean)
          if (rankedOrder.length !== opts.length) rankedOrder = null
        }

        // Restore saved comments
        const commentsKey = getStorageKey('rv_comments', token)
        const savedComments = localStorage.getItem(commentsKey)
        if (savedComments) {
          setComments(JSON.parse(savedComments))
        }

        setOptions(ordered)
        setRanked(rankedOrder ?? ordered)
        ballotInitialized.current = true
      }
      setPageState('open')
    }

    load()
  }, [token, user, authLoading])

  async function handleSubmit() {
    if (ranked.length !== options.length) {
      setSubmitError('Please rank all options before submitting.')
      return
    }
    if (!contest?.submissions_open) {
      setSubmitError('Submissions are not open yet. You can rank and comment now, then come back to submit.')
      return
    }
    if (contest?.comments_required && !options.every(o => (comments[o.id] ?? '').trim())) {
      setSubmitError('A comment is required for every option before you can submit.')
      return
    }
    setSubmitError('')
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token ?? null

    const voteComments = Object.entries(comments)
      .filter(([, text]) => text.trim())
      .map(([option_id, comment]) => ({ option_id, comment: comment.trim() }))

    const body = {
      contest_vote_token: token,
      rankings: ranked.map((opt, i) => ({ option_id: opt.id, rank: i + 1 })),
      voter_token: user ? null : getAnonymousToken(token),
      auth_token:  authToken,
      comments: voteComments.length > 0 ? voteComments : null,
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
    // Clean up in-progress state from localStorage
    localStorage.removeItem(getStorageKey('rv_ranked', token))
    localStorage.removeItem(getStorageKey('rv_comments', token))
    setPageState('submitted')
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
          {/* Google, or a 6-digit code by email; either way sign-in comes back to this ballot. */}
          <SignIn inline />
        </div>
        <PrivacyNote className="w-full max-w-md" />
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
            {contest.comments_required && ' A comment is required for every option.'}
          </p>
        </div>

        {!contest.submissions_open && (
          <div className="card p-4 bg-amber-50 border-amber-200">
            <p className="text-sm text-amber-800">
              <strong>Submissions aren't open yet.</strong> You can rank the options and write comments now —
              your progress is saved on this device. Come back to submit once the organizer opens submissions.
            </p>
          </div>
        )}

        <DragDropBallot
          items={ranked}
          commentsRequired={contest.comments_required}
          onChange={(newRanked) => {
            setRanked(newRanked)
            localStorage.setItem(
              getStorageKey('rv_ranked', token),
              JSON.stringify(newRanked.map(o => o.id))
            )
          }}
          comments={comments}
          onCommentChange={(optionId, text) => {
            setComments(prev => {
              const updated = { ...prev, [optionId]: text }
              localStorage.setItem(
                getStorageKey('rv_comments', token),
                JSON.stringify(updated)
              )
              return updated
            })
          }}
        />

        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{submitError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !contest.submissions_open}
          className="btn-primary w-full py-3 text-base"
        >
          {!contest.submissions_open
            ? 'Submissions not open yet'
            : submitting ? 'Submitting…' : 'Submit My Vote'}
        </button>

        <PrivacyNote />
      </div>
    </div>
  )
}

function CenteredLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      {children}
    </div>
  )
}
