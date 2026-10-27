# Phase 2 plan: billing and legal

Status: **2a and the in-product legal work are built; legal text is draft; 2b (Stripe), data export /
deletion and the lawyer review remain.** Answers to section 6: invoice billing, incorporated business,
Supabase hosted in Canada, BC/Canadian colleges first.

Built: migrations 012/013 (billing, AI usage, account standing); plan enforcement and server-controlled
model / output limits in `ai-proxy`; seat limit in `manage-instructor`; shared tested decision logic
(`supabase/functions/_shared/entitlements.ts`); paused screen, admin banner and Billing & usage page;
`scripts/set-billing.mjs`; versioned terms acceptance; public `/legal/*` pages with draft documents.

Not built yet: organization export and deletion tooling, the AI on/off menu hiding (the server already
refuses), database-level write blocking for suspended organizations, Stripe, self-hosted fonts.

> **Not legal or tax advice.** Everything under "Legal" below is engineering scaffolding plus
> plain-language *draft* documents to give a lawyer a head start. Contracts, the privacy policy and
> the DPA need review by a lawyer who works with Canadian software companies before a real school
> signs anything. Tax registration and collection rules need an accountant.

## 1. Where we are

- **Legal text is a placeholder.** `TermsModal.tsx` shows two sentences and a checkbox reading
  "I agree to the Terms of Service and Privacy Policy". Those documents do not exist and are not
  linked. `terms_acceptance.version` is always `'1.0'`, and the app only checks that *some* row
  exists, so changing the terms would never re-prompt anyone.
- **AI cost is unmetered and unbounded.** `ai-proxy` forwards whatever model and `max_tokens` the
  browser sends and records nothing. One school can spend the whole Anthropic budget, and nothing
  says which school did. This is a cost-abuse problem today, before any billing exists.
- **Nothing limits what a school can use.** No seat cap, no trial, no way to suspend an account
  that stops paying. Organizations (Phase 1) are the natural place to hang all of this.
- **Every instructor account is created by one Edge Function** (`manage-instructor`), so seat limits
  can be enforced in exactly one place.
- Colleges will ask for things that do not exist yet: a privacy/security questionnaire, a list of
  subprocessors, a data-processing agreement, and what happens to their data when they leave.

## 2. What "done" means

A college's procurement office can: read the terms and privacy policy at stable public URLs; sign a
contract; receive an invoice; and get an answer to "where is our data, who else touches it, and how
do we get it back". On our side: every school has a plan with limits, usage is measured per school,
a school that stops paying can be paused, and AI spend per school is capped.

## 3. Legal workstream

### 3.1 Documents (drafts in `docs/legal/`, to be lawyer-reviewed)

| Document | Audience | Notes |
|---|---|---|
| Terms of Service / Master Subscription Agreement | The school (signed) | Scope, fees, term and renewal, acceptable use, liability cap, termination, data return. Governing law and entity name are placeholders |
| Privacy Policy | Everyone, public | What personal information we hold (names, emails, availability, resumes), why, retention, rights, contact |
| Data Processing Addendum | The school's privacy office | We act for the school: purposes limited to providing the service, security measures, breach notice, subprocessors, deletion on exit |
| Subprocessor list | Public | Supabase (database/auth), Vercel (hosting), Anthropic (AI), the email provider, Stripe if used. States what each receives and where |
| AI disclosure | Public + in app | Resumes and scheduling data are sent to Anthropic when AI features are used; how to turn it off |
| Security overview | Procurement | Plain answers about encryption, access control, backups, incident response. Basis for a HECVAT-style or privacy-impact-assessment questionnaire |

Higher-ed buyers commonly ask for a **HECVAT** (US) or run a **privacy impact assessment** (public
bodies in Canada). We do not need to file either on day one, but the security overview should be
written so we can answer one quickly and honestly. Anything we cannot truthfully claim (SOC 2,
penetration test, uptime SLA) stays out.

### 3.2 In the product

1. **Public pages** `/legal/terms`, `/legal/privacy`, `/legal/subprocessors` rendered from the
   documents, reachable without logging in, linked from the sign-in page and the terms modal.
2. **Versioned acceptance.** A single `TERMS_VERSION` constant. The app checks for an acceptance row
   *at the current version* and re-prompts when it changes. Existing `'1.0'` acceptances (of the
   placeholder) correctly stop counting, so every current user accepts the real terms once.
3. **Organization-level contract record.** Schools sign the agreement offline. Record the version,
   date and signer name against the organization (admin-visible, vendor-writable).
4. **AI switch per organization.** `ai_enabled` lets a school with a restrictive privacy office turn
   the AI features off entirely; the proxy refuses and the AI menu items hide.
5. **Data exit and deletion.** `scripts/export-org.mjs` (everything for one organization as files)
   and a tested deletion path for an organization and for a single person. Today
   `organization_id` has no cascade, and an org cannot be cleanly removed.

### 3.3 Data residency

