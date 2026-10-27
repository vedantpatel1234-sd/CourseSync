import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'
import { APP_VERSION } from './environment'

// Reports errors the app hits to our own database (client_errors, migration 015), so a bug at a
// customer isn't invisible. Nothing leaves our infrastructure. Reading them is done by the vendor
// with scripts/recent-errors.mjs; users can write reports but never read them.
//
// Everything here is written so that reporting can never make things worse: it never throws,
// never reports its own failures, and sends at most a handful of reports per page load.

export type ErrorSource = 'boundary' | 'window' | 'promise' | 'manual'

export const LIMITS = { message: 1000, stack: 6000, path: 300, userAgent: 300, perPageLoad: 10 } as const

// The lookbehind makes this linear: without it, a long run of letters with no "@" is retried from
// every starting position (quadratic), and a single large error message could freeze the page.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Like EMAIL, the lookbehind keeps this linear: only the start of a run can begin a match.
const JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g
// Long unbroken runs of token-like characters (API keys, session ids). A UUID is 36 characters, so
// it is deliberately left alone: ids are useful for debugging and are not personal on their own.
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g
// Query strings and fragments in URLs can carry tokens (for example the links in invitation emails).
// Matches a whole URL (always succeeding, so it is linear); the query/fragment is cut off afterwards.
const URL_LIKE = /\bhttps?:\/\/[^\s)'"]*/g

// Scrubbing happens before the final trim to the stored limits, so it must see enough text to catch a
// token near the end of what is kept, but never an unbounded amount.
const SCRUB_INPUT_CAP = 40_000

/** Removes personal and secret-looking content from text before it is stored. */
export function scrub(text: string): string {
  return text
    .slice(0, SCRUB_INPUT_CAP)
    .replace(JWT, '[token]')
    .replace(URL_LIKE, url => url.split(/[?#]/)[0])
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[token]')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

export interface NormalizedError {
  message: string
  stack: string | null
}

/** Turns whatever was thrown (an Error, a string, an object, nothing) into a message and a stack. */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Error', stack: error.stack ?? null }
  }
  if (typeof error === 'string') return { message: error, stack: null }
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; stack?: unknown }
    if (typeof maybe.message === 'string') {
      return { message: maybe.message, stack: typeof maybe.stack === 'string' ? maybe.stack : null }
    }
    try {
      return { message: JSON.stringify(error), stack: null }
    } catch {
      return { message: String(error), stack: null }
    }
  }
  return { message: String(error), stack: null }
}

// Browsers raise these constantly and they are not bugs in our code.
const IGNORED = [
  /ResizeObserver loop/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-extension:\/\//i
]

export function isIgnorable(message: string, stack: string | null): boolean {
  return IGNORED.some(pattern => pattern.test(message) || (stack !== null && pattern.test(stack)))
}

export interface ErrorRow {
  message: string
  stack: string | null
  path: string
  source: ErrorSource
  app_version: string
  user_agent: string
}

const seen = new Set<string>()
let sentThisPageLoad = 0

/** Only for tests: forget what has already been reported. */
export function resetErrorReporting(): void {
  seen.clear()
  sentThisPageLoad = 0
}

/**
 * Reports an error. Safe to call from anywhere: returns quietly if the user isn't signed in, if
 * the error is noise or a repeat, or if this page load has already sent its share.
 */
export async function reportError(error: unknown, source: ErrorSource, extraStack?: string): Promise<void> {
  try {
    const { message, stack } = normalizeError(error)
    const fullStack = [stack, extraStack].filter(Boolean).join('\n\n') || null
    if (isIgnorable(message, fullStack)) return

    // Mirror to the console so it is still visible when debugging.
    console.error(error)

    // Reports go to a table only signed-in users may write to.
    if (!useAuthStore.getState().user) return

    const row: ErrorRow = {
      message: truncate(scrub(message), LIMITS.message),
      stack: fullStack === null ? null : truncate(scrub(fullStack), LIMITS.stack),
      path: truncate(window.location.pathname, LIMITS.path),
      source,
      app_version: APP_VERSION,
      user_agent: truncate(navigator.userAgent, LIMITS.userAgent)
    }

    // The same error repeating in a render loop should be one report, not hundreds.
    const key = `${source}|${row.message}|${row.path}`
    if (seen.has(key) || sentThisPageLoad >= LIMITS.perPageLoad) return
    seen.add(key)
    sentThisPageLoad += 1

    // Result deliberately ignored: a failure to report is not worth reporting.
    await supabase.from('client_errors').insert(row)
  } catch {
    // Reporting must never throw.
  }
}

let installed = false

/** Catches errors nothing else handled: uncaught exceptions and rejected promises nobody awaited. */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  if (installed) return () => {}
  installed = true

  const onError = (event: ErrorEvent) => { void reportError(event.error ?? event.message, 'window') }
  const onRejection = (event: PromiseRejectionEvent) => { void reportError(event.reason, 'promise') }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)

  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    installed = false
  }
}
