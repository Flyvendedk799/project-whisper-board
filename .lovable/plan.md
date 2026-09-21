# ClientDesk — Client Portal & Ticket Platform

A two-sided platform: an **admin workspace** for you to run every client engagement, and a **client portal** where clients track their project, file tickets, give feedback, and pay invoices. Notion-style design — light, calm, generous spacing, friendly typography (Instrument Serif headings + Inter body).

---

## Phase 1 — Foundation (auth, roles, projects, design system)

**Auth (all 3 access methods)**

- Email + password (default)
- Magic link (one-click, for non-technical clients)
- Email invite link (you create the client, they set a password)
- Google sign-in for you

**Roles** (separate `user_roles` table — never on profiles):

- `admin` (you)
- `client` (project stakeholders)
- `client_admin` (lead contact who can invite teammates)

**Routes**

- `/login`, `/signup`, `/invite/:token`, `/reset-password`
- `/_authenticated/_admin/*` — your workspace
- `/_authenticated/portal/*` — client portal
- Root redirects based on role

**Projects** (the core unit everything attaches to)

- Title, client company, status (`discovery → proposal → in_progress → review → done → archived`), start/end, budget, hourly rate, project lead
- Many-to-many client members

**Design system** (Notion-style, defined in `src/styles.css`)

- Light cream background, ink black text, soft warm accent
- Instrument Serif for display, Inter for body
- Generous whitespace, subtle borders, rounded-md corners, no heavy shadows

---

## Phase 2 — Tickets, threads, attachments, screen recording

**Ticket types**: bug, feature request, question, feedback, change request
**Fields**: title, description (rich text), type, priority (low/med/high/urgent), status (`open → triaged → in_progress → in_review → done → wont_fix`), assignee, project, reporter, due date, estimate, ETA shown to client

**Reporting that's actually easy**

- Drag-drop screenshots & files
- **In-browser screen recording** via `getDisplayMedia()` → uploads to Storage
- Paste images directly from clipboard
- Browser/OS auto-captured for bug context
- Mobile-friendly: take photo + describe

**Conversation thread per ticket**

- Comments with rich text + attachments
- Internal notes (admin-only, hidden from client)
- @mentions, status change events inline
- Realtime updates via Supabase realtime

**Kanban + list views** for admin; simple status-grouped list for clients.

---

## Phase 3 — Meetings, progress, updates, notifications

**Meetings**

- Schedule with client (date, attendees, agenda)
- Post-meeting notes area (rich text)
- Decisions / action items list — each can be **converted to a ticket** with one click
- Optional Google Calendar connector for two-way sync

**Project progress**

- Milestones with % complete & due dates
- Auto-rolled up project progress bar
- Visible timeline on the client portal homepage

**Updates feed** (per project)

- You post status updates ("Shipped login flow, deploying tomorrow")
- Auto-generated events: ticket opened/closed, milestone hit, payment received
- Clients see a clean activity stream

**Notifications**

- In-app bell with unread count
- Email digest (Resend) — instant for @mentions, daily digest for everything else
- Per-user preferences

---

## Phase 4 — Payments, invoicing, AI

**Payments (Stripe — seamless built-in)**

- Quotes you send to clients (line items, total, accept/decline)
- Milestone-based invoices auto-issued when milestone marked complete
- Subscription option for retainers (monthly maintenance)
- Client portal "Billing" tab: invoices, payment history, download PDF
- Stripe handles tax (you'll pick the tax option during enable)

**AI features (Lovable AI Gateway, default `google/gemini-3-flash-preview`)**

1. **Summarize tickets/threads** — "TL;DR" button on long threads + auto-summary on tickets >10 comments
2. **Meeting notes → tickets** — paste transcript or notes, AI extracts action items as draft tickets you confirm
3. **Auto-triage + screenshot analysis** — when ticket created, AI suggests type, priority, area, and describes what's in attached screenshots/recordings (with likely cause for bugs)
4. **Draft replies** — "Suggest reply" button on client messages, drafted using project context + past tickets

All AI runs in `createServerFn` handlers, never client-direct.

---

## Technical section

**Stack**: TanStack Start (existing) · Lovable Cloud (Supabase) · Lovable AI Gateway · Stripe seamless payments · Resend (Lovable Email) · Tailwind + shadcn

**Data model (high-level)**

```
profiles, user_roles, organizations (clients)
projects, project_members
tickets, ticket_comments, ticket_attachments, ticket_events
milestones, meetings, meeting_action_items
updates (project activity feed)
quotes, quote_line_items, invoices, payments, subscriptions
notifications, notification_preferences
ai_summaries (cached per ticket/thread)
```

**Security**

- RLS on every table; `has_role()` security-definer function for admin checks
- Clients can only see projects they're members of
- Internal notes filtered server-side, never sent to client bundle
- All mutations through `createServerFn` with Zod validation
- Storage buckets: `attachments` (private, signed URLs), `recordings` (private)

**Key technical patterns**

- Auth-protected serverFns via `requireSupabaseAuth` middleware
- `_authenticated/_admin` and `_authenticated/portal` layout routes for role gating
- Realtime channels per-project for live ticket updates
- Stripe webhooks at `/api/public/webhooks/stripe` with signature verification
- Screen recording uses MediaRecorder API → chunked upload to Storage

**Things requiring user setup** (I'll prompt at the right phase)

- Phase 4: enable Lovable Cloud → enable Stripe payments → choose tax option
- Optional: Google Calendar connector for meeting sync
- Custom domain for Resend (or use default)

---

## Build sequence summary

| Phase | What you can do at the end                                               |
| ----- | ------------------------------------------------------------------------ |
| 1     | Sign in, invite a client, create a project                               |
| 2     | Client files a bug with a screen recording, you triage it on a kanban    |
| 3     | Schedule a meeting, post notes, convert to tickets, client sees progress |
| 4     | Send a quote, get paid, AI summarizes a noisy ticket thread              |

Each phase is independently shippable — you can start using it with real clients after Phase 2.
