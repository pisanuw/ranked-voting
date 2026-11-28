// @vitest-environment jsdom
// The HintWise sign-in in the React app: the SignIn element hands its node to mountSignIn
// (src/lib/auth.ts, tested in test/auth.test.ts) and cleans up after it; the sign-in page and
// the ballot's sign-in step show it; AuthProvider follows the session and signs out of this app
// only. Fakes only: no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SignIn from '../components/SignIn'
import Login from '../pages/Login'
import VotingPage from '../pages/VotingPage'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (element) => act(() => root.render(element))

/** A fake Supabase client: the session it reports, and the auth listener it was given. */
function fakeClient(user = null) {
  const state = { listener: null, signOuts: [] }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user, access_token: 'jwt' } : null } }),
      onAuthStateChange: (cb) => {
        state.listener = cb
        return { data: { subscription: { unsubscribe: () => { state.listener = null } } } }
      },
      signOut: async (opts) => { state.signOuts.push(opts); return { error: null } },
    },
  }
  return { client, state }
}

describe('SignIn', () => {
  it('mounts the HintWise controls on its element with the app client, and cleans up', () => {
    const cleanup = vi.fn()
    const client = { auth: {} }
    const mount = vi.fn((el) => {
      el.textContent = 'Sign in with Google'
      return cleanup
    })
    render(<SignIn client={client} mount={mount} />)
    const el = container.querySelector('[data-testid="hintwise-sign-in"]')
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[0][0]).toBe(el)
    expect(mount.mock.calls[0][1]).toEqual({ client })
    expect(el.className).toBe('')
    expect(el.textContent).toBe('Sign in with Google')
    render(<div />)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(el.textContent).toBe('')
  })

  it('centres itself in a card when inline', () => {
    render(<SignIn inline client={{ auth: {} }} mount={() => () => {}} />)
    expect(container.querySelector('[data-testid="hintwise-sign-in"]').className).toBe('rv-signin-inline')
  })

  it('draws nothing without a configured client', () => {
    const mount = vi.fn()
    render(<SignIn client={null} mount={mount} />)
    expect(mount).not.toHaveBeenCalled()
  })
})

describe('AuthProvider', () => {
  function Probe() {
    const { user, loading, signOut } = useAuth()
    return (
      <button type="button" onClick={signOut}>
        {loading ? 'loading' : (user?.email ?? 'nobody')}
      </button>
    )
  }

  it('follows the session and signs out of this app only', async () => {
    const { client, state } = fakeClient({ id: 'u1', email: 'ann@example.org' })
    await act(async () => root.render(<AuthProvider client={client}><Probe /></AuthProvider>))
    const button = container.querySelector('button')
    expect(button.textContent).toBe('ann@example.org')
    act(() => state.listener('SIGNED_OUT', null))
    expect(button.textContent).toBe('nobody')
    await act(async () => button.click())
    expect(state.signOuts).toEqual([{ scope: 'local' }])
    render(<div />)
    expect(state.listener).toBeNull()
  })

  it('is required by useAuth', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/inside AuthProvider/)
    spy.mockRestore()
  })
})

describe('the sign-in page', () => {
  const page = (client) => (
    <AuthProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )

  it('offers the HintWise sign-in, with no magic-link form of its own', async () => {
    await act(async () => root.render(page(fakeClient().client)))
    expect(container.textContent).toContain('Sign in with Google, or with a 6-digit code we email you.')
    expect(container.querySelector('[data-testid="hintwise-sign-in"]').className).toBe('rv-signin-inline')
    expect(container.querySelector('input[type="email"]')).toBeNull()
    expect(container.textContent).not.toMatch(/magic link/i)
  })

  it('sends a signed-in visitor to the dashboard', async () => {
    await act(async () => root.render(page(fakeClient({ id: 'u1', email: 'ann@example.org' }).client)))
    expect(container.textContent).toBe('dashboard')
  })
})

describe('the ballot of a contest with a voter list', () => {
  it('asks a signed-out visitor to sign in with the HintWise controls, coming back to the ballot', async () => {
    const contest = {
      id: 'c1', title: 'Board election', status: 'open', require_login: true, end_date: null,
      submissions_open: true, comments_required: false, randomize_options: false, results_visible_to_voters: true,
      contest_options: [{ id: 'o1', title: 'A', order_index: 0 }, { id: 'o2', title: 'B', order_index: 1 }],
    }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => contest }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await act(async () => root.render(
        <AuthProvider client={fakeClient().client}>
          <MemoryRouter initialEntries={['/vote/0123456789abcdef0123456789abcdef']}>
            <Routes><Route path="/vote/:token" element={<VotingPage />} /></Routes>
          </MemoryRouter>
        </AuthProvider>,
      ))
      expect(fetchMock).toHaveBeenCalledWith('/api/get-contest?token=0123456789abcdef0123456789abcdef')
      expect(container.textContent).toContain('Sign in to cast your vote')
      expect(container.querySelector('[data-testid="hintwise-sign-in"]').className).toBe('rv-signin-inline')
      expect(container.querySelector('input[type="email"]')).toBeNull()
      expect(container.textContent).not.toMatch(/magic link/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
