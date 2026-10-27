import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

interface User {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'instructor' | 'coordinator'
}

interface AuthStore {
  user: User | null
  termsAccepted: boolean | null
  organizationName: string | null
  initializing: boolean
  loading: boolean
  lastActivity: number
  showWarning: boolean
  setUser: (user: User | null) => void
  setTermsAccepted: (accepted: boolean) => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
  resetActivity: () => void
  dismissWarning: () => void
}

const TIMEOUT_MS = 5 * 60 * 1000
const WARNING_MS = 4 * 60 * 1000

let intervalId: ReturnType<typeof setInterval> | null = null

// Profile, terms-acceptance and organization name only need the user id, so fetch them
// together rather than one after the other (and rather than again after navigation).
// The organization name is cosmetic: if that query fails (for example before the
// multi-tenancy migrations have been applied) it is simply left blank.
async function loadUserContext(userId: string) {
  const [profileRes, termsRes, orgRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('terms_acceptance').select('id').eq('user_id', userId).limit(1).maybeSingle(),
    supabase.from('organizations').select('name').maybeSingle()
  ])
  return {
    profile: profileRes.data as User | null,
    termsAccepted: !!termsRes.data,
    organizationName: (orgRes.data as { name: string } | null)?.name ?? null
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  termsAccepted: null,
  organizationName: null,
  initializing: true,
  loading: false,
  lastActivity: Date.now(),
  showWarning: false,

  setUser: (user) => set({ user }),

  setTermsAccepted: (accepted) => set({ termsAccepted: accepted }),

  resetActivity: () => {
    const { showWarning } = get()
    if (showWarning) return
    set({ lastActivity: Date.now() })
  },

  dismissWarning: () => {
    set({ lastActivity: Date.now(), showWarning: false })
  },

  signIn: async (email, password) => {
    set({ loading: true })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ loading: false })
      return { error: error.message }
    }
    if (data.user) {
      const { profile, termsAccepted, organizationName } = await loadUserContext(data.user.id)
      if (profile) {
        set({ user: profile, termsAccepted, organizationName, loading: false, lastActivity: Date.now(), showWarning: false })
        startTimer(get, set)
      }
    }
    set({ loading: false })
    return { error: null }
  },

  signOut: async () => {
    stopTimer()
    await supabase.auth.signOut()
    set({ user: null, termsAccepted: null, organizationName: null, showWarning: false })
  },

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { profile, termsAccepted, organizationName } = await loadUserContext(session.user.id)
        if (profile) {
          set({ user: profile, termsAccepted, organizationName, lastActivity: Date.now() })
          startTimer(get, set)
        }
      }
    } finally {
      set({ initializing: false })
    }
  }
}))

function startTimer(get: () => AuthStore, set: (partial: Partial<AuthStore>) => void) {
  stopTimer()
  intervalId = setInterval(() => {
    const { lastActivity, showWarning, user } = get()
    if (!user) return
    const elapsed = Date.now() - lastActivity

    if (elapsed >= TIMEOUT_MS) {
      toast.error('Session expired due to inactivity.', { position: 'top-center' })
      supabase.auth.signOut()
      set({ user: null, termsAccepted: null, organizationName: null, showWarning: false })
      stopTimer()
    } else if (elapsed >= WARNING_MS && !showWarning) {
      set({ showWarning: true })
    }
  }, 1000)
}

function stopTimer() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

if (typeof window !== 'undefined') {
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
  events.forEach((event) => {
    window.addEventListener(event, () => {
      useAuthStore.getState().resetActivity()
    }, { passive: true })
  })
}