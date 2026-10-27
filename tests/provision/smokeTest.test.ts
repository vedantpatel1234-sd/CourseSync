// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { runSmokeTests as runSmokeTestsUntyped, runSiteChecks as runSiteChecksUntyped, formatResults, callFunction } from '../../scripts/smokeTest.mjs'

interface Result { name: string; status: 'pass' | 'fail' | 'skip'; detail?: string }
const runSmokeTests = runSmokeTestsUntyped as (opts: { makeClient: () => unknown; credentials: Record<string, unknown> }) => Promise<Result[]>

const runSiteChecks = runSiteChecksUntyped as (opts: { appUrl: string; fetchImpl: unknown }) => Promise<Result[]>

type Json = Record<string, unknown>
type Role = 'admin' | 'instructor' | null

interface World {
  /** Override how a function answers: return undefined to use the healthy behaviour. */
  respond?: (fn: string, role: Role, body: Json) => { status: number; body: Json } | undefined
  signInFails?: Role[]
  organizationsVisible?: number
  organizationsOfProfiles?: string[]
  errorReportsReadable?: boolean
  instructorCanReadBilling?: boolean
  billingRows?: number
}

const USERS: Record<string, { role: Role; id: string }> = {
  'admin@t.test': { role: 'admin', id: 'admin-1' },
  'instructor@t.test': { role: 'instructor', id: 'inst-1' }
}
const CREDENTIALS = {
  admin: { email: 'admin@t.test', password: 'x' },
  instructor1: { email: 'instructor@t.test', password: 'x' }
}

// What a correctly deployed system answers. Each rule mirrors one the real functions enforce.
function healthy(fn: string, role: Role, body: Json): { status: number; body: Json } {
  if (role === null) return { status: 401, body: { error: 'Not authenticated' } }
  if (fn === 'manage-staff') {
    if (role !== 'admin') return { status: 403, body: { error: 'Only administrators can manage accounts' } }
    if (body.action === 'invite') return { status: 400, body: { error: 'Choose Administrator or Coordinator.', code: 'invalid_role' } }
    if (body.action === 'remove' && body.user_id === 'admin-1') return { status: 400, body: { code: 'cannot_remove_self' } }
    return { status: 404, body: { code: 'not_found' } }
  }
  if (fn === 'manage-instructor') {
    return body.action === 'create' ? { status: 400, body: { error: 'full_name and email are required' } } : { status: 404, body: { error: 'Instructor not found' } }
  }
  if (fn === 'ai-proxy') {
    return role === 'admin' ? { status: 400, body: { code: 'model_not_allowed' } } : { status: 403, body: { error: 'Only admins can use AI features' } }
  }
  return { status: 500, body: {} }
}

function makeWorld(world: World = {}) {
  const calls: { fn: string; role: Role }[] = []
  const makeClient = () => {
    let role: Role = null
    let userId = ''
    return {
      auth: {
        signInWithPassword: async ({ email }: { email: string }) => {
          const user = USERS[email]
          if (!user || world.signInFails?.includes(user.role)) return { error: { message: 'Invalid login credentials' } }
          role = user.role
          userId = user.id
          return { error: null }
        },
        getUser: async () => ({ data: { user: role ? { id: userId } : null } })
      },
      functions: {
        invoke: async (fn: string, { body }: { body: Json }) => {
          calls.push({ fn, role })
          const reply = world.respond?.(fn, role, body) ?? healthy(fn, role, body)
          if (reply.status >= 200 && reply.status < 300) return { data: reply.body, error: null }
          return {
            data: null,
            error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
              context: { status: reply.status, json: async () => reply.body }
            })
          }
        }
      },
      rpc: async () => ({ data: [{ subscription_status: 'active' }], error: null }),
      from: (table: string) => ({
        select: async () => {
          if (table === 'organizations') return { data: Array.from({ length: world.organizationsVisible ?? 1 }, () => ({ id: 'o', name: 'Test School' })), error: null }
          if (table === 'profiles') return { data: (world.organizationsOfProfiles ?? ['org-1', 'org-1']).map(o => ({ organization_id: o })), error: null }
          if (table === 'organization_billing') {
            const rows = role === 'instructor' ? (world.instructorCanReadBilling ? 1 : 0) : (world.billingRows ?? 1)
            return { data: Array.from({ length: rows }, () => ({ plan: 'test', subscription_status: 'active' })), error: null }
          }
          if (table === 'client_errors') return { data: world.errorReportsReadable ? [{ id: 1 }] : [], error: null }
          return { data: [], error: null }
        },
        insert: async () => ({ error: null })
      })
    }
  }
  return { makeClient, calls }
}

const run = (world?: World, credentials: Record<string, unknown> = CREDENTIALS) =>
  runSmokeTests({ makeClient: makeWorld(world).makeClient, credentials })
const byName = (results: Result[], fragment: string) => results.find(r => r.name.includes(fragment))!

