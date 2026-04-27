import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import IRVRounds from '../components/results/IRVRounds'

function getAnonymousToken(voteToken) {
  return localStorage.getItem(`rv_voter_${voteToken}`)
}

export default function ResultsPage() {
  const { token } = useParams()

  const [results, setResults] = useState(null)
  const [pageState, setPageState] = useState('loading') // loading | forbidden | error | ready

  useEffect(() => {
    async function load() {
      // Pass auth token if available (needed for admin-only results)
      const { data: { session } } = await supabase.auth.getSession()
      const authToken = session?.access_token

      const headers = {}
      if (authToken) headers.Authorization = `Bearer ${authToken}`

      const anonymousToken = getAnonymousToken(token)
      if (anonymousToken) headers['X-Voter-Token'] = anonymousToken

      const res = await fetch(`/api/get-results?token=${token}`, { headers })

      if (res.status === 403) { setPageState('forbidden'); return }
      if (!res.ok)            { setPageState('error'); return }

      const data = await res.json()
      setResults(data)
      setPageState('ready')
    }
    load()
  }, [token])

  if (pageState === 'loading') {
    return <Centered><p className="text-slate-400">Loading results…</p></Centered>
  }

  if (pageState === 'forbidden') {
    return (
      <Centered>
        <div className="text-center space-y-3">
          <div className="text-5xl">🔒</div>
          <p className="font-semibold text-slate-800">Results are not yet available</p>
          <p className="text-sm text-slate-500">
            Either you haven't voted yet, or the admin has restricted results visibility.
          </p>
          <Link to="/dashboard" className="btn-secondary inline-flex text-sm">Go to Dashboard</Link>
        </div>
      </Centered>
    )
  }

  if (pageState === 'error') {
    return (
      <Centered>
        <div className="text-center space-y-3">
          <p className="font-semibold text-red-600">Could not load results</p>
          <p className="text-sm text-slate-500">The contest may not exist or the link is invalid.</p>
        </div>
      </Centered>
    )
  }

  const { contest, options, total_votes, quota, rounds, winners } = results

  const optionMap = Object.fromEntries((options ?? []).map(o => [o.id, o]))
  const winnerOptions = (winners ?? []).map(id => optionMap[id]).filter(Boolean)

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-700 text-sm">← Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700 truncate">{contest.title} — Results</span>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">{contest.title}</h1>
          <p className="text-sm text-slate-500">{total_votes} ballot{total_votes !== 1 ? 's' : ''} cast</p>
        </div>

        {total_votes === 0 ? (
          <div className="card p-12 text-center space-y-3">
            <div className="text-5xl">📭</div>
            <p className="font-semibold text-slate-700">No votes yet</p>
            <p className="text-sm text-slate-400">Results will appear once voters submit their ballots.</p>
          </div>
        ) : (
          <>
            {/* Winners */}
            <div className="card p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-800">
                {winnerOptions.length === 1 ? 'Winner' : `Winners (${winnerOptions.length})`}
              </h2>
              <div className="space-y-2">
                {winnerOptions.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-3 p-3 bg-brand-50 border border-brand-200 rounded-lg">
                    <span className="text-2xl">{['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`}</span>
                    <div>
                      <p className="font-semibold text-brand-900">{o.title}</p>
                      {o.description && <p className="text-xs text-brand-700">{o.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* IRV simulation */}
            <IRVRounds rounds={rounds} optionMap={optionMap} totalVotes={total_votes} quota={quota} />
          </>
        )}
      </main>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      {children}
    </div>
  )
}
