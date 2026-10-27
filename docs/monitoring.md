# Monitoring: how you find out something is wrong

Four layers, from cheapest to most detailed. The first three cost nothing.

## 1. Is the site up? (you set this up once)
Use any free uptime monitor (for example UptimeRobot or Better Stack's free tier). Add:
- your home page, and
- `https://<your app>/legal/terms` (it needs no sign-in and proves the app bundle loads).

Have it email you after two failed checks. This is the only layer that tells you when the whole site
is down.

## 2. Did a deployment break something? (you run it)
After every production deployment, run the smoke test (see [staging.md](staging.md)):
```bash
node --env-file=.env.production scripts/smoke-test.mjs --credentials .test-credentials.local --app-url https://<your app>
```
It checks the website, sign-in, the database policies and all three functions in under a minute. A
non-zero exit means do not announce the release; roll back first.

## 3. What are users running into? (built in)
When the app hits an error while someone is signed in, it files a short report in your own database
(`client_errors`). This covers screens that crash (they show a "Something went wrong" page instead
of a blank one), uncaught errors, and promises that failed silently.

Read them:
```bash
node --env-file=.env.production scripts/recent-errors.mjs                 # last 24 hours
node --env-file=.env.production scripts/recent-errors.mjs --hours 168     # last week
```
Repeats are grouped, so a bug that hits 50 people is one line with a count, the number of users and
schools affected, the pages, the version of the code, and the top of the stack. Check it daily at
first, and any time a customer says "it did something odd".

**Keep the retention promise:** reports are meant to be kept for 30 days. Run this monthly (put it in
your calendar):
```bash
node --env-file=.env.production scripts/recent-errors.mjs --purge
```

**What is deliberately not in a report:** email addresses and long token-like strings are removed
before storing; web addresses lose everything after the `?` or `#`; no request bodies, no record
contents, no names are sent. Messages can occasionally still contain something personal that cannot
be recognised automatically, which is one reason the retention is short.

### Limits to know about
- **No alerts.** Nothing emails you when errors spike; you look. A hosted tool such as Sentry would
  add alerting, source maps and grouping, at the cost of a new provider that would have to be added
  to the Subprocessors page and the privacy policy. The reporting code is built so that could be
  added in one place (`src/lib/errorReporting.ts`).
- **Stacks are minified** in production, so a line number points into compressed code. The message,
  page and version are usually enough to find the cause; if not, reproduce it on staging.
- **Only signed-in users report.** An error on the sign-in page itself is not recorded (there is no
  account to attach it to); the uptime and smoke checks cover that.
- **Server-side errors are not here.** A failure inside an Edge Function appears in the Supabase
  dashboard under Edge Functions, then the function, then Logs.

## 4. Supabase's own dashboards
Database health, API errors and function logs are in the Supabase dashboard. Look at them when
something is wrong, not as a routine.

## Suggested routine
| When | What |
|---|---|
| After every deployment | Smoke test |
| Daily at first, then weekly | `recent-errors.mjs` |
| Monthly | `recent-errors.mjs --purge`; glance at Dependabot pull requests |
| Always on | Uptime monitor |
