// Checks that a deployed environment (staging, or production with a test school) actually works:
// the database policies, the three Edge Functions, and the sign-in path. Used by
// scripts/smoke-test.mjs; the client is created by a factory passed in, so the checks can be tested.
//
// Every check is built to have no side effects and no cost. Function calls are requests that must
// be REFUSED or REJECTED (an invalid role, a person who does not exist, a model that is not
// allowed). A refusal at the right point proves the function is deployed, can read its settings and
// the database, and enforces its rules, without inviting anyone, deleting anything or calling the AI.
// The one write is a clearly-marked error report, which proves error monitoring is wired up and is
// purged with the rest.

const NO_SUCH_USER = '00000000-0000-4000-8000-000000000000'

/** Calls an Edge Function and returns its HTTP status and JSON body, whether it succeeded or not. */
export async function callFunction(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (!error) return { status: 200, body: data }
  const response = error.context
  if (response && typeof response.json === 'function') {
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  return { status: 0, body: null, networkError: error.message }
}

const describeResult = r =>
  r.networkError ? `no response (${r.networkError})` : `HTTP ${r.status} ${JSON.stringify(r.body)}`

/** @returns {{ name: string, status: 'pass' | 'fail' | 'skip', detail?: string }[]} */
export async function runSmokeTests({ makeClient, credentials }) {
  const results = []

  const check = async (name, fn) => {
    try {
      const detail = await fn()
      results.push({ name, status: 'pass', ...(detail ? { detail } : {}) })
    } catch (err) {
      results.push({ name, status: 'fail', detail: err instanceof Error ? err.message : String(err) })
    }
  }
  const skip = (name, reason) => results.push({ name, status: 'skip', detail: reason })
  const expectCall = (result, status, code) => {
    if (result.status !== status || (code !== undefined && result.body?.code !== code)) {
      throw new Error(`expected HTTP ${status}${code ? ` with code "${code}"` : ''}, got ${describeResult(result)}`)
    }
  }

  // ---- A visitor who is not signed in -----------------------------------------------------
  const anonymous = makeClient()
  for (const fn of ['manage-staff', 'manage-instructor', 'ai-proxy']) {
    await check(`${fn} refuses a request with no sign-in`, async () => {
      expectCall(await callFunction(anonymous, fn, {}), 401)
    })
  }

  // ---- An administrator -------------------------------------------------------------------
  const admin = makeClient()
  let adminSignedIn = false
  await check('the administrator can sign in', async () => {
    if (!credentials.admin) throw new Error('no admin credentials were provided')
    const { error } = await admin.auth.signInWithPassword(credentials.admin)
    if (error) throw new Error(error.message)
    adminSignedIn = true
  })

  if (!adminSignedIn) {
    for (const name of [
      'the administrator sees exactly one organization', 'the administrator reads billing standing',
      'every profile the administrator can see is in their own organization', 'the administrator can read their plan',
      'manage-staff checks the role of an invitation', 'manage-staff will not remove a person who does not exist',
      'manage-staff will not remove your own account', 'manage-instructor requires a name and email',
      'manage-instructor will not delete a person who does not exist', 'ai-proxy rejects a model that is not allowed',
      'an error report can be filed, and cannot be read back'
    ]) skip(name, 'the administrator could not sign in')
  } else {
    await check('the administrator sees exactly one organization', async () => {
      const { data, error } = await admin.from('organizations').select('id, name')
      if (error) throw new Error(error.message)
      if (data.length !== 1) throw new Error(`expected 1 organization, saw ${data.length}`)
      return data[0].name
    })

    await check('the administrator reads billing standing', async () => {
      const { data, error } = await admin.rpc('org_standing')
      if (error) throw new Error(error.message)
      if (!Array.isArray(data) || data.length !== 1) throw new Error(`expected one standing row, got ${JSON.stringify(data)}`)
      return data[0].subscription_status
    })

    await check('every profile the administrator can see is in their own organization', async () => {
      const { data, error } = await admin.from('profiles').select('organization_id')
      if (error) throw new Error(error.message)
      const orgs = new Set(data.map(p => p.organization_id))
      if (orgs.size !== 1) throw new Error(`profiles from ${orgs.size} organizations are visible`)
    })

    await check('the administrator can read their plan', async () => {
      const { data, error } = await admin.from('organization_billing').select('plan, subscription_status')
      if (error) throw new Error(error.message)
      if (data.length !== 1) throw new Error(`expected 1 billing row, saw ${data.length}`)
      return `${data[0].plan} / ${data[0].subscription_status}`
    })

    await check('manage-staff checks the role of an invitation', async () => {
      expectCall(await callFunction(admin, 'manage-staff', {
        action: 'invite', full_name: 'Smoke Test', email: 'smoke-test@example.com', role: 'instructor'
      }), 400, 'invalid_role')
    })

    await check('manage-staff will not remove a person who does not exist', async () => {
      expectCall(await callFunction(admin, 'manage-staff', { action: 'remove', user_id: NO_SUCH_USER }), 404, 'not_found')
    })

    await check('manage-staff will not remove your own account', async () => {
      const { data } = await admin.auth.getUser()
      if (!data?.user) throw new Error('could not look up the signed-in user')
      expectCall(await callFunction(admin, 'manage-staff', { action: 'remove', user_id: data.user.id }), 400, 'cannot_remove_self')
    })

    await check('manage-instructor requires a name and email', async () => {
      expectCall(await callFunction(admin, 'manage-instructor', { action: 'create' }), 400)
    })

    await check('manage-instructor will not delete a person who does not exist', async () => {
      expectCall(await callFunction(admin, 'manage-instructor', { action: 'delete', instructor_id: NO_SUCH_USER }), 404)
    })

    // This one reaches past the plan and usage checks to the model check, so it proves billing and
    // usage lookups work, and that the server (not the browser) decides which model runs. No AI call is made.
    await check('ai-proxy rejects a model that is not allowed', async () => {
      expectCall(await callFunction(admin, 'ai-proxy', {
        model: 'not-a-real-model', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }]
      }), 400, 'model_not_allowed')
    })

    await check('an error report can be filed, and cannot be read back', async () => {
      const { error } = await admin.from('client_errors').insert({
        message: 'smoke test: safe to ignore', source: 'manual', path: '/smoke-test'
      })
      if (error) throw new Error(`could not file a report: ${error.message}`)
      const { data, error: readError } = await admin.from('client_errors').select('id')
      if (readError) throw new Error(readError.message)
      if (data.length !== 0) throw new Error(`reports are readable by users (${data.length} rows visible)`)
    })
  }

  // ---- An instructor ----------------------------------------------------------------------
  const instructor = makeClient()
  let instructorSignedIn = false
  if (credentials.instructor1) {
    await check('the instructor can sign in', async () => {
      const { error } = await instructor.auth.signInWithPassword(credentials.instructor1)
      if (error) throw new Error(error.message)
      instructorSignedIn = true
    })
  } else {
    skip('the instructor can sign in', 'no instructor credentials were provided')
  }

  const instructorChecks = [
    'manage-staff refuses an instructor', 'ai-proxy refuses an instructor',
    'an instructor cannot read the plan or billing details'
  ]
  if (!instructorSignedIn) {
    for (const name of instructorChecks) skip(name, 'the instructor could not sign in')
  } else {
    await check('manage-staff refuses an instructor', async () => {
      expectCall(await callFunction(instructor, 'manage-staff', { action: 'remove', user_id: NO_SUCH_USER }), 403)
    })
    await check('ai-proxy refuses an instructor', async () => {
      expectCall(await callFunction(instructor, 'ai-proxy', {
        model: 'not-a-real-model', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }]
      }), 403)
    })
    await check('an instructor cannot read the plan or billing details', async () => {
      const { data, error } = await instructor.from('organization_billing').select('plan')
      if (error) throw new Error(error.message)
      if (data.length !== 0) throw new Error('an instructor can read the billing row')
      const standing = await instructor.rpc('org_standing')
      if (standing.error || standing.data.length !== 1) throw new Error('an instructor cannot read their own standing')
    })
  }

  return results
}

/** Human-readable summary of the results, and whether everything passed. */
export function formatResults(results) {
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'skip' }
  const lines = results.map(r => `  ${mark[r.status]}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
  const count = s => results.filter(r => r.status === s).length
  lines.push('', `${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`)
  return { text: lines.join('\n') + '\n', ok: count('fail') === 0 && count('pass') > 0 }
}

/**
 * Checks the deployed website itself: that deep links work (every invitation and password-reset
 * email lands on one) and that the public legal pages are served. `fetchImpl` is injectable for tests.
 */
export async function runSiteChecks({ appUrl, fetchImpl = fetch }) {
  const base = appUrl.replace(/\/+$/, '')
  const results = []
  const pages = [
    ['the home page loads', '/'],
    ['a deep link loads (invitation and reset emails depend on this)', '/set-password'],
    ['the public terms page loads without signing in', '/legal/terms'],
    ['the public privacy page loads without signing in', '/legal/privacy']
  ]
  for (const [name, path] of pages) {
    try {
      const response = await fetchImpl(`${base}${path}`)
      const html = await response.text()
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      if (!html.includes('id="root"')) throw new Error('the response is not the application page')
      results.push({ name, status: 'pass' })
    } catch (err) {
      results.push({ name, status: 'fail', detail: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
