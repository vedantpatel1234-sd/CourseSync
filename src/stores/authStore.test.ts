import { describe, it, expect, vi, beforeEach } from 'vitest'

const { signInWithPassword, getSession, authSignOut, from } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  authSignOut: vi.fn(),
  from: vi.fn()
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signInWithPassword, getSession, signOut: authSignOut },
    from
  }
}))

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

import { useAuthStore } from './authStore'

const PROFILE = { id: 'u1', full_name: 'Ada Admin', email: 'ada@x.com', role: 'admin' as const }

// profiles -> .select().eq().single(); terms_acceptance -> .select().eq().limit().maybeSingle()
function mockTables(opts: { profile?: unknown; terms?: unknown }) {
  from.mockImplementation((table: string) => {
    const result = table === 'profiles' ? { data: opts.profile ?? null } : { data: opts.terms ?? null }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.limit = () => chain
    chain.single = () => Promise.resolve(result)
    chain.maybeSingle = () => Promise.resolve(result)
    return chain
  })
}

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authSignOut.mockResolvedValue({})
    useAuthStore.setState({ user: null, termsAccepted: null, initializing: true, loading: false, showWarning: false })
  })

  describe('signIn', () => {
    it('loads profile and terms status together and stores both', async () => {
      signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      mockTables({ profile: PROFILE, terms: { id: 't1' } })

      const result = await useAuthStore.getState().signIn('ada@x.com', 'pw')

      expect(result).toEqual({ error: null })
      expect(useAuthStore.getState().user).toEqual(PROFILE)
      expect(useAuthStore.getState().termsAccepted).toBe(true)
    })

    it('starts the terms query while the profile query is still pending (parallel, not sequential)', async () => {
      signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      let releaseProfile!: (v: { data: unknown }) => void
      const profileGate = new Promise<{ data: unknown }>(res => { releaseProfile = res })
      const queried: string[] = []
      from.mockImplementation((table: string) => {
        queried.push(table)
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.limit = () => chain
        chain.single = () => profileGate
        chain.maybeSingle = () => Promise.resolve({ data: null })
        return chain
      })

      const pending = useAuthStore.getState().signIn('ada@x.com', 'pw')
      await vi.waitFor(() => expect(queried).toContain('profiles'))

      // Profile has not resolved, yet the terms query has already been issued.
      expect(queried).toContain('terms_acceptance')

      releaseProfile({ data: PROFILE })
      await pending
      expect(useAuthStore.getState().user).toEqual(PROFILE)
    })

    it('records termsAccepted=false when the user has not accepted', async () => {
      signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      mockTables({ profile: PROFILE, terms: null })

      await useAuthStore.getState().signIn('ada@x.com', 'pw')

      expect(useAuthStore.getState().termsAccepted).toBe(false)
    })

    it('returns the auth error message and does not load anything on failure', async () => {
      signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })

      const result = await useAuthStore.getState().signIn('ada@x.com', 'bad')

      expect(result).toEqual({ error: 'Invalid login credentials' })
      expect(from).not.toHaveBeenCalled()
      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().loading).toBe(false)
    })
  })

  describe('initialize', () => {
    it('restores user and terms status from an existing session, then stops initializing', async () => {
      getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
      mockTables({ profile: PROFILE, terms: { id: 't1' } })

      await useAuthStore.getState().initialize()

      const s = useAuthStore.getState()
      expect(s.user).toEqual(PROFILE)
      expect(s.termsAccepted).toBe(true)
      expect(s.initializing).toBe(false)
    })

    it('stops initializing with no user when there is no session', async () => {
      getSession.mockResolvedValue({ data: { session: null } })

      await useAuthStore.getState().initialize()

      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().initializing).toBe(false)
      expect(from).not.toHaveBeenCalled()
    })

    it('still stops initializing if the session lookup throws, so the app is not stuck on Loading', async () => {
      getSession.mockRejectedValue(new Error('network down'))

      await expect(useAuthStore.getState().initialize()).rejects.toThrow('network down')

      expect(useAuthStore.getState().initializing).toBe(false)
    })
  })

  describe('signOut', () => {
    it('clears the user and terms status', async () => {
      useAuthStore.setState({ user: PROFILE, termsAccepted: true })

      await useAuthStore.getState().signOut()

      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().termsAccepted).toBeNull()
    })
  })

  it('setTermsAccepted updates the flag', () => {
    useAuthStore.getState().setTermsAccepted(true)
    expect(useAuthStore.getState().termsAccepted).toBe(true)
  })
})