Where the Supabase project lives determines where personal information is stored, and some
Canadian public bodies care. Anthropic's API is a separate disclosure regardless (processing
location is the vendor's, not ours). Needs answering now: a Supabase project's region cannot be
changed later, only migrated to a new project.

## 4. Billing workstream

Principle: **build the limits and measurement first, and take money by invoice at first.** Colleges
buy through procurement with purchase orders; a card form helps almost nobody for the first
customers. Stripe subscriptions can come after pricing is real.

### 4.1 Phase 2a: plans, limits, metering (decision-independent, build first)

New table `organization_billing`, one row per organization, **separate from `organizations`** so
ordinary members never see contract or Stripe details; admins read their own row, only the service
role writes.

```
organization_id, plan, subscription_status, trial_ends_at,
max_instructors (null = unlimited), ai_enabled, ai_monthly_token_limit (null = unlimited),
msa_version, msa_signed_at, msa_signed_by,
stripe_customer_id, stripe_subscription_id
```

`subscription_status`: `trial | active | past_due | suspended | canceled`. A trial that has passed
`trial_ends_at` is treated as expired when checked, so no scheduled job is needed.

New table `ai_usage` (organization, user, model, input tokens, output tokens, timestamp), written
only by the proxy, readable by that organization's admins.

Enforcement points:

| Where | Rule |
|---|---|
| `manage-instructor` create | Reject when the organization is suspended/canceled/trial-expired or already at `max_instructors` |
| `ai-proxy` | Reject when AI is off, the organization is not in good standing, or this month's tokens are at the limit. **Allow-list models and cap `max_tokens` server-side** (the browser no longer chooses). Record usage from the response after each call |
| App shell | Banner for trial ending and past-due; a clear "account paused, contact us" screen for suspended/canceled (data stays safe and exportable) |
| Admin "Billing & usage" page | Plan, status, seats used/limit, AI usage this month vs limit, contract version, how to reach us. Read-only |
| Provisioning script | New organizations start on a trial with defaults; a companion script sets plan, limits and status |

Database-level write blocking for suspended organizations (so even a direct API call cannot write)
is possible with a restrictive policy, but a mistake locks a paying customer out, so it is a
deliberate later step, not part of 2a.

### 4.2 Phase 2b: Stripe (after the questions below)

- A Stripe customer per organization; invoices (net terms, PO number on the invoice) rather than
  card-on-file at first.
- A `stripe-webhook` Edge Function that verifies Stripe's signature and maps
  `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted` onto
  `organization_billing`. Unit-tested with signed fixture events; real behaviour verified in Stripe's
  test mode before any live key exists.
- Stripe's customer portal link for invoices and payment details.
- The service-side Stripe secret lives only in Edge Function secrets, like the Anthropic key.

### 4.3 Tax and money (needs an accountant, not code)

Whether and when to register for GST/HST (and provincial taxes) depends on revenue and where
customers are; Stripe Tax can calculate once registered. Pricing unit (per instructor, per
department, flat tier) is a business decision; the limits above are generic, so none of 2a depends on it.

## 5. Order of work

1. **2a-i Metering and cost safety**: `ai_usage`, allow-listed models, token cap, in `ai-proxy`.
   Worth doing first because it closes a live cost-abuse gap.
2. **2a-ii Entitlements**: `organization_billing`, seat limit in `manage-instructor`, status
   handling, app banners/paused screen, Billing & usage page, provisioning defaults.
3. **Legal in product**: versioned acceptance, public legal pages, AI switch, link from sign-in.
4. **Legal documents**: drafts in `docs/legal/` with placeholders clearly marked.
5. **Data exit and deletion**: export script, organization/person deletion, tested.
6. **2b Stripe**: after pricing, entity and account exist.

Everything in 2a and the in-product legal work is verified the same way as Phase 1: SQL behaviour in
the in-process Postgres suite, pure logic with unit tests, Edge Functions reviewed by reading and
exercised for real only on a staging project.

## 6. Questions that change the plan

1. **Billing method for the first customers**: invoice by hand / Stripe invoices (recommended), card
   subscriptions through Stripe, or both?
2. **Do you have an incorporated business to contract and invoice from?** The agreements, the
   invoices, the Stripe account and the tax registration all hang on the legal entity.
3. **Where is your Supabase project hosted** (Canada, US, other, not sure)?
4. **Which schools are you selling to first** (BC / other Canadian provinces / US / mixed)? This
   decides which privacy regimes the documents lead with (e.g. FERPA is US; Canadian public
   colleges are governed by provincial law).

## 7. Risks

- **Legal drafts read as authoritative but are not.** Mitigation: every draft carries a banner and
  placeholders; the plan treats lawyer review as a gate before first signature.
- **Metering from the response can under-count** if a call fails after consuming tokens, and two
  simultaneous calls can both pass the limit check. For a monthly cap this is acceptable noise, not
  a security boundary; the hard stop on model and `max_tokens` is the real cost control.
- **Locking out a paying customer** by a status bug. Hence: app-level gating first, export always
  available, and no database-level write block yet.
- **Re-prompting everyone** when terms change is intended, but must never block a user from signing
  out or exporting.
