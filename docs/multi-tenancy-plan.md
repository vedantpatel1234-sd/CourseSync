# Multi-tenancy plan (Phase 1)

Status: **migrations, tests, Edge Function and client written; nothing has been run against a real
Supabase project yet.** Decisions made:

1. One organization per user for v1 (memberships/org switcher deferred; keep everything behind
   `app_org_id()` / `app_role()` so it can be added later).
2. Organizations are created by the vendor (sales-led), via a protected function — no public signup.
3. Policy work is verified against an in-process Postgres (`tests/rls/`) first; a separate staging
   Supabase project is still used for a rehearsal before production.

### Findings from the live schema dump

- `terms_acceptance` had **row-level security disabled** (confirmed). Fixed by migration 009, which
  is safe to run on its own, immediately.
- The database has a `public.auto_confirm_email()` function, presumably wired to a trigger on
  `auth.users`, that confirms every new account's email. Combined with public sign-ups and the
  `USING (true)` read policies (`profiles`, `courses`, `terms`, `sections`, ...), a stranger could
  create an account and read every profile. Migration 011 closes the data side (a user with no
  profile matches nothing). **Also disable "Allow new users to sign up"** in Supabase
  (Authentication → Providers → Email); admin-created and invited accounts are unaffected. Check
  for the trigger with
  `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;`
  and drop it if present.
- Repo/database drift: the live partial unique index is `one_instructor_per_section`, not the name
  in migration 002 (now corrected), and migration 008 has not been applied to production.
- The live trigger function `update_section_status()` is not SECURITY DEFINER; it keeps working
  under tenant isolation because it only touches rows in the caller's own organization.

Goal: one deployment serves many colleges. A user at College A can never read or write
anything belonging to College B, even by calling the Supabase API directly.

## 1. Where we are today

- Every table is flat. There is no column anywhere that says which school a row belongs to.
- Isolation is by **role only** (`app_role()` = admin / coordinator / instructor), enforced in
  `migrations/006_row_level_security.sql` plus `007`.
- Several policies are literally `USING (true)` for any signed-in user:
  `profiles`, `instructor_profiles`, `courses`, `terms`, `sections` are readable by **every
  authenticated user**. With two schools in one database, school B's admin could read school A's
  staff list with one query.
- Application code is already RLS-reliant: pages don't filter by tenant, they just `select`.
  This is good news — once the database filters by org, almost no page code changes.
- Unfiltered client writes exist and are only safe because of RLS. Example:
  `Terms.tsx:80` runs `update({ is_active: false }).neq('id', term.id)` over **all** terms.
  Without an org filter in the database, setting one school's active term would deactivate every
  school's. This is the kind of bug the restrictive policy below prevents.
- The base tables (`profiles`, `courses`, `terms`, `sections`, `assignments`, ...) were created in
  the Supabase dashboard; `migrations/` only starts at 001. We do not have the baseline schema in
  the repo, so unique constraints, triggers and foreign keys are unknown until we dump them.

### Existing issue to check now (independent of multi-tenancy)

`terms_acceptance` is written by `TermsModal.tsx` and read by the auth store, but **migration 006
never enabled RLS on it**. If RLS is off, anyone with the public anon key can read or write that
table. Verify in the Supabase SQL editor:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
```

Every row should show `rowsecurity = true`.

## 2. Design

### 2.1 Data model

New table:

```sql
organizations (id uuid pk, name text not null, slug text unique, created_at timestamptz)
```

Add `organization_id uuid not null references organizations(id)` to **every** tenant table:
`profiles, instructor_profiles, courses, terms, sections, assignments, instructor_availability,
preferences, qualifications, notifications, notification_preferences, drafts, digests,
audit_logs, terms_acceptance` (15 tables).

Denormalised on purpose: child tables (e.g. `qualifications`) could derive their org through a
join, but a direct column keeps every policy a one-column comparison with an index, and keeps
the policies impossible to get subtly wrong.

### 2.2 Stamping the org without touching 22 insert sites

The app has ~22 client-side `.insert()` calls. Rather than edit them all, the column gets a
database default:

```sql
alter table courses alter column organization_id set default app_org_id();
```

`app_org_id()` is a `SECURITY DEFINER STABLE` helper, exactly like the existing `app_role()`:
`select organization_id from profiles where id = auth.uid()`. Client inserts get the caller's org
automatically; a client **cannot** choose a different one (see 2.3). Service-role code (Edge
Functions) has no `auth.uid()` and must pass the org explicitly.

### 2.3 Isolation: one RESTRICTIVE policy per table

```sql
create policy tenant_isolation on courses
  as restrictive for all to authenticated
  using (organization_id = app_org_id())
  with check (organization_id = app_org_id());
