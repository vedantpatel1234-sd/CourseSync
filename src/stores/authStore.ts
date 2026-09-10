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
  loading: boolean
  lastActivity: number
  showWarning: boolean
  setUser: (user: User | null) => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
  resetActivity: () => void
  dismissWarning: () => void
}

const TIMEOUT_MS = 5 * 60 * 1000
const WARNING_MS = 4 * 60 * 1000

let intervalId: ReturnType<typeof setInterval> | null = null

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  loading: false,
  lastActivity: Date.now(),
  showWarning: false,

  setUser: (user) => set({ user }),

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
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()
      if (profile) {
        set({ user: profile, loading: false, lastActivity: Date.now(), showWarning: false })
        startTimer(get, set)
      }
    }
    set({ loading: false })
    return { error: null }
  },

  signOut: async () => {
    stopTimer()
    await supabase.auth.signOut()
    set({ user: null, showWarning: false })
  },

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        set({ user: profile, lastActivity: Date.now() })
        startTimer(get, set)
      }
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
      set({ user: null, showWarning: false })
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