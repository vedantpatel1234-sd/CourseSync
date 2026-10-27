export type AppEnvironment = 'production' | 'staging' | 'development'

/**
 * Which deployment this is. Set VITE_APP_ENV=staging in the Vercel *Preview* environment so
 * preview builds say so. Anything unset behaves as before: a production build is "production" and
 * `npm run dev` is "development", so the live site needs no configuration change.
 */
export function getEnvironment(
  declared: string | undefined = import.meta.env.VITE_APP_ENV,
  mode: string = import.meta.env.MODE
): AppEnvironment {
  if (declared === 'staging') return 'staging'
  if (declared === 'production') return 'production'
  return mode === 'production' ? 'production' : 'development'
}

/** Short identifier of the code that is running (the git commit on Vercel), shown in error reports. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