```

A restrictive policy is **ANDed** with every existing permissive policy. So:

- The ~40 existing role policies in 006/007 stay exactly as they are (smaller diff, smaller risk).
- A permissive policy added later by mistake can't widen access across tenants.
- Reads, inserts, updates and deletes are all covered, and `WITH CHECK` stops a user from writing
  a row (or moving one) into another org.

Guard against forgetting a future table: add a check that fails if any `public` table lacks an
`organization_id` column or a `tenant_isolation` policy.

### 2.4 Uniqueness becomes per-org

Anything that is unique "globally" today must become unique per org, or school B can't create a
course code school A already uses. Known candidates (confirm against the dumped schema):

- `courses.code`
- `terms` — "one active term" is enforced only in app code (`Terms.tsx:80-81`, two non-atomic
  statements). Replace with a partial unique index `(organization_id) where is_active`.
- `profiles.email`
- `one_live_assignment_per_section` (migration 002) is keyed by `section_id`, which is already
  org-specific — no change needed.

### 2.5 Edge Functions (service role bypasses RLS, so these need care)

- **`manage-instructor`**: stamp the new profile with the **caller's** org, read from the caller's
  own profile — never from the request body. `delete` currently deletes any `instructor_id` it is
  given; it must first confirm the target belongs to the caller's org, or an admin at one school
  could delete another school's staff by UUID. This is the single most important code change.
- **`ai-proxy`**: no tenant data access (it only forwards prompts). No change now. Per-org usage
  metering is a Phase 2 billing item.
- **Provisioning** (decision 2): a local script, `scripts/provision-org.mjs`, run by the vendor
  with the service-role key. Chosen over a deployed function so there is no network endpoint that
  can create organizations and send invitation emails.

### 2.6 Client changes (small)

- Auth store: load `organization_id` and org name with the profile; show the org name in the
  sidebar.
- No page-level query changes expected. Existing vitest mocks keep working.
- Import validation (`importValidation.ts`) already checks duplicates via RLS-scoped queries, so it
  becomes per-org automatically.

## 3. Decisions needed from you

1. **One org per user, or users in several orgs?**
   Today `profiles.id` = `auth.users.id`, so one login = one profile = one org. Adjuncts who
   teach at two colleges are common; with the simple design they can't use the same email at both,
   and the invite fails with "already registered". Supporting it means replacing the profile role
   with a `memberships (user_id, organization_id, role)` table plus an org switcher — roughly
   doubling this phase.
   *Recommendation: ship v1 with one org per user, centralise everything behind `app_org_id()` /
   `app_role()` so memberships can be added later. Tell prospects about the limitation.*

2. **How do new schools get created?**
   (a) Vendor-run: you run a protected function or script per sale. (b) Self-serve public signup.
   Self-serve needs CAPTCHA, rate limiting and email verification so nobody can spam-create orgs
   and send invite emails to arbitrary addresses.
   *Recommendation: (a). Colleges buy through a sales conversation anyway, and it removes the whole
   abuse surface from v1.*

3. **Staging Supabase project.** The policy rewrite must not be developed against production.
   You need to create a second (free) Supabase project; I'll point a staging copy of the app at it.

## 4. Steps

| # | Step | Status |
|---|------|--------|
| 0 | Dump the live schema; check `terms_acceptance` RLS | Done. `migrations/000_baseline.sql` reconstructs the base tables for fresh projects |
| 1 | `010_multi_tenancy_schema.sql` | Written and tested in PGlite |
| 2 | `011_tenant_isolation_policies.sql` (+ `rollback/011_down.sql`), `009_terms_acceptance_rls.sql` | Written and tested in PGlite |
| 3 | `manage-instructor`: stamp the caller's organization, delete only same-organization instructors; `scripts/provision-org.mjs` | Written. The Edge Function runs on Deno and is **not** executed by any test yet |
| 4 | Client: organization name in the sidebar | Done, tolerant of an un-migrated database |
| 5 | Isolation test suite | Done: `tests/rls/` (see section 5) |
| 6 | Rehearse on a staging Supabase project, then production | Not started; needs you |

### Rollout order (production)

1. Back up the database (Supabase dashboard → Database → Backups).
2. Run `009` (can be done any time, independently).
3. Disable public sign-ups; check for and drop the `auto_confirm_email` trigger (see Findings).
4. Run `010`, then **immediately** deploy the new `manage-instructor` (`npx supabase functions
   deploy manage-instructor --no-verify-jwt`). Between those two steps, adding an instructor fails.
5. Run `011`. Verify by signing in as an existing user: everything should look as before.
6. Rename the founding organization:
   `UPDATE organizations SET name = '...', slug = '...' WHERE slug = 'founding';`
7. Create the next school with `scripts/provision-org.mjs`.

Rollback: `010` only adds columns and a table (safe to leave in place). `011` is undone by
`migrations/rollback/011_down.sql`; note that with several organizations present this re-opens
cross-organization access.

## 5. Testing

`tests/rls/` applies every migration, in order, to an in-process Postgres (PGlite) with Supabase's
`auth.uid()` and roles stubbed, then impersonates real database roles. For all 15 tenant tables it
checks that an admin sees only their own organization, an instructor never sees another's, a
signed-in user with no profile sees nothing, and an anonymous caller sees nothing. It also covers
cross-organization insert / update / delete / move attempts (each paired with a control proving the
same operation works on the caller's own rows), the exact bulk update `Terms.tsx` runs, per-organization
uniqueness, the section-status trigger, `terms_acceptance`, a structural guard (every public table
must have a NOT NULL `organization_id`, RLS, and a restrictive `tenant_isolation` policy, so a future
table can't be forgotten), upgrading a populated single-school database, and the rollback script.

The suite was checked against deliberate breakages: dropping the policy from one table, or making it
permissive instead of restrictive, fails tests. (Removing only `WITH CHECK` does not, which is
correct: for a `FOR ALL` policy Postgres reuses `USING` as the write check.)

Not covered: the Edge Functions (Deno), and real Supabase Auth / PostgREST behaviour. Those need the
staging rehearsal.

Known gap, not fixed here: foreign keys do not check that referenced rows are in the same
organization (an admin could, given another organization's UUID, create a row of their own that
references it). Such rows are invisible to the other organization and cannot read its data;
composite foreign keys would close it and are a possible hardening step.

## 6. Risks

- **The policy rewrite is the highest-risk change in the project.** A mistake means one school sees
  another's data. Hence: restrictive policies, staging first, an automated isolation suite.
- **Unknown baseline schema.** Triggers (e.g. the section-status recalculation) or constraints we
  haven't seen could behave differently once org columns exist. Step 0 exists to remove this
  unknown before writing SQL.
- **Backfill.** Existing rows all go to one "founding" org. Low risk today, since there are no
  real customers yet; this gets harder with every customer added later, which is the argument for
  doing it now.
- **Service-role code is outside RLS.** Every Edge Function must be reviewed for tenant checks;
  RLS will not catch mistakes there.
