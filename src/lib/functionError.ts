// supabase-js hides an Edge Function's error body behind a generic "Edge Function returned a
// non-2xx status code" whenever the function answers with a non-2xx status. The useful message
// (for example "Your plan includes 25 instructor accounts...") is on error.context. This returns
// the most specific message available.
export async function functionErrorMessage(
  error: unknown,
  data?: { error?: string } | null
): Promise<string> {
  if (data?.error) return data.error

  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    const body = await context.json().catch(() => null)
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message
    if (message) return message
  }

  return (error as { message?: string } | null)?.message || 'Request failed'
}
