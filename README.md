# CourseSync

Academic scheduling SaaS for assigning instructors to course sections. Built for three roles —
**admin** (full control), **coordinator** (read-only oversight), and **instructor** (self-service
qualifications, preferences, and availability) — with an AI layer on top for the repetitive parts
of scheduling: drafting a full schedule, parsing a resume into a pre-filled instructor form,
mapping a messy CSV to the right columns, summarizing the week's scheduling health, and a chat
assistant that can look up data and stage (never silently execute) changes for an admin to confirm.

## Tech stack

- **Frontend**: React 19 + TypeScript + Vite, React Router, Zustand for auth state, Tailwind +
  inline styles, Recharts for analytics, `@dnd-kit` for drag-to-rank preferences.
- **Backend**: Supabase (Postgres + Auth + Row-Level Security) plus two Supabase Edge Functions
  (`ai-proxy`, `manage-instructor`) for anything that needs a server-side secret.
- **AI**: Claude (Anthropic API), called only from the server-side `ai-proxy` function — the
  browser never holds an Anthropic API key.
- **Testing**: Vitest + React Testing Library — 274 tests across every `src/lib` module and every
  page component.

## Core features

| Role | Can do |
|---|---|
| Admin | Manage courses, sections, terms, instructors; assign instructors manually or via the Matching Engine; build draft ("sandbox") schedules and publish them with conflict resolution; view analytics, calendar, and the audit log; bulk CSV import; the AI features below |
| Coordinator | Read-only views of assignments, instructor workload, and analytics |
| Instructor | Manage qualifications, rank section preferences (drag and drop), set weekly availability, view assigned sections, manage notification preferences |

**AI features** (admin only, routed through `ai-proxy`):
- **Scheduling Copilot** — a chat assistant that answers questions from real data and can stage
  (`propose_*`) an assignment or draft for the admin to confirm or cancel; it never writes to the
  database on its own.
- **Auto-Scheduler** — generates a full draft schedule for a term in one click; every proposed
  assignment is re-validated against the same conflict-checking logic used everywhere else before
  it's accepted, so the AI can suggest but never override the actual scheduling rules.
- **Resume parsing** — upload a PDF and pre-fill the "add instructor" form, with suggested course
  qualifications matched against the real course catalog.
- **Smart CSV import** — maps a CSV's own column headers to the expected fields when they don't
  already match exactly, so courses/instructors can be imported without reformatting the file.
- **Weekly digest** — summarizes unfilled sections, overloaded instructors, and underutilized
  instructors from real computed stats (the model never invents a number).

## Project structure

```
src/
  lib/                   business logic: conflict checking, the auto-scheduler, copilot tools,
                          CSV mapping/validation, weekly digest stats, the ai-proxy client, etc.
                          (every file here has a matching *.test.ts)
  pages/
    admin/                full CRUD + AI features
    coordinator/          read-only views
    instructor/           self-service pages
  components/             Sidebar, layout, shared modals
  stores/                 Zustand auth store
supabase/functions/
  ai-proxy/                server-side Anthropic proxy — holds the real API key
  manage-instructor/       server-side instructor account creation/deletion
migrations/               numbered SQL migrations — run manually in the Supabase SQL editor,
                          in order; nothing here is applied automatically
```

## Getting started

### Prerequisites
- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://console.anthropic.com) API key (for the AI features)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Create `.env.local` with:
```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```
The Anthropic key is **not** a client-side variable — see Edge Functions below.

### 3. Set up the database
Run the files in `migrations/` in order in your Supabase project's SQL editor:

- `000_baseline.sql` — the base tables. **Fresh projects only**; the existing production database already has them.
- `001_...` through `009_...` — features, row-level security (`006` is the big one), and the
  `terms_acceptance` security fix (`009`).
- `010_multi_tenancy_schema.sql` and `011_tenant_isolation_policies.sql` — organizations and
  per-organization data isolation. See [docs/multi-tenancy-plan.md](docs/multi-tenancy-plan.md).
  Deploy the updated `manage-instructor` Edge Function immediately after `010`, because the
  previous version can't insert profiles once they require an organization.
