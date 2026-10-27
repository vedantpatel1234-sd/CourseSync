# Security overview

This is a plain description of how CourseSync protects information, written so a college's IT or privacy team can see what is in place and what is not. **[Last reviewed: DATE]**

## What is in place

**Separation between organizations.** Every record belongs to one organization, and the database itself refuses to show or change another organization's records. This is enforced inside the database (row-level security), not just in the application, and is covered by automated tests that act as users from two different organizations and try every kind of read and write.

**Role-based access.** Administrators, coordinators and instructors each see and change only what their role allows. Coordinators are read-only. Instructors can see only their own assignments, availability and preferences. These rules are also enforced in the database.

**Accounts and passwords.** New instructors are invited by email and choose their own password; administrators never see or set it. Passwords are handled by our authentication provider and stored only in hashed form. Password reset is by emailed link.

**Sessions.** Users are signed out automatically after five minutes of inactivity, with a warning before it happens.

**Encryption.** Traffic between your browser and CourseSync uses HTTPS. Stored data is encrypted at rest by our database provider **[VERIFY]**.

**Activity records.** Administrator actions (creating, changing and deleting records, imports, AI-assisted changes) are recorded with who and when, and are visible to the organization's administrators.

**Error monitoring.** When the app hits an error, a short report (what failed, which page, which software version) is stored in our own database so we can fix it. Email addresses and token-like text are removed first, no record contents are sent, reports are deleted after about 30 days **[VERIFY: the purge is run regularly]**, and they are not shared with any outside service.

**AI safeguards.** The AI provider's access key is held on the server, never in your browser. Each organization has a monthly AI allowance, the server controls which model is used, and AI features can be switched off for an organization. Changes proposed by the scheduling assistant take effect only after an administrator confirms them.

**Limits on our own access.** Account creation and deletion run in server functions that check the caller's role and organization, and cannot be used to act on another organization.

**Return and deletion of data.** A complete export of an organization's data is produced on request, and deleting an organization removes all of its records and sign-in accounts in a single all-or-nothing database operation. By default, deletion is refused unless an up-to-date export exists. Both are covered by automated tests.

**Data location.** The primary database is hosted in Canada **[VERIFY]**. See [Subprocessors](/legal/subprocessors) for other providers and where they operate.

**Backups and recovery.** **[VERIFY and state: backup frequency and retention on the current Supabase plan, whether point-in-time recovery is enabled, and that a restore has been tested.]**

## What is not available yet

We would rather you hear this from us than find it in a questionnaire.

| Capability | Status |
|---|---|
| Multi-factor authentication | Not yet available |
| Single sign-on (SAML / OIDC) | Not yet available |
| Independent security certification (for example SOC 2) | None held by CourseSync. Some of our providers hold their own; see Subprocessors |
| Third-party penetration test | Not yet performed |
| Published uptime commitment | None unless stated in your order form |
| Formal incident-response plan | **[Describe, or state "being formalized"]** |

## Reporting a problem

If you think you have found a vulnerability or a security incident, email [SECURITY CONTACT EMAIL]. We will acknowledge within **[2 business days]**. Please do not test against other customers' data.

## Questionnaires and privacy impact assessments

We are glad to answer a security questionnaire (such as HECVAT) or provide the information a privacy impact assessment needs. Contact [SECURITY CONTACT EMAIL].
