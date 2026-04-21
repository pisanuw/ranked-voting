import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import CreateContest from './pages/CreateContest'
import AdminContest  from './pages/AdminContest'
import VotingPage    from './pages/VotingPage'
import ResultsPage   from './pages/ResultsPage'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>
  if (!user)   return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/"        element={<Navigate to="/dashboard" replace />} />
      <Route path="/login"   element={<Login />} />

      {/* Protected routes */}
      <Route path="/dashboard"    element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/contest/new"  element={<RequireAuth><CreateContest /></RequireAuth>} />
      <Route path="/admin/:id"    element={<RequireAuth><AdminContest /></RequireAuth>} />
      {/* Results: auth handled inside the page based on results_visible_to_voters setting */}
      <Route path="/results/:token" element={<ResultsPage />} />

      {/* Voting may or may not require auth — VotingPage handles that check itself */}
      <Route path="/vote/:token"  element={<VotingPage />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
