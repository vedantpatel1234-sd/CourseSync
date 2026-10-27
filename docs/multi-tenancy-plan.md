# Multi-tenancy plan (Phase 1)

Status: **approved, not yet implemented.** Decisions made:

1. One organization per user for v1 (memberships/org switcher deferred; keep everything behind
   `app_org_id()` / `app_role()` so it can be added later).
2. Organizations are created by the vendor (sales-led), via a protected function — no public signup.
3. A separate staging Supabase project is used for all policy work.

Step 0 (baseline schema dump) is next; `scripts/dump-schema.sql` produces it.

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
- **New `provision-organization`** (see decision 2): creates an org and invites its first admin.

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

| # | Step | Needs you? |
|---|------|-----------|
| 0 | Dump the live schema (tables, constraints, triggers, FKs) into the repo as `migrations/000_baseline.sql`; check `terms_acceptance` RLS; create the staging project | Yes — SQL editor / dashboard |
| 1 | Migration 009: `organizations`, helper functions, add `organization_id` (nullable), backfill all existing rows into one org, then `NOT NULL` + default + index | Review |
| 2 | Migration 010: restrictive `tenant_isolation` policy on all 15 tables; per-org unique constraints; RLS on `terms_acceptance`; table-coverage check | Review |
| 3 | Edge Functions: org-aware `manage-instructor` (incl. delete ownership check); `provision-organization` | Deploy |
| 4 | Client: org in auth store and sidebar; tests | |
| 5 | **Isolation test suite** against staging: two orgs, users in each; for every table and every operation assert zero cross-org reads and writes | Test credentials |
| 6 | Production rollout: backup first, run 009 then 010, verify, deploy functions | Yes |

Rollback: 009 only adds columns and a table (safe to leave in place). 010 can be reverted by
dropping the `tenant_isolation` policies; keep that script alongside the migration.

## 5. Testing

The current 306 vitest tests mock Supabase, so they **cannot** prove tenant isolation. Step 5 is
the real safety net: a script that signs in as real users from two orgs on the staging project and
tries every table with every operation (select / insert / update / delete), plus the Edge Function
cross-org delete. Nothing in this phase counts as done until that suite passes.

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
