import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  scrub, normalizeError, isIgnorable, reportError, installGlobalErrorHandlers, resetErrorReporting, LIMITS
} from './errorReporting'
import { supabase } from './supabase'
import { useAuthStore } from '../stores/authStore'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../stores/authStore', () => ({ useAuthStore: { getState: vi.fn() } }))

const insert = vi.fn()

function signedIn(isSignedIn = true) {
  vi.mocked(useAuthStore.getState).mockReturnValue({ user: isSignedIn ? { id: 'u1' } : null } as never)
}

describe('scrub', () => {
  it('removes email addresses, wherever they appear', () => {
    expect(scrub('duplicate key: Key (email)=(jane.doe+x@college.ca) already exists'))
      .toBe('duplicate key: Key (email)=([email]) already exists')
    expect(scrub('a@b.co and c@d.org')).toBe('[email] and [email]')
  })

  it('removes JWTs and other long token-like strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(scrub(`Authorization: Bearer ${jwt}`)).toBe('Authorization: Bearer [token]')
    expect(scrub(`key=${'a1B2c3D4'.repeat(6)} end`)).toBe('key=[token] end')
  })

  it('strips query strings and fragments from URLs, which can carry invitation or reset tokens', () => {
    expect(scrub('at https://app.example/set-password?token=abc123&type=invite (file.js:1:2)'))
      .toBe('at https://app.example/set-password (file.js:1:2)')
    expect(scrub('https://app.example/set-password#access_token=secret&type=recovery'))
      .toBe('https://app.example/set-password')
  })

  it('leaves ordinary technical text and UUIDs alone, since ids are needed to debug', () => {
    const text = 'TypeError: Cannot read properties of undefined (reading \'map\') in section 3f2b8c1e-9d4a-4e6b-8a1c-7d2e5f9a0b3c'
    expect(scrub(text)).toBe(text)
  })

  it('handles empty input', () => {
    expect(scrub('')).toBe('')
  })

  // A pathological message must never be able to freeze the page. The email pattern once took ~50
  // seconds on the first of these.
  it.each([
    ['one huge word', 'x'.repeat(200_000)],
    ['many @ signs with no valid address', 'a@'.repeat(100_000)],
    ['long dotted run', 'a.'.repeat(100_000)],
    ['token-like run with a dash', 'ab-'.repeat(70_000)],
    ['repeated JWT prefix', 'eyJ'.repeat(70_000)],
    ['repeated URL scheme', 'https://x'.repeat(30_000)],
    ['a query marker followed by repeated URL schemes', '?' + 'https://x'.repeat(30_000)],
    ['a long run ending in a dash', 'a'.repeat(100_000) + '-']
  ])('stays fast on %s', (_label, input) => {
    const started = performance.now()
    scrub(input)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('still catches an email near the end of a long message', () => {
    expect(scrub('x '.repeat(10_000) + 'jane@college.ca')).toContain('[email]')
  })
})

describe('normalizeError', () => {
  it('reads an Error', () => {
    const e = new TypeError('bad thing')
    expect(normalizeError(e)).toEqual({ message: 'bad thing', stack: e.stack })
  })

  it('reads a string, a message-bearing object, a plain object, and nothing', () => {
    expect(normalizeError('oops')).toEqual({ message: 'oops', stack: null })
    expect(normalizeError({ message: 'from object', stack: 'at x' })).toEqual({ message: 'from object', stack: 'at x' })
    expect(normalizeError({ code: 42 })).toEqual({ message: '{"code":42}', stack: null })
    expect(normalizeError(undefined)).toEqual({ message: 'undefined', stack: null })
    expect(normalizeError(null)).toEqual({ message: 'null', stack: null })
  })

  it('copes with an object that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(normalizeError(circular).message).toBe('[object Object]')
  })

  it('names an Error that has no message', () => {
    expect(normalizeError(new RangeError('')).message).toBe('RangeError')
  })
})

describe('isIgnorable', () => {
  it('ignores browser noise and errors from browser extensions', () => {
    expect(isIgnorable('ResizeObserver loop completed with undelivered notifications.', null)).toBe(true)
    expect(isIgnorable('boom', 'at chrome-extension://abc/content.js:1:1')).toBe(true)
    expect(isIgnorable('Script error', 'moz-extension://x/y.js')).toBe(true)
  })

  it('does not ignore real application errors', () => {
    expect(isIgnorable('Cannot read properties of undefined', 'at Team.tsx:10:5')).toBe(false)
  })
})

