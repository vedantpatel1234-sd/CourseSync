import { describe, it, expect } from 'vitest'
import { functionErrorMessage } from './functionError'

const httpError = (body: unknown, message = 'Edge Function returned a non-2xx status code') =>
  Object.assign(new Error(message), {
    context: { json: () => (body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(body)) }
  })

describe('functionErrorMessage', () => {
  it('prefers an error message returned in the response data', async () => {
    expect(await functionErrorMessage(new Error('generic'), { error: 'Email already in use' })).toBe('Email already in use')
  })

  it('reads the message from the response body when supabase-js reports a non-2xx status', async () => {
    const error = httpError({ error: 'Your plan includes 25 instructor accounts and all are in use.', code: 'seat_limit' })
    expect(await functionErrorMessage(error, null)).toBe('Your plan includes 25 instructor accounts and all are in use.')
  })

  it('reads a nested error.message body', async () => {
    expect(await functionErrorMessage(httpError({ error: { message: 'Rate limited' } }), null)).toBe('Rate limited')
  })

  it('falls back to the error message when the body is not JSON', async () => {
    expect(await functionErrorMessage(httpError(undefined, 'boom'), null)).toBe('boom')
  })

  it('falls back to the error message when the body has no error field', async () => {
    expect(await functionErrorMessage(httpError({ ok: false }, 'oops'), null)).toBe('oops')
  })

  it('falls back to a generic message when there is nothing else', async () => {
    expect(await functionErrorMessage(null, null)).toBe('Request failed')
    expect(await functionErrorMessage({}, undefined)).toBe('Request failed')
  })
})
