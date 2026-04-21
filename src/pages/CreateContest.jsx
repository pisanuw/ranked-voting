import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function CreateContest() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [title, setTitle]                     = useState('')
  const [description, setDescription]         = useState('')
  const [maxWinners, setMaxWinners]            = useState(1)
  const [requireLogin, setRequireLogin]        = useState(true)
  const [resultsVisible, setResultsVisible]    = useState(true)
  const [randomizeOptions, setRandomize]       = useState(true)
  const [endDate, setEndDate]                  = useState('')
  const [options, setOptions]                  = useState([{ title: '', description: '' }, { title: '', description: '' }])
  const [allowedEmails, setAllowedEmails]      = useState('')
  const [error, setError]                      = useState('')
  const [saving, setSaving]                    = useState(false)

  function addOption() {
    setOptions(prev => [...prev, { title: '', description: '' }])
  }

  function removeOption(i) {
    if (options.length <= 2) return
    setOptions(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateOption(i, field, val) {
    setOptions(prev => prev.map((o, idx) => idx === i ? { ...o, [field]: val } : o))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validOptions = options.filter(o => o.title.trim())
    if (validOptions.length < 2) {
      setError('At least 2 options are required.')
      return
    }
    if (maxWinners >= validOptions.length) {
      setError('Number of winners must be less than the number of options.')
      return
    }

    setSaving(true)

    // Create contest
    const { data: contest, error: cErr } = await supabase
      .from('contests')
      .insert({
        admin_id:                  user.id,
        title:                     title.trim(),
        description:               description.trim() || null,
        max_winners:               maxWinners,
        require_login:             requireLogin,
        results_visible_to_voters: resultsVisible,
        randomize_options:         randomizeOptions,
        end_date:                  endDate || null,
        status:                    'draft',
      })
      .select()
      .single()

    if (cErr) { setError(cErr.message); setSaving(false); return }

    // Insert options
    const { error: oErr } = await supabase
      .from('contest_options')
      .insert(
        validOptions.map((o, i) => ({
          contest_id:  contest.id,
          title:       o.title.trim(),
          description: o.description.trim() || null,
          order_index: i,
        }))
      )

    if (oErr) { setError(oErr.message); setSaving(false); return }

    // Insert allowed voters if provided
    const emails = allowedEmails
      .split(/[\n,]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.includes('@'))

    if (emails.length > 0) {
      const { error: vErr } = await supabase
        .from('allowed_voters')
        .insert(emails.map(email => ({ contest_id: contest.id, email })))
      if (vErr) { setError(vErr.message); setSaving(false); return }
    }

    navigate(`/admin/${contest.id}`)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <Link to="/dashboard" className="text-slate-400 hover:text-slate-700 text-sm">← Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">New Contest</span>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Create a Contest</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic info */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Basic Information</h2>

            <div className="field">
              <label className="label">Contest Title *</label>
              <input className="input" required value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Best team lunch spot" />
            </div>

            <div className="field">
              <label className="label">Description <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Additional context for voters…" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="field">
                <label className="label">Number of Winners</label>
                <input className="input" type="number" min={1} value={maxWinners}
                  onChange={e => setMaxWinners(parseInt(e.target.value) || 1)} />
              </div>
              <div className="field">
                <label className="label">End Date <span className="text-slate-400 font-normal">(optional)</span></label>
                <input className="input" type="datetime-local" value={endDate}
                  onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-slate-800">Options / Candidates</h2>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 space-y-1">
                  <input className="input" required value={o.title}
                    onChange={e => updateOption(i, 'title', e.target.value)}
                    placeholder={`Option ${i + 1}`} />
                  <input className="input text-xs" value={o.description}
                    onChange={e => updateOption(i, 'description', e.target.value)}
                    placeholder="Short description (optional)" />
                </div>
                <button type="button" onClick={() => removeOption(i)}
                  disabled={options.length <= 2}
                  className="btn-ghost text-slate-400 mt-1 px-2">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={addOption} className="btn-secondary text-sm">
              + Add option
            </button>
          </div>

          {/* Settings */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Voting Settings</h2>

            <Toggle
              label="Require voters to log in"
              detail="Voters must sign in with Google or magic link"
              checked={requireLogin}
              onChange={setRequireLogin}
            />
            <Toggle
              label="Show results to all voters"
              detail="If off, only you (the admin) can see results"
              checked={resultsVisible}
              onChange={setResultsVisible}
            />
            <Toggle
              label="Randomize option order per voter"
              detail="Reduces position bias"
              checked={randomizeOptions}
              onChange={setRandomize}
            />
          </div>

          {/* Allowed voters */}
          <div className="card p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-slate-800">Voter Email Whitelist</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Leave empty to allow any logged-in user. When filled, only these emails may vote.
              </p>
            </div>
            <div className="field">
              <label className="label">Emails (one per line or comma-separated)</label>
              <textarea className="input font-mono text-xs" rows={4} value={allowedEmails}
                onChange={e => setAllowedEmails(e.target.value)}
                placeholder={"alice@example.com\nbob@example.com"} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}

          <div className="flex justify-end gap-3">
            <Link to="/dashboard" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating…' : 'Create Contest'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

function Toggle({ label, detail, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative flex-shrink-0 mt-0.5">
        <input type="checkbox" className="sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
        <div className={`w-9 h-5 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {detail && <p className="text-xs text-slate-400">{detail}</p>}
      </div>
    </label>
  )
}