- `014_data_deletion.sql` — `delete_organization_data()` and `erase_person_data()`, service role
  only. Run it before deploying the updated `manage-instructor`, which now calls `erase_person_data`.
- `012_billing_and_ai_usage.sql` and `013_org_standing.sql` — plans, limits, AI usage metering and
  the account-standing check. See [docs/phase-2-plan.md](docs/phase-2-plan.md). **Run `012` before
  deploying the new `ai-proxy` and `manage-instructor`**: they read these tables and refuse to act
  (fail closed) if they are missing.

`migrations/rollback/` holds scripts to undo a migration; they are never run automatically.

### 4. Deploy the Edge Functions
```bash
npx supabase functions deploy ai-proxy --no-verify-jwt
npx supabase functions deploy manage-instructor --no-verify-jwt
npx supabase functions deploy manage-staff --no-verify-jwt
npx supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key
```
`ai-proxy` forwards requests to Claude using this secret; the browser bundle never sees it.
`manage-instructor` and `manage-staff` (which invites and removes administrators and coordinators; instructors have their own function) only need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` — Supabase injects these into every Edge Function automatically, so
no extra `secrets set` is needed for it.

New instructors are invited by email: `manage-instructor` calls Supabase's invite API and the
instructor picks their own password on the `/set-password` page, so no password is ever typed or
shown by an admin. "Forgot password?" on the sign-in page uses the same page.

### 4b. Configure Auth redirects and email
In the Supabase dashboard under **Authentication → URL Configuration**, set **Site URL** to your
deployed app URL and add `https://<your-app>/set-password` (and `http://localhost:5173/set-password`
for local dev) to **Redirect URLs** — invitation and reset links are rejected otherwise.

Supabase's built-in email sender is for testing only (a few emails per hour, shared sender
address). Before inviting a real department, configure custom SMTP under
**Authentication → SMTP Settings**.

### 5. Create your first organization
Organizations (schools) are created by you, not through public signup. With the service-role key
in a git-ignored `.env.provision` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):
```bash
node --env-file=.env.provision scripts/provision-org.mjs   --name "Fraser Valley College" --slug fraser-valley   --admin-email dean@example.com --admin-name "Dana Lee"   --redirect https://your-app.example/set-password
```
This creates the organization and emails its first admin an invitation. The service-role key
bypasses all row-level security: keep it on your own machine, never in the app or in chat.

### 6. Plans, limits and the signed agreement
Every new organization starts on a 30-day trial (25 instructor accounts, 1,000,000 AI tokens per
month). Existing organizations get an active, unlimited "internal" plan when `012` runs. You set a
school's plan by hand with the same `.env.provision`:
```bash
node --env-file=.env.provision scripts/set-billing.mjs --slug fraser-valley   --plan standard --status active --max-instructors 120 --ai-limit 5000000   --msa-version 2026-11-01 --msa-signed-at 2026-11-02 --msa-signed-by "Dana Lee"
```
Statuses are `trial`, `active`, `past_due` (keeps working, admins see a banner), `suspended` and
`canceled` (the app shows a paused screen; nothing is deleted). Other options: `--ai on|off`,
`--trial-days N`, and `unlimited` for either limit. Invoices are issued outside the app. Set
`VITE_SUPPORT_EMAIL` in Vercel so "contact us" messages show your address.

### 7. Legal documents
The Terms of Service, Privacy Policy, Subprocessors, Data Processing Addendum and Security overview
are plain Markdown in `src/legal/content/`, served publicly at `/legal/terms`, `/legal/privacy`, etc.
**They are drafts.** Text in `[BRACKETS]` is a placeholder or something to verify, and every page
carries a "Draft, not yet in effect" banner. Have a lawyer review them, fill in the placeholders,
then set `LEGAL_STATUS` to `'final'` in `src/legal/index.ts`; a test refuses that while any
`[bracketed]` text remains. When the terms change in a way users must agree to again, bump
`TERMS_VERSION` and everyone is asked to accept on their next sign-in.

