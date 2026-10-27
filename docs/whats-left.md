# What is left

Written 2026-10-27, after Phase 3's CI pipeline. Priorities: **P0** = before the first real customer
uses it; **P1** = before you rely on it or scale; **P2** = worth doing, can wait. Owner: **You** =
needs your accounts, money or decisions; **Me** = code I can write; **Both**.

## 1. State of the project in one paragraph

CourseSync is a working multi-tenant scheduling product: schools are isolated from each other at the
database level (proven by automated tests), have plans with seat and AI limits, can be paused,
exported and deleted, and sign in by invitation. It has a CI pipeline, 610 tests, and no known
vulnerable dependencies. **Almost none of the newer work has touched your real database or been run
as a real Edge Function.** Everything since migration 008 exists only in the repo and in tests. The
single biggest remaining risk is the first real run of migrations 009 to 014 and the two functions.

## 2. Your runbook, in order (P0, You)

Do these in one sitting if you can.

1. **Close two live security holes.** Supabase dashboard, then Authentication, then Providers, then
   Email: turn off "Allow new users to sign up". Run
   `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;`
   and, if an auto-confirm trigger appears, drop it. Delete the three `@demo.ca` demo accounts.
2. **Anthropic key.** Confirm the key that was ever in the browser bundle is rotated and the new one
   is only in Supabase secrets, and that the account has credits.
3. **Back up** (Database, Backups) and note how to restore.
4. **Run migrations in order, in one sitting:** `008`, `009`, `010`, `011`, `012`, `013`, `014`.
   `010` and `011` need the app idle for a minute or two. (`000` is for new projects only.)
5. **Immediately deploy both functions:**
   `npx supabase functions deploy manage-instructor --no-verify-jwt` and
   `npx supabase functions deploy ai-proxy --no-verify-jwt`.
   Between step 4 and this, adding instructors fails. Earlier notes suggested a staged order; one
   sitting is simpler and the latest function code needs `010` to `014` all present.
6. **Supabase Auth settings:** Site URL = your app URL; add `https://<your-app>/set-password` to
   Redirect URLs; set up custom SMTP (the built-in sender allows only a few emails an hour, so a
   bulk instructor import will mostly fail without it).
7. **Rename your own school:** `UPDATE organizations SET name = '...', slug = '...' WHERE slug = 'founding';`
8. **Create `.env.provision`** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), then rehearse with a
   throwaway school: provision it, set billing, export it, delete it (`provision-org`, `set-billing`,
   `export-org`, `delete-org` in `scripts/`). This is the first real run of that code.
9. **Sign in as yourself** and walk through: login, invite an instructor to a real inbox, set the
   password from the email link, add a section, assign, run an AI feature, open Billing & usage.
10. **Check hosting plans.** Vercel's free (Hobby) plan has historically been for non-commercial
    use only; read the current terms and upgrade before charging anyone. Supabase free projects
    can pause after inactivity and lack proper backups; plan to use a paid tier for production.
    Verify both on the vendors' current pricing pages.
11. **Set `VITE_SUPPORT_EMAIL`** in Vercel so "contact us" shows a real address.
12. **Raise the invitation link lifetime.** Supabase Auth, then Providers, then Email: increase the
    email OTP expiry (the default is short, around an hour). An instructor who opens their invitation
    the next morning otherwise gets an "expired" page; they can recover with "Forgot password?" but
    it is a poor first impression.
13. **Deploy the third function:** `npx supabase functions deploy manage-staff --no-verify-jwt`.
14. **Try it:** `scripts/seed-test-school.mjs` creates a test school with one account per role and
    writes the passwords to a git-ignored file (see the README). Delete it afterwards.
15. **Staging and monitoring** (see [docs/staging.md](staging.md) and [docs/monitoring.md](monitoring.md)):
    run migration `015` in production; create the staging project; set the Vercel *Preview* variables;
    run the smoke test; add an uptime monitor; put "purge error reports" in your monthly calendar.
16. **GitHub:** merge or close the two Dependabot pull requests; turn on branch protection for
    `master` (require the "Lint, type-check, test, build" check). Until you do, CI reports a
    failure but cannot stop a broken push from deploying.

