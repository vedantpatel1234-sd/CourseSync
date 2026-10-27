# Staging environment

Staging is a second, separate copy of CourseSync with its own database, its own functions and its own
test data. You try every change there first, so mistakes cost nothing. Nothing in staging touches
production, and it holds no real customer information.

**The one rule:** staging and production must never share a database, a key, or an AI key. Everything
below exists to keep them apart.

## What you set up once

### 1. A second Supabase project
Supabase dashboard, then New project. Name it `coursesync-staging` and choose **the same region as
production** (Canada), so you test the same conditions. The free tier is fine for staging.

### 2. Build its database with one paste
In this repository:
```bash
node scripts/build-schema.mjs
```
Open the staging project's SQL editor, paste the contents of `build/schema.sql`, and run it. It
creates every table, policy and function in the right order. A test proves this file builds exactly
the same database as running the migrations one at a time. **Only ever use it on a new, empty
project**; it will fail on production, which is the safe outcome.

### 3. Authentication settings (staging project)
- Authentication, then Providers, then Email: turn **off** "Allow new users to sign up".
- Authentication, then URL Configuration: set the Site URL to your staging address and add
  `<your staging address>/set-password` to the Redirect URLs.
- Email OTP expiry: raise it (the default is short) so invitation links last a day.

### 4. Deploy the functions to staging
```bash
npx supabase login
npx supabase functions deploy manage-instructor --no-verify-jwt --project-ref <staging-ref>
npx supabase functions deploy manage-staff      --no-verify-jwt --project-ref <staging-ref>
npx supabase functions deploy ai-proxy          --no-verify-jwt --project-ref <staging-ref>
npx supabase secrets set ANTHROPIC_API_KEY=<a SEPARATE key> --project-ref <staging-ref>
```
Use a **separate** Anthropic key for staging, ideally with a low spending limit, so testing can never
spend production credit or share its limits.

### 5. Point Vercel previews at staging
Vercel project, then Settings, then Environment Variables. Add these, ticking **only "Preview"**
(not Production):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | the staging project URL |
| `VITE_SUPABASE_ANON_KEY` | the staging project's anon key |
| `VITE_APP_ENV` | `staging` |
| `VITE_SUPPORT_EMAIL` | your support address |

Check that the existing production values are ticked for **Production only**. After this, every
pull request gets its own preview website that talks to staging, shows a dark "STAGING ENVIRONMENT"
strip across the top, and asks search engines not to index it. The live site is unchanged.

For a stable address (useful for the redirect setting above), give the Vercel project a domain tied to
a long-lived `staging` branch, and use that in step 3.

### 6. Local settings for the scripts
Create `.env.staging` (git ignores `.env*`):
```
SUPABASE_URL=https://<staging-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
SUPABASE_ANON_KEY=<staging anon key>
```
Keep your production settings in a differently named file (for example `.env.production`) and always
read the filename before you run a script. The service-role key bypasses all protections: never put
it in Vercel, in the app, or in chat.

### 7. Create test data and prove it all works
```bash
node --env-file=.env.staging scripts/seed-test-school.mjs --confirm-project <staging-ref> --app-url <staging address>
node --env-file=.env.staging scripts/smoke-test.mjs --credentials .test-credentials.local --app-url <staging address>
```
The first creates a test school with one account per role (passwords go only to
`.test-credentials.local`). The second signs in as those users and checks the website, the database
policies and all three functions, without sending any email, deleting anything or calling the AI.
When it prints "0 failed", the environment works.

## How a change reaches production

1. **Branch and pull request.** CI runs lint, type-checks, the 700-odd tests and a build. Vercel
   builds a preview that uses staging.
2. **If it includes a database migration:** run it on staging first (SQL editor), then click through
   the affected screens on the preview.
3. **If it changes a function:** deploy it to staging, then run the smoke test.
4. **Merge.** Vercel deploys the app to production.
5. **Apply to production, in this order:** back up; run the migration in the production SQL editor;
   deploy the function; then run the smoke test against production with a test school, or at least
   sign in and check the screens you changed.
6. **If something is wrong:** the migration rollback scripts are in `migrations/rollback/`; a previous
   deployment can be promoted again from the Vercel dashboard.

## What staging does not prove

- Real email delivery from your production mail provider (staging uses Supabase's built-in sender,
  which is limited to a few messages an hour).
- Performance with a large school's data.
- Anything about billing with real invoices.
