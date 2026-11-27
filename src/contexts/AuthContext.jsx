import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/db'
import { onAuth, signOut as hintwiseSignOut } from '../lib/auth'

// Who is signed in, for the pages. Signing in happens in the HintWise sign-in controls
// (components/SignIn.jsx, the template's mountSignIn): Google, or a 6-digit code by email
// through the platform's sign-in-link function. Never supabase.auth.signInWithOtp: the shared
// project's email hook refuses it for hintwise.org pages.
const AuthContext = createContext(null)

export function AuthProvider({ children, client = supabase }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onAuth((nextUser) => {
    setUser(nextUser)
    setLoading(false)
  }, client), [client])

  // This app only: every HintWise app shares one sign-in, and a global sign-out would end the
  // person's session in all of them.
  const signOut = () => hintwiseSignOut(client)

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