## 3. Product gaps found (code I can write)

| # | Item | Why it matters | Priority | Owner | Size |
|---|------|----------------|----------|-------|------|
| 1 | ~~No way to add admins or coordinators~~ **Done:** `manage-staff` function + "Team & access" page (invite by email, remove with confirmation, cap of 25, drafts handed over on removal) | Needs `manage-staff` deployed | ~~P0~~ | Me | done |
| 2 | Hide AI menu items when an organization's AI is off | The server already refuses; the menu just looks broken | P1 | Me | S |
| 3 | Database-level write block for suspended / canceled schools | Today "paused" is a screen, not a lock. A determined user could still call the API | P1 | Me | M |
| 4 | Self-service export button for admins | Today export is a script only you can run | P1 | Me | M |
| 5 | Roll a term forward (copy last term's sections) | Likely the first thing a scheduler asks for each term | P1 | Me | M |
| 6 | Bundle is over 500 kB: lazy-load routes | Slower first load | P2 | Me | S |
| 7 | Self-host the font | Removes the one third-party request the privacy policy must disclose | P2 | Me | S |
| 8 | Composite foreign keys across organizations | Closes the known "reference another school's id" gap (data stays invisible, but it is untidy and complicates deletion) | P2 | Me | M |
| 9 | Route small AI jobs to a cheaper model | Cuts your Anthropic bill; one line in the allow-list plus call sites | P2 | Me | S |
| 10 | Performance: wrap `app_org_id()` in a subselect in policies | Matters only with large tables | P2 | Me | S |
| 11 | MFA and SSO | Colleges ask for both. Not built; the security page says so honestly | P1 to P2 | Both | L |
| 12 | Accessibility audit (WCAG 2.1 AA) | Public colleges commonly require it and may ask for a conformance report. Nothing has been audited | **P1** | Both | M |
| 13 | Verify mobile layout on real devices | Responsive CSS exists; never checked on a phone | P1 | You | S |
| 14 | SIS / calendar integrations | Expect to be asked; unknown until customers say which | P2 | Both | L |

## 4. Phase 3: operations (in progress)

| Item | Status | Owner |
|------|--------|-------|
| CI pipeline (lint, type-check, tests, build, vulnerability audit) | **Done**, green on GitHub | Me |
| Dependabot weekly PRs | **Done** | Me |
| Fixed 2 high-severity vulnerable dependencies | **Done** (0 now) | Me |
| Branch protection so CI can block a bad push | Not done | You (2 minutes in GitHub settings) |
| **Staging environment**: second Supabase project plus a Vercel preview pointing at it | **Built, not yet created.** One-paste database file (`build-schema`), staging banner, environment-aware previews, smoke test, and the runbook in [docs/staging.md](staging.md). You create the Supabase project and set the Vercel Preview variables | You (about an hour) |
| **Error monitoring** | **Built** (migration `015`, error screen, `recent-errors.mjs`), kept in your own database so it adds no new provider. No alerts or source maps; see [docs/monitoring.md](monitoring.md) for limits and for how Sentry could be added later | Me, done |
| Uptime monitoring and a status page | Described in [docs/monitoring.md](monitoring.md); needs a free account | You (10 minutes) |
| **Tests that really execute the Edge Functions** | **Built** as `scripts/smoke-test.mjs`: calls all three deployed functions with real sessions and checks they answer correctly, with no side effects. It has not yet been run against a real project, so the first run is the real test | You run it |
| End-to-end browser tests for the critical path (login, invite, assign) | Not started | Me |
| Verified backup **and a tested restore** | Not started | You |
| Incident-response runbook (who does what if there is a breach or outage) | Not started. The DPA promises 72-hour notice | Both |

## 5. Phase 2 leftovers

- **Stripe / card payments**: deliberately skipped (you chose invoices). Add only if a customer needs it.
- **Legal documents**: drafts exist, see section 7.
- A GST/HST decision (accountant): registration depends on revenue and customer locations.

## 6. Phase 4: go to market (not started)

| Item | Owner |
|------|-------|
| **A landing page.** Today the site root sends everyone to the login screen; a prospect has nothing to read | Me (copy from you) |
| **A demo environment**: a separate project or organization with fake data that resets nightly. Replaces the demo accounts you deleted | Both |
| Pricing and a pricing page (per instructor? per department? flat tier?) | You decide, I build |
| A one-page overview and a short pre-filled security questionnaire (HECVAT-lite style) | Both |
| A pilot offer: one department free for a term in exchange for feedback and a quote | You |
| Support: a shared mailbox, a response-time promise, an onboarding guide | You |
| Custom domain and professional email addresses (also needed as the invitation email sender) | You |
| **Name check.** Search trademarks and the web for "CourseSync" before spending on branding. I have not checked it | You |

## 7. Legal, without a lawyer

You said a lawyer review isn't available. That is a real limit, so here is the honest position.

**What is true:** the five documents in `src/legal/content/` are drafts written from what the product
actually does. They are not reviewed and I am not a lawyer. The riskiest parts are the limitation of
liability, the indemnity-style wording, the governing-law clause, and any statement of fact about
privacy or security that turns out to be false. A false statement in a privacy policy can create more
trouble than a missing clause.

**What you can do yourself, safely:**
1. **Make every factual claim true.** Resolve each `[VERIFY]`: Supabase region and encryption,
   backup retention, what Anthropic's current terms say about retention and training, which email
   provider you use. Delete any claim you cannot confirm. This part needs no lawyer and matters most.
2. **Fill in the placeholders** (company name, address, contacts, dates, the bracketed numbers).
3. **Keep them in plain language**, which they are.
4. **Treat them as your starting paper, not the final word.** Many public colleges insist on their
   own standard terms and send them to their own legal team; in that case your documents matter
   less and the college's lawyer reviews the contract for you. Ask each prospect early whether they
   use their own paper.
5. **Cheaper routes to a review, when a deal is real:** a short first consultation through your
   provincial law society's referral service, a startup or entrepreneurship program at a university
   or accelerator that offers legal office hours, or a fixed-fee review of only the two or three
   sections that carry risk (liability, indemnity, data protection) rather than all five documents.
   A signed deal pays for a few hours of review; an unreviewed draft is a fair risk before then.
6. **Backstop with insurance:** ask a broker about technology errors-and-omissions and cyber cover.
   Many buyers ask for proof of coverage anyway.
7. **Do not flip `LEGAL_STATUS` to `'final'` until steps 1 and 2 are done.** A test prevents it while
   any `[bracketed]` text remains. The "Draft, not yet in effect" banner is honest, but a prospect
   will notice it, so do not leave it up longer than necessary.

I can help with steps 1 and 2 (for example, listing exactly which statements need checking against
which vendor page) but I cannot replace a lawyer's judgement on the liability and indemnity clauses.

## 8. Business and compliance (You)

- Business bank account, bookkeeping, and an accountant for GST/HST.
- Name yourself (or someone) as the person responsible for privacy; Canadian privacy law expects one.
- Sign or accept each provider's data-processing terms (Supabase, Vercel, Anthropic) and keep copies.
- Understand how your target colleges buy: purchase-size thresholds for direct buying versus a formal
  tender differ by institution. Ask.
- Expect a privacy impact assessment from public colleges; the Security overview and DPA are meant to
  supply what they need.

## 9. Things I have not been able to verify

- Any of migrations 009 to 014, or the two Edge Functions, against your real Supabase project.
- That invitation and reset emails arrive reliably, and what happens to an invite that fails halfway
  (I believe Supabase rolls the user back; I have not seen it).
- Claims in the legal drafts marked `[VERIFY]`.
- That the model name the app sends (`claude-opus-5`) is the one you want to pay for on every call.
- Mobile behaviour on real devices, and accessibility.
- Whether "CourseSync" is free to use as a name.

## 10. Suggested order

1. Section 2, steps 1 to 6 (one evening). Then the throwaway-school rehearsal (step 8).
2. ~~Build #1 (add admins and coordinators)~~ done. Prepare #12 (accessibility).
3. Staging environment + error monitoring + branch protection (finish Phase 3).
4. Landing page + demo environment + pricing (Phase 4).
5. Offer a free pilot to one department. Real feedback decides the rest of section 3.
