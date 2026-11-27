import { useEffect, useRef } from 'react'
import { supabase } from '../lib/db'
import { mountSignIn } from '../lib/auth'

// The HintWise sign-in controls (claude-built-apps platform/templates/app, src/lib/auth.ts,
// copied unchanged): "Sign in with Google" and "Email code", whose panel holds the email form
// and then the box for the emailed 6-digit code; signed in, the person (with "Delete my
// account") and "Sign out". mountSignIn draws them with plain DOM into this element, and also
// finishes a sign-in link that comes back to this page. Sign-in returns to the page it started
// on (location.origin + location.pathname), which must be on https://*.hintwise.org.
//
// `inline` centres the controls and their panel in a card (the sign-in page and the ballot's
// sign-in step) instead of placing them at the right of a top bar (index.css).
//
// In development, React's StrictMode mounts this twice; the first mount takes a sign-in link
// out of the address bar, so the "Finish signing in" offer may come from that first mount.
// Production mounts once.
export default function SignIn({ inline = false, client = supabase, mount = mountSignIn }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !client) return undefined
    const unmount = mount(el, { client })
    return () => {
      unmount()
      el.replaceChildren()
    }
  }, [client, mount])

  return <div ref={ref} className={inline ? 'rv-signin-inline' : undefined} data-testid="hintwise-sign-in" />
}
