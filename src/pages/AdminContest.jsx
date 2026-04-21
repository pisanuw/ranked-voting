import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDistanceToNow, format } from 'date-fns'

const STATUS_COLORS = {
  draft:  'bg-slate-100 text-slate-600',
  open:   'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

export default function AdminContest() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [contest, setContest]       = useState(null)
  const [options, setOptions]       = useState([])
  const [allowed, setAllowed]       = useState([])
  const [voteCount, setVoteCount]   = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  // Editing state
  const [editMode, setEditMode]     = useState(false)
  const [editData, setEditData]     = useState({})
  const [newEmail, setNewEmail]     = useState('')
  const [newOption, setNewOption]   = useState('')
  const [saving, setSaving]         = useState(false)

  const load = useCallback(async () => {
    const { data: c, error: cErr } = await supabase
      .from('contests')
      .select('*')
      .eq('id', id)
      .eq('admin_id', user.id)
      .single()

    if (cErr || !c) { setError('Contest not found or access denied.'); setLoading(false); return }

    const [{ data: opts }, { data: avs }, { count }] = await Promise.all([
      supabase.from('contest_options').select('*').eq('contest_id', id).order('order_index'),
      supabase.from('allowed_voters').select('*').eq('contest_id', id).order('email'),
      supabase.from('votes').select('id', { count: 'exact', head: true }).eq('contest_id', id),
    ])

    setContest(c)
    setOptions(opts ?? [])
    setAllowed(avs ?? [])
    setVoteCount(count ?? 0)
    setEditData({
      title:                     c.title,
      description:               c.description ?? '',
      max_winners:               c.max_winners,
      require_login:             c.require_login,
      results_visible_to_voters: c.results_visible_to_voters,
      randomize_options:         c.randomize_options,
      end_date:                  c.end_date ? format(new Date(c.end_date), "yyyy-MM-dd'T'HH:mm") : '',
    })
    setLoading(false)
  }, [id, user.id])

  useEffect(() => { load() }, [load])

  async function saveSettings(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('contests')
      .update({
        title:                     editData.title,
        description:               editData.description || null,
        max_winners:               editData.max_winners,
        require_login:             editData.require_login,
        results_visible_to_voters: editData.results_visible_to_voters,
        randomize_options:         editData.randomize_options,
        end_date:                  editData.end_date || null,
      })
      .eq('id', id)
    setSaving(false)
    if (error) { alert(error.message); return }
    setEditMode(false)
    load()
  }

  async function setStatus(status) {
    if (!confirm(`Set contest to "${status}"?`)) return
    await supabase.from('contests').update({ status }).eq('id', id)
    load()
  }

  async function addAllowedEmail() {
    const email = newEmail.trim().toLowerCase()
    if (!email.includes('@')) return
    await supabase.from('allowed_voters').insert({ contest_id: id, email })
    setNewEmail('')
    load()
  }

  async function removeAllowedEmail(avId) {
    await supabase.from('allowed_voters').delete().eq('id', avId)
    load()
  }

  async function addOption() {
    const title = newOption.trim()
    if (!title) return
    if (contest.status !== 'draft') { alert('Cannot add options after contest has opened.'); return }
    await supabase.from('contest_options').insert({
      contest_id: id, title, order_index: options.length
    })
    setNewOption('')
    load()
  }

  async function removeOption(optId) {
    if (contest.status !== 'draft') { alert('Cannot remove options after contest has opened.'); return }
    if (options.length <= 2) { alert('A contest needs at least 2 options.'); return }
    if (!confirm('Remove this option?')) return
    await supabase.from('contest_options').delete().eq('id', optId)
    load()
  }

  const voteUrl    = `${window.location.origin}/vote/${contest?.vote_token}`
  const resultsUrl = `${window.location.origin}/results/${contest?.vote_token}`

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  if (error)   return <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-700 text-sm">← Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700 truncate">{contest.title}</span>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{contest.title}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[contest.status]}`}>
                {contest.status}
              </span>
            </div>
            {contest.description && <p className="text-slate-500 text-sm mt-1">{contest.description}</p>}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {contest.status === 'draft' && (
              <button onClick={() => setStatus('open')} className="btn-primary text-sm">Open Contest</button>
            )}
            {contest.status === 'open' && (
              <button onClick={() => setStatus('closed')} className="btn-danger text-sm">Close Contest</button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Votes Cast" value={voteCount} />
          <StatCard label="Options" value={options.length} />
          <StatCard label="Winners" value={contest.max_winners} />
        </div>

        {/* Share links */}
        {contest.status !== 'draft' && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">Share Links</h2>
            <ShareRow label="Voting link" url={voteUrl} onCopy={() => copyToClipboard(voteUrl)} />
            <ShareRow label="Results link" url={resultsUrl} onCopy={() => copyToClipboard(resultsUrl)} />
          </div>
        )}

        {/* Options */}
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-slate-800">Options</h2>
          {options.map(o => (
            <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-slate-800">{o.title}</p>
                {o.description && <p className="text-xs text-slate-400">{o.description}</p>}
              </div>
              {contest.status === 'draft' && (
                <button onClick={() => removeOption(o.id)} className="btn-ghost text-slate-400 text-xs px-2">✕</button>
              )}
            </div>
          ))}
          {contest.status === 'draft' && (
            <div className="flex gap-2 mt-2">
              <input className="input flex-1 text-sm" value={newOption}
                onChange={e => setNewOption(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())}
                placeholder="New option title…" />
              <button onClick={addOption} className="btn-secondary text-sm">Add</button>
            </div>
          )}
        </div>

        {/* Allowed voters */}
        <div className="card p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-800">Voter Whitelist</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {allowed.length === 0
                ? 'Open to any logged-in user.'
                : `${allowed.length} email${allowed.length !== 1 ? 's' : ''} allowed.`}
            </p>
          </div>
          {allowed.map(av => (
            <div key={av.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0">
              <span className="text-slate-700">{av.email}</span>
              <button onClick={() => removeAllowedEmail(av.id)} className="btn-ghost text-slate-400 text-xs px-2">✕</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input flex-1 text-sm" type="email" value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAllowedEmail())}
              placeholder="voter@example.com" />
            <button onClick={addAllowedEmail} className="btn-secondary text-sm">Add</button>
          </div>
        </div>

        {/* Settings */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Settings</h2>
            {!editMode && (
              <button onClick={() => setEditMode(true)} className="btn-secondary text-sm">Edit</button>
            )}
          </div>

          {editMode ? (
            <form onSubmit={saveSettings} className="space-y-4">
              <div className="field">
                <label className="label">Title</label>
                <input className="input" required value={editData.title}
                  onChange={e => setEditData(d => ({ ...d, title: e.target.value }))} />
              </div>
              <div className="field">
                <label className="label">Description</label>
                <textarea className="input" rows={2} value={editData.description}
                  onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="field">
                  <label className="label">Winners</label>
                  <input className="input" type="number" min={1} value={editData.max_winners}
                    onChange={e => setEditData(d => ({ ...d, max_winners: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="field">
                  <label className="label">End Date</label>
                  <input className="input" type="datetime-local" value={editData.end_date}
                    onChange={e => setEditData(d => ({ ...d, end_date: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-3">
                {[
                  ['require_login',             'Require login to vote'],
                  ['results_visible_to_voters', 'Results visible to all voters'],
                  ['randomize_options',         'Randomize option order per voter'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editData[key]}
                      onChange={e => setEditData(d => ({ ...d, [key]: e.target.checked }))}
                      className="w-4 h-4 text-brand-600 rounded border-slate-300" />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setEditMode(false)} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <SettingRow label="Winners" value={contest.max_winners} />
              <SettingRow label="End Date" value={contest.end_date ? format(new Date(contest.end_date), 'PPp') : 'None'} />
              <SettingRow label="Require Login" value={contest.require_login ? 'Yes' : 'No'} />
              <SettingRow label="Results Visible" value={contest.results_visible_to_voters ? 'All voters' : 'Admin only'} />
              <SettingRow label="Randomize" value={contest.randomize_options ? 'Yes (per voter)' : 'No'} />
            </dl>
          )}
        </div>

        {/* Results link */}
        {contest.status !== 'draft' && (
          <div className="text-center">
            <Link to={`/results/${contest.vote_token}`} className="btn-primary">
              View Results & IRV Simulation →
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="card p-4 text-center">
      <p className="text-2xl font-bold text-brand-700">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

function ShareRow({ label, url, onCopy }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <div className="flex gap-2">
        <input readOnly className="input text-xs font-mono flex-1 bg-slate-50" value={url} />
        <button onClick={onCopy} className="btn-secondary text-xs flex-shrink-0">Copy</button>
      </div>
    </div>
  )
}

function SettingRow({ label, value }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </>
  )
}
