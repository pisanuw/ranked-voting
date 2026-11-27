import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import PrivacyNote from '../components/PrivacyNote'
import SignIn from '../components/SignIn'

export default function Login() {
  const { user } = useAuth()

  if (user) return <Navigate to="/dashboard" replace />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      <div className="card w-full max-w-md p-8 space-y-6">
        {/* Logo / title */}
        <div className="text-center space-y-1">
          <div className="text-4xl">🗳️</div>
          <h1 className="text-2xl font-bold text-slate-900">RankedVote</h1>
          <p className="text-sm text-slate-500">Fair voting, transparent results</p>
        </div>

        <p className="text-center text-sm text-slate-600">
          Sign in with Google, or with a 6-digit code we email you.
        </p>
        <SignIn inline />
      </div>
      <PrivacyNote className="w-full max-w-md" />
    </div>
  )
}
