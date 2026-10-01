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
Run every file in `migrations/` against your Supabase project's SQL editor, in order
(`001_...` through `007_...`). Migration `006_row_level_security.sql` is the big one — it enables
Row-Level Security on every table, so run it before relying on role-based access working correctly.

### 4. Deploy the Edge Functions
```bash
npx supabase functions deploy ai-proxy --no-verify-jwt
npx supabase functions deploy manage-instructor --no-verify-jwt
npx supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key
```
`ai-proxy` forwards requests to Claude using this secret; the browser bundle never sees it.
`manage-instructor` only needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` — Supabase injects these into every Edge Function automatically, so
no extra `secrets set` is needed for it.

### 5. Run it
```bash
npm run dev
```

## Testing

```bash
npm test        # run once
npm run test:watch   # watch mode
```

## Other scripts

```bash
npm run build     # type-check + production build
npm run lint      # eslint
npm run preview   # preview the production build locally
```
