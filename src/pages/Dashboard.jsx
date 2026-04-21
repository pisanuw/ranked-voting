import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDistanceToNow } from 'date-fns'

const STATUS_COLORS = {
  draft:  'bg-slate-100 text-slate-600',
  open:   'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const [contests, setContests] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('contests')
        .select('id, title, status, created_at, vote_token, max_winners, end_date')
        .eq('admin_id', user.id)
        .order('created_at', { ascending: false })
      setContests(data ?? [])
      setLoading(false)
    }
    load()
  }, [user.id])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-bold text-brand-700">
          <span>🗳️</span> RankedVote
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 hidden sm:block">{user.email}</span>
          <button onClick={signOut} className="btn-ghost text-sm">Sign out</button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">My Contests</h1>
          <Link to="/contest/new" className="btn-primary">
            + New Contest
          </Link>
        </div>

        {loading && (
          <div className="text-center py-12 text-slate-400">Loading…</div>
        )}

        {!loading && contests.length === 0 && (
          <div className="card p-12 text-center space-y-3">
            <div className="text-5xl">🗳️</div>
            <p className="text-slate-600 font-medium">No contests yet</p>
            <p className="text-sm text-slate-400">Create your first ranked-choice contest to get started.</p>
            <Link to="/contest/new" className="btn-primary inline-flex">Create a contest</Link>
          </div>
        )}

        {!loading && contests.length > 0 && (
          <div className="space-y-3">
            {contests.map(c => (
              <div key={c.id} className="card p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-slate-900 truncate">{c.title}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[c.status]}`}>
                      {c.status}
                    </span>
                    {c.max_winners > 1 && (
                      <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">
                        {c.max_winners} winners
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Created {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    {c.end_date && ` · Ends ${formatDistanceToNow(new Date(c.end_date), { addSuffix: true })}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.status !== 'draft' && (
                    <Link
                      to={`/results/${c.vote_token}`}
                      className="btn-secondary text-xs"
                    >
                      Results
                    </Link>
                  )}
                  <Link to={`/admin/${c.id}`} className="btn-primary text-xs">
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