describe('runSmokeTests', () => {
  it('passes everything against a correctly working deployment', async () => {
    const results = await run()
    expect(results.filter(r => r.status !== 'pass')).toEqual([])
    expect(results.length).toBeGreaterThanOrEqual(18)
  })

  describe('detects a function that is not behaving', () => {
    it('a function that is not deployed (no response at all)', async () => {
      const results = await runSmokeTests({
        makeClient: () => ({
          ...makeWorld().makeClient(),
          functions: { invoke: async () => ({ data: null, error: new Error('Failed to send a request to the Edge Function') }) }
        }),
        credentials: CREDENTIALS
      })
      const failed = results.filter(r => r.status === 'fail')
      expect(failed.map(f => f.name)).toContain('manage-staff refuses a request with no sign-in')
      expect(failed.find(f => f.name.startsWith('manage-staff refuses a request'))!.detail).toMatch(/no response/)
    })

    it('a function that crashes (HTTP 500), failing only that check', async () => {
      const results = await run({ respond: (fn, role, b) => (fn === 'manage-staff' && role === 'admin' && b.action === 'remove' && b.user_id !== 'admin-1' ? { status: 500, body: { error: 'boom' } } : undefined) })
      const failed = results.filter(r => r.status === 'fail').map(r => r.name)
      expect(failed).toEqual(['manage-staff will not remove a person who does not exist'])
    })

    it('a function that would have carried out a request it should have refused', async () => {
      const results = await run({ respond: (fn) => (fn === 'manage-staff' ? { status: 200, body: { id: 'new-user' } } : undefined) })
      // The "invalid role" invitation succeeding means an unvalidated invitation would be sent.
      expect(byName(results, 'checks the role of an invitation').status).toBe('fail')
    })

    it('a server that allows a person to remove themselves', async () => {
      const results = await run({ respond: (fn, _r, b) => (fn === 'manage-staff' && b.user_id === 'admin-1' ? { status: 200, body: { success: true } } : undefined) })
      expect(byName(results, 'your own account').status).toBe('fail')
    })

    it('a refusal for the wrong reason (right status, wrong code)', async () => {
      const results = await run({ respond: (fn, _r, b) => (fn === 'manage-staff' && b.action === 'invite' ? { status: 400, body: { code: 'something_else' } } : undefined) })
      const failure = byName(results, 'checks the role of an invitation')
      expect(failure.status).toBe('fail')
      expect(failure.detail).toMatch(/expected HTTP 400 with code "invalid_role"/)
    })

    it('an AI proxy that has no key configured, or cannot read the plan', async () => {
      const results = await run({ respond: (fn, role) => (fn === 'ai-proxy' && role === 'admin' ? { status: 500, body: { error: 'Server is not configured with an Anthropic API key' } } : undefined) })
      expect(byName(results, 'rejects a model that is not allowed').status).toBe('fail')
    })

    it('an AI proxy or staff function that lets an instructor in', async () => {
      const results = await run({ respond: (fn, role) => (role === 'instructor' && fn !== 'x' ? { status: 400, body: {} } : undefined) })
      expect(byName(results, 'manage-staff refuses an instructor').status).toBe('fail')
      expect(byName(results, 'ai-proxy refuses an instructor').status).toBe('fail')
    })
  })

  describe('detects data that is visible when it should not be', () => {
    it('profiles from another organization', async () => {
      const results = await run({ organizationsOfProfiles: ['org-1', 'org-2'] })
      const failure = byName(results, 'in their own organization')
      expect(failure.status).toBe('fail')
      expect(failure.detail).toMatch(/2 organizations/)
    })

    it('more than one organization visible', async () => {
      expect(byName(await run({ organizationsVisible: 2 }), 'exactly one organization').status).toBe('fail')
    })

    it('an instructor who can read billing details', async () => {
      expect(byName(await run({ instructorCanReadBilling: true }), 'cannot read the plan').status).toBe('fail')
    })

    it('error reports that users can read back', async () => {
      expect(byName(await run({ errorReportsReadable: true }), 'cannot be read back').status).toBe('fail')
    })

    it('an administrator who cannot see their own plan', async () => {
      expect(byName(await run({ billingRows: 0 }), 'read their plan').status).toBe('fail')
    })
  })

  describe('when sign-in is the problem', () => {
    it('reports a failed administrator sign-in once, and skips what depends on it instead of failing it', async () => {
      const results = await run({ signInFails: ['admin'] })
      expect(results.filter(r => r.status === 'fail').map(r => r.name)).toEqual(['the administrator can sign in'])
      expect(results.filter(r => r.status === 'skip').length).toBeGreaterThanOrEqual(10)
      expect(byName(results, 'ai-proxy rejects a model').status).toBe('skip')
      // Checks that do not need the administrator still ran.
      expect(byName(results, 'manage-staff refuses an instructor').status).toBe('pass')
    })

    it('skips the instructor checks when no instructor account was provided', async () => {
      const results = await run({}, { admin: CREDENTIALS.admin })
      expect(byName(results, 'the instructor can sign in').status).toBe('skip')
      expect(results.filter(r => r.status === 'fail')).toEqual([])
    })

    it('fails clearly when no administrator credentials were given', async () => {
      const results = await run({}, {})
      expect(byName(results, 'administrator can sign in').detail).toMatch(/no admin credentials/)
    })
  })

  it('runs the unauthenticated checks without ever signing in', async () => {
    const { makeClient, calls } = makeWorld()
    await runSmokeTests({ makeClient, credentials: CREDENTIALS })
    expect(calls.filter(c => c.role === null)).toHaveLength(3)
  })
})