### 8. Giving a school its data, and deleting it
When a school leaves (or asks for its data), with the same `.env.provision`:
```bash
node --env-file=.env.provision scripts/export-org.mjs --slug fraser-valley     # writes ./exports/...
node --env-file=.env.provision scripts/delete-org.mjs --slug fraser-valley   --confirm-slug fraser-valley --export-dir exports/fraser-valley-2027-03-01    # dry run: changes nothing
# ...same command plus --execute to delete permanently
```
The export is a folder of CSV files (a readable `schedule.csv` plus the raw tables), `organization.json`
and a `manifest.json`. It contains personal information: send it over a secure channel and delete
your copy afterwards (`exports/` is git-ignored). Deletion refuses to run unless the slug is
confirmed, the export is for that organization and still matches the live data, and `--execute` is
given. It deletes in one all-or-nothing database operation, then the sign-in accounts; any account
it cannot remove is listed so you can delete it in the Supabase dashboard. Deleting an individual
instructor from the app also scrubs their name and email from activity records and weekly summaries.

### 9. Trying the app with a test school
To sign in and click around without touching a real school, create a clearly-labelled test school:
```bash
node --env-file=.env.provision scripts/seed-test-school.mjs --confirm-project <your-project-ref>   --app-url https://your-app.example
```
It creates an administrator, a coordinator and two instructors with sample courses, sections and one
assignment. **The passwords are random and are written only to `.test-credentials.local`** (git-ignored;
never printed). `--confirm-project` must match the part of your `SUPABASE_URL` before `.supabase.co`,
so you choose consciously which project receives test accounts; a separate test project is better.
Remove it when you are done:
```bash
node --env-file=.env.provision scripts/delete-org.mjs --slug test-school --confirm-slug test-school --no-export --execute
```
Another way to see the real invitation flow: provision a school with your own email address
(step 5) and accept the invitation from your inbox.

### 11. Staging, monitoring and smoke tests
- [docs/staging.md](docs/staging.md): set up a second environment and the path a change takes to production.
  `node scripts/build-schema.mjs` writes one SQL file that builds a **new, empty** project; a test proves it
  matches the migrations. Previews of pull requests can use staging and show a "STAGING" strip.
- [docs/monitoring.md](docs/monitoring.md): the app reports its own errors to your database (migration `015`);
  `scripts/recent-errors.mjs` shows them grouped, and `--purge` keeps the 30-day retention.
- `scripts/smoke-test.mjs` signs in as test users and checks the website, the database policies and all three
  Edge Functions without sending anything or calling the AI. Run it after every deployment.

### 10. Run it
```bash
npm run dev
```

## What is left

See [docs/whats-left.md](docs/whats-left.md) for the prioritised list of remaining work, including a runbook of what to do in Supabase, Vercel and GitHub.

## Continuous integration

Every pull request and push to `master` runs `.github/workflows/ci.yml`: lint, type-check (app, tests and shared function logic), the full test suite including the database isolation tests, a production build, and an audit of production dependencies. `npm run check` runs lint, type-check and tests locally. Dependabot opens weekly grouped update PRs.

## Testing

```bash
npm test        # run once (includes the tenant-isolation suite below)
npm run test:watch   # watch mode
```

Besides the component and library tests under `src/` (which mock Supabase), `tests/rls/` runs the
real migrations in an in-process Postgres ([PGlite](https://pglite.dev)) and checks, as actual
database roles, that one organization can never read or change another's data. `tests/provision/`
covers the onboarding script's rollback behaviour. Neither needs a Supabase project or Docker.

`src/a11y/` renders every route as every role and runs the axe accessibility engine over it, with forms
open; a separate test checks text-colour contrast. See [docs/accessibility.md](docs/accessibility.md) for what
is and is not covered, and the manual checks still to do.

## Other scripts

```bash
npm run build     # type-check + production build
npm run lint      # eslint
npm run preview   # preview the production build locally
```