describe('reportError', () => {
  beforeEach(() => {
    resetErrorReporting()
    insert.mockReset().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReset().mockReturnValue({ insert } as never)
    signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.pushState({}, '', '/admin/courses?secret=1#frag')
  })
  afterEach(() => vi.restoreAllMocks())

  it('stores a scrubbed report with the page path (never the query string), source and version', async () => {
    await reportError(new Error('Key (email)=(jane@college.ca) already exists'), 'manual')

    expect(supabase.from).toHaveBeenCalledWith('client_errors')
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({
      message: 'Key (email)=([email]) already exists', path: '/admin/courses', source: 'manual', app_version: expect.any(String)
    })
    expect(JSON.stringify(row)).not.toContain('jane@college.ca')
    expect(JSON.stringify(row)).not.toContain('secret=1')
  })

  it('scrubs the stack as well as the message', async () => {
    const error = new Error('x')
    error.stack = 'Error: x\n    at https://app.example/assets/index.js?token=SECRETVALUE:1:2'
    await reportError(error, 'window')
    expect(insert.mock.calls[0][0].stack).not.toContain('SECRETVALUE')
  })

  it('includes extra stack information such as the React component stack', async () => {
    await reportError(new Error('render failed'), 'boundary', 'Component stack:\n    at Team')
    expect(insert.mock.calls[0][0].stack).toContain('Component stack:')
  })

  it('keeps every field inside the limits the database enforces', async () => {
    const error = new Error('m'.repeat(5000))
    error.stack = 's '.repeat(10000)
    await reportError(error, 'window')
    const row = insert.mock.calls[0][0]
    expect(row.message.length).toBeLessThanOrEqual(LIMITS.message)
    expect(row.stack.length).toBeLessThanOrEqual(LIMITS.stack)
    expect(row.path.length).toBeLessThanOrEqual(LIMITS.path)
    expect(row.user_agent.length).toBeLessThanOrEqual(LIMITS.userAgent)
  })

  it('sends nothing when nobody is signed in (the table only accepts signed-in users)', async () => {
    signedIn(false)
    await reportError(new Error('before login'), 'window')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('still logs to the console when not signed in, so developers see it', async () => {
    signedIn(false)
    const error = new Error('visible')
    await reportError(error, 'window')
    expect(console.error).toHaveBeenCalledWith(error)
  })

  it('ignores browser noise', async () => {
    await reportError(new Error('ResizeObserver loop limit exceeded'), 'window')
    expect(insert).not.toHaveBeenCalled()
  })

  it('reports the same error only once, but reports a different one', async () => {
    for (let i = 0; i < 5; i++) await reportError(new Error('render loop'), 'boundary')
    expect(insert).toHaveBeenCalledTimes(1)
    await reportError(new Error('something else'), 'boundary')
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('treats the same message from a different page as a different problem', async () => {
    await reportError(new Error('boom'), 'window')
    window.history.pushState({}, '', '/admin/team')
    await reportError(new Error('boom'), 'window')
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('stops after a handful of reports in one page load, however many distinct errors occur', async () => {
    for (let i = 0; i < 25; i++) await reportError(new Error(`distinct error ${i}`), 'window')
    expect(insert).toHaveBeenCalledTimes(LIMITS.perPageLoad)
  })

  it('never throws, even if the database call fails or throws', async () => {
    insert.mockRejectedValueOnce(new Error('network down'))
    await expect(reportError(new Error('a'), 'window')).resolves.toBeUndefined()
    vi.mocked(supabase.from).mockImplementation(() => { throw new Error('client broken') })
    await expect(reportError(new Error('b'), 'window')).resolves.toBeUndefined()
  })

  it('does not report its own failure to report', async () => {
    insert.mockResolvedValue({ error: { message: 'row-level security' } })
    await reportError(new Error('first'), 'window')
    expect(insert).toHaveBeenCalledTimes(1) // the failed insert did not trigger another report
  })
})

describe('installGlobalErrorHandlers', () => {
  let uninstall: () => void
  // A private event target, so dispatching error events here is not treated by jsdom as a real
  // uncaught error in the test run.
  let target: Window

  beforeEach(() => {
    resetErrorReporting()
    insert.mockReset().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReset().mockReturnValue({ insert } as never)
    signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    target = new EventTarget() as unknown as Window
    uninstall = installGlobalErrorHandlers(target)
  })
  afterEach(() => { uninstall(); vi.restoreAllMocks() })

  it('reports an uncaught error', async () => {
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught one'), message: 'uncaught one' }))
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    expect(insert.mock.calls[0][0]).toMatchObject({ message: 'uncaught one', source: 'window' })
  })

  it('reports an unhandled promise rejection', async () => {
    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.assign(event, { reason: new Error('rejected one'), promise: Promise.resolve() })
    target.dispatchEvent(event)
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    expect(insert.mock.calls[0][0]).toMatchObject({ message: 'rejected one', source: 'promise' })
  })

  it('is safe to install twice and stops reporting once removed', async () => {
    const again = installGlobalErrorHandlers(target) // second install is a no-op
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('only once'), message: 'only once' }))
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    again()
    uninstall()
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('after removal'), message: 'after removal' }))
    await new Promise(r => setTimeout(r, 20))
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