describe('callFunction', () => {
  it('returns the body of a successful call as 200', async () => {
    const client = { functions: { invoke: async () => ({ data: { id: 'x' }, error: null }) } }
    expect(await callFunction(client, 'f', {})).toEqual({ status: 200, body: { id: 'x' } })
  })

  it('reads the status and body of an error response', async () => {
    const error = Object.assign(new Error('non-2xx'), { context: { status: 403, json: async () => ({ error: 'no' }) } })
    const client = { functions: { invoke: async () => ({ data: null, error }) } }
    expect(await callFunction(client, 'f', {})).toEqual({ status: 403, body: { error: 'no' } })
  })

  it('copes with an error body that is not JSON', async () => {
    const error = Object.assign(new Error('x'), { context: { status: 502, json: async () => { throw new Error('not json') } } })
    const client = { functions: { invoke: async () => ({ data: null, error }) } }
    expect(await callFunction(client, 'f', {})).toEqual({ status: 502, body: null })
  })

  it('reports a network failure as status 0', async () => {
    const client = { functions: { invoke: async () => ({ data: null, error: new Error('offline') }) } }
    expect(await callFunction(client, 'f', {})).toMatchObject({ status: 0, networkError: 'offline' })
  })
})

describe('formatResults', () => {
  it('lists each check and counts passes, failures and skips', () => {
    const { text, ok } = formatResults([
      { name: 'a', status: 'pass' }, { name: 'b', status: 'fail', detail: 'why' }, { name: 'c', status: 'skip', detail: 'because' }
    ])
    expect(text).toContain('PASS  a')
    expect(text).toContain('FAIL  b  (why)')
    expect(text).toContain('skip  c  (because)')
    expect(text).toContain('1 passed, 1 failed, 1 skipped')
    expect(ok).toBe(false)
  })

  it('is ok only when nothing failed and something passed', () => {
    expect(formatResults([{ name: 'a', status: 'pass' }, { name: 'b', status: 'skip' }]).ok).toBe(true)
    expect(formatResults([{ name: 'b', status: 'skip' }]).ok).toBe(false) // nothing was actually checked
    expect(formatResults([]).ok).toBe(false)
  })
})

describe('runSiteChecks', () => {
  const page = '<html><body><div id="root"></div></body></html>'
  const site = (over: Record<string, { status: number; html: string }> = {}) => async (url: string) => {
    const path = new URL(url).pathname
    const r = over[path] ?? { status: 200, html: page }
    return { status: r.status, text: async () => r.html }
  }

  it('passes when every page is served as the application', async () => {
    const results = await runSiteChecks({ appUrl: 'https://staging.example/', fetchImpl: site() })
    expect(results.map(r => r.status)).toEqual(['pass', 'pass', 'pass', 'pass'])
  })

  it('checks the right addresses, ignoring a trailing slash', async () => {
    const seen: string[] = []
    await runSiteChecks({ appUrl: 'https://staging.example//', fetchImpl: async (u: string) => { seen.push(u); return { status: 200, text: async () => page } } })
    expect(seen).toEqual([
      'https://staging.example/', 'https://staging.example/set-password',
      'https://staging.example/legal/terms', 'https://staging.example/legal/privacy'
    ])
  })

  it('fails the deep-link check when the host answers 404 (the rewrite is missing)', async () => {
    const results = await runSiteChecks({ appUrl: 'https://x.example', fetchImpl: site({ '/set-password': { status: 404, html: 'Not Found' } }) })
    const failed = results.filter(r => r.status === 'fail')
    expect(failed).toHaveLength(1)
    expect(failed[0].name).toMatch(/deep link/)
    expect(failed[0].detail).toBe('HTTP 404')
  })

  it('fails a page that answers 200 but is not the application (for example a parked-domain page)', async () => {
    const results = await runSiteChecks({ appUrl: 'https://x.example', fetchImpl: site({ '/': { status: 200, html: '<html>Welcome to nginx</html>' } }) })
    expect(results[0]).toMatchObject({ status: 'fail', detail: 'the response is not the application page' })
  })

  it('reports an unreachable site as a failure rather than crashing', async () => {
    const results = await runSiteChecks({ appUrl: 'https://x.example', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND') } })
    expect(results.every(r => r.status === 'fail')).toBe(true)
    expect(results[0].detail).toMatch(/ENOTFOUND/)
  })
})
