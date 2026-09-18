# SHARED\_SPEC.md

**Project:** Agency Portal (working product name — original identity, not affiliated with any existing vendor)
**Document:** Master Shared Architecture & Integration Specification (Step 0)
**Status:** AUTHORITATIVE — single source of truth for Developer A and Developer B
**Version:** 1.0.0

> This document is produced by Account 1 / Lead Architect. Developer A (Core Platform) and
> Developer B (Productivity Modules) implement from this document only. Neither developer may
> invent alternative table names, column names, role names, event names, DOM IDs, function names,
> storage buckets, module names, or configuration formats. Where this document makes a decision,
> that decision is final. Where a detail is genuinely unspecified, the implementing developer
> chooses the **simplest secure option that does not alter any contract listed in the final
> ****`LOCKED CONTRACT`** **section**.

---

## 1. Executive Summary

Agency Portal is a static-hosted, framework-free web application backed entirely by Supabase. It
gives a service agency one workspace in which to run client work: a nested folder tree that acts as
the project structure, per-folder client sharing, threaded-lite conversations with internal notes,
Kanban boards, documents, files, and invoices with a Stripe payment path.

There are two front doors onto the same database:

| Experience Entry page Audience  |                    |                                   |
| ------------------------------- | ------------------ | --------------------------------- |
| Internal Team Portal            | `index.html`       | agency `owner` and `team` members |
| Client Portal                   | `client-view.html` | agency `client` members           |

Architectural commitments:

1. **Security lives in PostgreSQL.** Row Level Security is the only authorization authority. The browser is treated as hostile. Hiding a DOM node is a UX convenience and is never a control.
2. **One Supabase client, one auth state, one workspace state.** `js/supabaseClient.js` is the only module in the entire codebase permitted to call `createClient()`.
3. **The folder is the unit of sharing.** Access is granted to a *client company* on a folder and is inherited by that folder's descendants. Every other resource inherits folder access and then applies one additional boolean, `client_visible`.
4. **Core owns the shell; modules mount into it.** Developer B never edits the shell, the state, the event bus, the folder tree, or auth. Developer B implements four modules that satisfy one lifecycle interface and consume one event contract.
5. **No secrets in the browser.** Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` ship to the client. Stripe secret keys, webhook secrets, and the Supabase service-role key exist only inside Supabase Edge Functions.

The merge test for this project: Developer A's ZIP and Developer B's ZIP are unzipped into the same
directory, overwriting nothing, and the application works. That is only possible if both halves obey
the `LOCKED CONTRACT` at the end of this document.

---

## 2. Product Scope

### 2.1 Core workflow (P0)

An agency owner signs up, verifies email, completes a profile, and creates an agency workspace. The
workspace has a nested folder tree — folders are projects, sub-projects, retainers, phases, whatever
the agency wants. Inside any folder the team gets five modules: **Conversation**, **Board**,
**Docs**, **Files**, **Invoices**.

The owner adds client companies, invites client contacts by email, and shares specific folders with
specific clients. A client logging into `client-view.html` sees only shared folders and, inside
them, only resources explicitly marked client-visible. Internal notes, internal tasks, internal
docs, and internal files remain invisible at the database level.

### 2.2 In scope for V1

Agencies, memberships, profiles, invitations, client companies, nested folders with color and
ordering, folder permissions with descendant inheritance, conversations, messages with one-level
replies and internal notes, realtime messaging, agency branding (name, logo, primary color), Kanban
boards with columns and tasks, task comments, lightweight rich-text docs, file upload/download via
Supabase Storage, invoices with line items and totals computed in the database, a Stripe Checkout
integration through an Edge Function, and workspace search.

### 2.3 Explicitly out of scope for V1

Email reply synchronisation, recurring invoices, external cloud-storage connectors, time tracking,
proposals/quotes, custom domains, Gantt/timeline views, notification digests, multi-currency
conversion, SSO/SAML, and any admin role between `owner` and `team`.

### 2.4 Originality constraint

The product category and information architecture are informed by publicly documented agency
client-portal workflows (folders → conversations → boards → docs → files → invoices). No source
code, CSS, JavaScript, markup, imagery, copy, logo, trademark, or visual identity may be copied from
any existing product. All branding, component styling, iconography, and interface copy in this
project must be written fresh.

---

## 3. Architecture

### 3.1 Runtime

```text
Browser (static host: GitHub Pages / Netlify / Vercel / Cloudflare Pages)
  ├─ login.html         → auth, invitation acceptance, password reset, onboarding
  ├─ index.html         → internal team portal shell
  └─ client-view.html   → client portal shell
        │
        │  ES modules, no bundler, no framework
        │  one @supabase/supabase-js client from esm.sh (pinned version)
        ▼
Supabase
  ├─ Auth            email + password, email verification, password recovery
  ├─ PostgreSQL      all business data, RLS on every user-facing table
  ├─ Realtime        postgres_changes on messages, tasks, board_columns
  ├─ Storage         project-files (private), agency-branding (public), avatars (public)
  └─ Edge Functions  create-checkout-session, stripe-webhook   ← only place secrets exist

```

### 3.2 Dependency policy

Exactly one third-party runtime dependency is permitted, loaded from a pinned CDN URL:

```js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

```

That import appears in **`js/supabaseClient.js`** **and nowhere else**. Any additional library requires
a change to this specification. Notably: no rich-text editor library (Docs uses
`contenteditable` + `document.execCommand` fallbacks and a hand-written sanitizer), no drag-and-drop
library (Boards uses the native HTML5 drag events), no date library, no CSS framework.

### 3.3 Layering

```text
config.js            environment values
supabaseClient.js    the single client
core/state.js        the single mutable app state + subscribe()
core/events.js       typed dispatch/listen helpers over document CustomEvents
core/utils.js        escapeHtml, sanitizeHtml, formatDate, formatBytes, formatMoney, slugify…
core/permissions.js  pure client-side predicates for UX only (never security)
core/ui.js           toast, modal, confirm, loading/empty/error renderers
core/realtime.js     subscription registry (subscribe once, always clean up)
core/appCore.js      the public integration surface → AppCore + window.AppCore
core/moduleRegistry.js  module name → lazy import; mount/unmount orchestration
auth/*, workspace/*, conversations/*   Developer A feature code
modules/*            Developer B feature code (plus conversation.js, owned by A)

```

Direction of dependency is strictly downward. `core/*` never imports from `workspace/*`,
`auth/*`, or `modules/*`. Developer B's modules import from `core/*` and `supabaseClient.js` only.

---

## 4. Roles & Permissions

### 4.1 Role enum

Exactly three role strings exist in the system. They are stored in `agency_members.role` and
validated by a PostgreSQL `CHECK` constraint. No other role string may appear anywhere in SQL,
JavaScript, or CSS selectors.

```text
owner    team    client

```

The term **staff** is used throughout this document to mean "`owner` OR `team`". `staff` is *not* a
stored role value; it is a helper-function concept (`public.is_agency_staff`).

### 4.2 Capability matrix

| Capability owner team client                   |                |   |                                                        |
| ---------------------------------------------- | -------------- | - | ------------------------------------------------------ |
| Update agency name / slug                      | ✅              | ❌ | ❌                                                      |
| Update branding (logo, primary color)          | ✅              | ❌ | ❌                                                      |
| Invite / remove team members                   | ✅              | ❌ | ❌                                                      |
| Change a member's role                         | ✅              | ❌ | ❌                                                      |
| Create / edit / archive client companies       | ✅              | ✅ | ❌                                                      |
| Invite client contacts                         | ✅              | ✅ | ❌                                                      |
| Create / rename / move / archive folders       | ✅              | ✅ | ❌                                                      |
| Grant or revoke folder permissions             | ✅              | ✅ | ❌                                                      |
| Read all folders in the agency                 | ✅              | ✅ | ❌ (shared only)                                        |
| Create conversations                           | ✅              | ✅ | ❌                                                      |
| Post messages                                  | ✅              | ✅ | ✅ (client-visible conversations only)                  |
| Post internal notes (`client_visible = false`) | ✅              | ✅ | ❌                                                      |
| Read internal notes                            | ✅              | ✅ | ❌                                                      |
| Create / edit boards, columns, tasks           | ✅              | ✅ | ❌                                                      |
| Read tasks                                     | ✅              | ✅ | ✅ (client-visible in shared folder)                    |
| Be assigned a task                             | ✅              | ✅ | ✅                                                      |
| Move a client-visible task between columns     | ✅              | ✅ | ❌ (V1)                                                 |
| Comment on a task                              | ✅              | ✅ | ✅ (client-visible tasks, client-visible comments only) |
| Create / edit docs                             | ✅              | ✅ | ❌                                                      |
| Read docs                                      | ✅              | ✅ | ✅ (client-visible in shared folder)                    |
| Upload files                                   | ✅              | ✅ | ✅ (folder permission with `can_upload`)                |
| Delete files                                   | ✅              | ✅ | ✅ (own uploads only)                                   |
| Create / send invoices                         | ✅              | ✅ | ❌                                                      |
| Delete an invoice                              | ✅ (draft only) | ❌ | ❌                                                      |
| View invoices                                  | ✅              | ✅ | ✅ (own, non-draft)                                     |
| Pay an invoice                                 | ❌              | ❌ | ✅                                                      |
| Search the workspace                           | ✅              | ✅ | ✅ (RLS-scoped)                                         |
| See the member list                            | ✅              | ✅ | ❌                                                      |
| See other client companies                     | ✅              | ✅ | ❌                                                      |

### 4.3 The client anchoring rule

A `client` member row **must** carry a `client_id` pointing at a `clients` row (the client company).
A `staff` member row **must** carry `client_id = NULL`. This is enforced by a `CHECK` constraint:

```sql
CHECK (
  (role = 'client' AND client_id IS NOT NULL) OR
  (role IN ('owner','team') AND client_id IS NULL)
)

```

Consequence: every client user resolves deterministically to exactly one client company per agency,
and `folder_permissions` can be granted to a *company* rather than to individual people. When a
second contact at the same company is invited, they inherit the company's access automatically.

### 4.4 Last-owner protection

An agency must always retain at least one `owner`. A `BEFORE UPDATE OR DELETE` trigger on
`agency_members` raises an exception if the operation would remove the final owner.

---

## 5. Database ER Model

```text
auth.users ──1:1── profiles
                      │
                      │ profile_id
                      ▼
agencies ──1:N── agency_members ──N:1── clients        (client_id, only for role='client')
   │                                        │
   │                                        │
   ├──1:N── invitations ────────────────────┘ (optional client_id for client invitations)
   │
   ├──1:N── folders ──self-referencing parent_id (unbounded depth)
   │            │
   │            ├──1:N── folder_permissions ──N:1── clients
   │            │
   │            ├──1:N── conversations ──1:N── messages ──self-ref reply_to_message_id
   │            │
   │            ├──1:N── boards ──1:N── board_columns ──1:N── tasks ──1:N── task_comments
   │            │
   │            ├──1:N── docs
   │            │
   │            ├──1:N── files            (binary lives in Storage bucket project-files)
   │            │
   │            └──1:N── invoices ──1:N── invoice_line_items
   │                         └──1:N── payments
   │
   └──1:N── activity_logs

```

Cardinality notes:

- `profiles.id` **is** `auth.users.id` (shared PK, not a surrogate).
- A profile may hold memberships in several agencies. Multi-agency is supported by the schema from day one; the UI ships an agency switcher only when `agency_members` returns more than one row.
- `folders.parent_id IS NULL` marks a root folder.
- `tasks` carries `board_id`, `column_id`, **and** the denormalized `folder_id` + `agency_id` so that RLS and search never need a three-table join.
- Every content table carries `agency_id` for the same reason. `agency_id` is set by the client but validated by RLS `WITH CHECK` against the parent row.

---

## 6. Full SQL Schema

Everything in sections 6, 7, 8 and 9 forms the single file
`supabase/migrations/0001_shared_schema.sql`, executed **in the order presented below**:

```text
6.0 extensions
6.1 – 6.19 tables + indexes
7.1 updated_at function + triggers
7.2 security helper functions
7.3 business triggers (owner bootstrap, invoice totals, folder cycle guard, last-owner guard)
7.4 RPC functions (accept_invitation, search_workspace, folder_breadcrumb)
8.x RLS enable + policies
9.x storage buckets + storage policies

```

Conventions used everywhere:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` maintained by trigger
- `snake_case` for every identifier
- soft delete = `archived_at timestamptz` (NULL means live)
- ordering = `position integer NOT NULL DEFAULT 0`
- client visibility = `client_visible boolean NOT NULL DEFAULT false` (exception: `messages` defaults to `true` — see 6.10)

### 6.0 Extensions

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- ILIKE / similarity indexes for search

```

### 6.1 `profiles`

**Purpose:** application-level identity mirroring `auth.users`. Stores display data that other
members are allowed to see. Never duplicates credentials, email confirmation state, or tokens.

**Ownership model:** a row is owned by the user whose `id` it carries. Created automatically by
trigger when an `auth.users` row is inserted.

**Client visibility:** a client may read profiles of staff in their agency and of contacts at their
own client company. Never other clients.

```sql
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));

```

### 6.2 `agencies`

**Purpose:** the workspace / tenant. Holds branding.

**Delete behavior:** hard delete by the owner cascades to every child table. The UI does not expose
agency deletion in V1.

```sql
create table public.agencies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(trim(name)) between 1 and 120),
  slug            text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  logo_url        text,
  primary_color   text not null default '#3F5BF6'
                    check (primary_color ~* '^#[0-9a-f]{6}$'),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index agencies_created_by_idx on public.agencies (created_by);

```

### 6.3 `clients`

**Purpose:** a client *company*. The unit that folder permissions are granted to.

**Delete behavior:** soft delete via `archived_at`. Archiving a client immediately removes portal
access because `is_agency_client()` requires a live client row.

```sql
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 120),
  contact_email text,
  notes         text,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index clients_agency_idx on public.clients (agency_id) where archived_at is null;
create unique index clients_agency_name_uidx
  on public.clients (agency_id, lower(name)) where archived_at is null;

```

### 6.4 `agency_members`

**Purpose:** the authorization spine. One row = one person's role inside one agency.

**Ownership model:** inserted only by an agency owner, or by the `SECURITY DEFINER` RPC
`public.accept_invitation()`. Users can never insert their own membership directly.

```sql
create table public.agency_members (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null check (role in ('owner','team','client')),
  client_id    uuid references public.clients(id) on delete cascade,
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agency_members_unique unique (agency_id, profile_id),
  constraint agency_members_client_anchor check (
    (role = 'client'  and client_id is not null) or
    (role in ('owner','team') and client_id is null)
  )
);

create index agency_members_profile_idx on public.agency_members (profile_id);
create index agency_members_agency_role_idx on public.agency_members (agency_id, role);
create index agency_members_client_idx on public.agency_members (client_id);

```

### 6.5 `invitations`

**Purpose:** pending access grants for both team members and client contacts.

**Security:** `token` is a random uuid, unguessable and single-use. `intended_role` is written by an
authorized inviter under RLS; the acceptance RPC copies it verbatim, so a user can never elevate
themselves by editing a request body.

```sql
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  email         text not null check (position('@' in email) > 1),
  intended_role text not null check (intended_role in ('owner','team','client')),
  client_id     uuid references public.clients(id) on delete cascade,
  invited_by    uuid not null references public.profiles(id) on delete cascade,
  token         uuid not null unique default gen_random_uuid(),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','revoked','expired')),
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint invitations_client_anchor check (
    (intended_role = 'client'  and client_id is not null) or
    (intended_role in ('owner','team') and client_id is null)
  )
);

create unique index invitations_pending_uidx
  on public.invitations (agency_id, lower(email)) where status = 'pending';
create index invitations_agency_idx on public.invitations (agency_id, status);
create index invitations_token_idx on public.invitations (token);

```

### 6.6 `folders`

**Purpose:** the project tree. Unbounded practical nesting depth.

**Delete behavior:** soft delete (`archived_at`). Archiving a folder hides it and, through
`can_access_folder`, hides every descendant from clients. Staff may view an archive filter. Hard
delete exists only as `ON DELETE CASCADE` if an agency is deleted.

```sql
create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  parent_id   uuid references public.folders(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 120),
  color       text not null default '#8A90A6' check (color ~* '^#[0-9a-f]{6}$'),
  position    integer not null default 0,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index folders_agency_parent_idx on public.folders (agency_id, parent_id, position);
create index folders_parent_idx on public.folders (parent_id);
create index folders_name_trgm_idx on public.folders using gin (name gin_trgm_ops);

```

### 6.7 `folder_permissions`

**Purpose:** grants a client company access to a folder and, by inheritance, its descendants.

**Inheritance rule (V1, final):** a grant on folder *F* grants read access to *F* and to every
descendant of *F*. There are no deny rows and no override precedence. Revoking means deleting the
row.

```sql
create table public.folder_permissions (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  folder_id   uuid not null references public.folders(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  can_upload  boolean not null default true,
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint folder_permissions_unique unique (folder_id, client_id)
);

create index folder_permissions_client_idx on public.folder_permissions (client_id);
create index folder_permissions_agency_idx on public.folder_permissions (agency_id);

```

### 6.8 `conversations`

**Purpose:** a message thread anchored to a folder.

**Client visibility:** readable by a client when the folder is accessible **AND**
`client_visible = true` **AND** `archived_at IS NULL`.

```sql
create table public.conversations (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 160),
  client_visible boolean not null default false,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  last_message_at timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index conversations_folder_idx
  on public.conversations (folder_id, last_message_at desc nulls last);
create index conversations_agency_idx on public.conversations (agency_id);

```

### 6.9 `messages`

**Purpose:** one post in a conversation. One-level replies only.

**Threading decision (final):** `reply_to_message_id` referencing a message in the same
conversation. A reply to a reply stores the *root* message id — the UI never renders a third level.

**`client_visible`** **on messages defaults to** **`true`**, because a message inside a client-visible
conversation is normally meant for the client. Setting it to `false` makes the message an
**internal note**. This is the same column name and the same semantics as everywhere else in the
schema; only the default differs, and it differs deliberately.

```sql
create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  sender_id           uuid not null references public.profiles(id) on delete restrict,
  body                text not null check (char_length(body) between 1 and 20000),
  client_visible      boolean not null default true,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  edited_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_agency_idx on public.messages (agency_id);
create index messages_body_trgm_idx on public.messages using gin (body gin_trgm_ops);

```

### 6.10 `boards`

**Purpose:** a Kanban board inside a folder. Developer B owns the UI; the schema is fixed here.

```sql
create table public.boards (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 160),
  description    text,
  client_visible boolean not null default false,
  position       integer not null default 0,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index boards_folder_idx on public.boards (folder_id, position);
create index boards_agency_idx on public.boards (agency_id);

```

### 6.11 `board_columns`

**Purpose:** ordered lanes within a board. Columns have no independent visibility — they inherit
the board's.

```sql
create table public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  color      text not null default '#8A90A6' check (color ~* '^#[0-9a-f]{6}$'),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index board_columns_board_idx on public.board_columns (board_id, position);

```

### 6.12 `tasks`

**Purpose:** a card. Carries denormalized `board_id`, `folder_id`, `agency_id` for RLS and search.

```sql
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  board_id       uuid not null references public.boards(id) on delete cascade,
  column_id      uuid not null references public.board_columns(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 200),
  description    text,
  assignee_id    uuid references public.profiles(id) on delete set null,
  due_date       date,
  priority       text not null default 'normal'
                   check (priority in ('low','normal','high','urgent')),
  client_visible boolean not null default false,
  position       integer not null default 0,
  completed_at   timestamptz,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index tasks_column_idx on public.tasks (column_id, position);
create index tasks_board_idx on public.tasks (board_id);
create index tasks_folder_idx on public.tasks (folder_id);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_title_trgm_idx on public.tasks using gin (title gin_trgm_ops);

```

### 6.13 `task_comments`

```sql
create table public.task_comments (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  task_id        uuid not null references public.tasks(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete restrict,
  body           text not null check (char_length(body) between 1 and 10000),
  client_visible boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

```

> `task_comments.client_visible` follows the same rule as `messages`: default `true`, set to `false`
> for an internal comment. A client-authored comment is always `true` (enforced by RLS `WITH CHECK`).

### 6.14 `docs`

**Content format decision (final): sanitized HTML.** `content_html` stores HTML produced by the
editor and sanitized **before insert on the client and again before render**. `content_text` stores
a plain-text projection maintained by the writer, used exclusively for search.

```sql
create table public.docs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  title          text not null check (char_length(trim(title)) between 1 and 200),
  content_html   text not null default '',
  content_text   text not null default '',
  client_visible boolean not null default false,
  created_by     uuid not null references public.profiles(id) on delete restrict,
  last_edited_by uuid references public.profiles(id) on delete set null,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index docs_folder_idx on public.docs (folder_id, updated_at desc);
create index docs_title_trgm_idx on public.docs using gin (title gin_trgm_ops);
create index docs_text_trgm_idx on public.docs using gin (content_text gin_trgm_ops);

```

### 6.15 `files`

**Purpose:** metadata for an object in the `project-files` Storage bucket. Binary data never enters
PostgreSQL. No base64 columns.

```sql
create table public.files (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  folder_id      uuid not null references public.folders(id) on delete cascade,
  uploaded_by    uuid not null references public.profiles(id) on delete restrict,
  bucket_name    text not null default 'project-files'
                   check (bucket_name = 'project-files'),
  storage_path   text not null unique,
  original_name  text not null check (char_length(original_name) between 1 and 255),
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  client_visible boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index files_folder_idx on public.files (folder_id, created_at desc);
create index files_agency_idx on public.files (agency_id);
create index files_name_trgm_idx on public.files using gin (original_name gin_trgm_ops);

```

Max object size is 25 MiB (26 214 400 bytes), enforced in three places: this `CHECK`, the bucket's
`file_size_limit`, and a client-side guard.

### 6.16 `invoices`

**Money rule:** all amounts are stored in **minor currency units as** **`bigint`** (cents). No floats
anywhere. `subtotal_cents`, `tax_cents`, `discount_cents`, `total_cents` are recomputed by a
database trigger from `invoice_line_items`; the frontend never supplies them.

```sql
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  folder_id       uuid references public.folders(id) on delete set null,
  client_id       uuid not null references public.clients(id) on delete restrict,
  invoice_number  text not null,
  status          text not null default 'draft'
                    check (status in ('draft','sent','paid','overdue','void')),
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  issue_date      date not null default current_date,
  due_date        date,
  subtotal_cents  bigint not null default 0 check (subtotal_cents >= 0),
  tax_rate_bp     integer not null default 0 check (tax_rate_bp between 0 and 10000),
  tax_cents       bigint not null default 0 check (tax_cents >= 0),
  discount_cents  bigint not null default 0 check (discount_cents >= 0),
  total_cents     bigint not null default 0 check (total_cents >= 0),
  notes           text,
  sent_at         timestamptz,
  paid_at         timestamptz,
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoices_number_unique unique (agency_id, invoice_number)
);

create index invoices_client_idx on public.invoices (client_id, status);
create index invoices_folder_idx on public.invoices (folder_id);
create index invoices_agency_idx on public.invoices (agency_id, issue_date desc);

```

`tax_rate_bp` is basis points (1500 = 15.00%).

### 6.17 `invoice_line_items`

```sql
create table public.invoice_line_items (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  description      text not null check (char_length(trim(description)) between 1 and 300),
  quantity_milli   bigint not null default 1000 check (quantity_milli > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents     bigint not null default 0 check (amount_cents >= 0),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, position);

```

`quantity_milli` stores quantity × 1000 so that fractional hours (2.5 → 2500) stay exact integers.
`amount_cents` is computed by trigger as `round(quantity_milli * unit_price_cents / 1000.0)`.

### 6.18 `payments`

```sql
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  amount_cents        bigint not null check (amount_cents > 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  provider            text not null default 'stripe' check (provider in ('stripe','manual')),
  provider_session_id text,
  provider_payment_id text,
  status              text not null default 'pending'
                        check (status in ('pending','succeeded','failed','refunded')),
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index payments_provider_payment_uidx
  on public.payments (provider_payment_id) where provider_payment_id is not null;
create index payments_invoice_idx on public.payments (invoice_id);

```

Rows in `payments` are written **only** by the `stripe-webhook` Edge Function using the service-role
key, or manually by an owner. No browser-side INSERT policy exists for `stripe` provider rows.

### 6.19 `activity_logs`

**Purpose:** lightweight, append-only trace of security-relevant and workflow-relevant actions.
Deliberately not a full audit system.

```sql
create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null check (action in (
                'folder.created','folder.archived','folder.shared','folder.unshared',
                'client.created','client.invited','member.invited','member.removed',
                'task.completed','file.uploaded','file.deleted',
                'invoice.sent','invoice.paid','branding.updated'
              )),
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activity_logs_agency_idx on public.activity_logs (agency_id, created_at desc);

```

`activity_logs` has no `updated_at` and no UPDATE/DELETE policy — it is append-only.

---

## 7. SQL Helper Functions & Triggers

### 7.1 The one `updated_at` trigger

There is exactly one implementation. Neither developer writes another.

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','agencies','clients','agency_members','invitations','folders',
    'folder_permissions','conversations','messages','boards','board_columns',
    'tasks','task_comments','docs','files','invoices','invoice_line_items','payments'
  ]
  loop
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

```

### 7.2 Security helper functions

Every helper is `SECURITY DEFINER` with a pinned `search_path`. This is mandatory: RLS policies that
query `agency_members` directly would recurse into `agency_members`' own policies. Routing all such
lookups through definer functions removes the recursion and keeps policy expressions readable.

Each function is `STABLE` (not `VOLATILE`) so PostgreSQL may cache it per statement.

```sql
-- Is the current user any kind of member of this agency?
create or replace function public.is_agency_member(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid()
  );
$$;

-- Is the current user the owner of this agency?
create or replace function public.is_agency_owner(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Is the current user specifically a 'team' member (not owner)?
create or replace function public.is_agency_team(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid() and m.role = 'team'
  );
$$;

-- owner OR team. This is the predicate used by almost every write policy.
create or replace function public.is_agency_staff(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency and m.profile_id = auth.uid()
      and m.role in ('owner','team')
  );
$$;

-- Is the current user a client of this agency whose client company is still live?
create or replace function public.is_agency_client(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.agency_members m
    join public.clients c on c.id = m.client_id
    where m.agency_id = p_agency and m.profile_id = auth.uid()
      and m.role = 'client' and c.archived_at is null
  );
$$;

-- Which client company does the current user belong to in this agency? NULL for staff.
create or replace function public.current_client_id(p_agency uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.client_id
  from public.agency_members m
  join public.clients c on c.id = m.client_id
  where m.agency_id = p_agency and m.profile_id = auth.uid()
    and m.role = 'client' and c.archived_at is null
  limit 1;
$$;

-- May the current user view this profile at all?
create or replace function public.can_view_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_profile = auth.uid()
    or exists (                              -- I am staff somewhere they are a member
      select 1
      from public.agency_members me
      join public.agency_members them on them.agency_id = me.agency_id
      where me.profile_id = auth.uid() and me.role in ('owner','team')
        and them.profile_id = p_profile
    )
    or exists (                              -- I am a client; I may see staff of that agency
      select 1
      from public.agency_members me
      join public.agency_members them on them.agency_id = me.agency_id
      where me.profile_id = auth.uid() and me.role = 'client'
        and them.profile_id = p_profile
        and (them.role in ('owner','team') or them.client_id = me.client_id)
    );
$$;

```

### 7.2.1 `can_access_folder` — the central authorization function

```sql
create or replace function public.can_access_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency   uuid;
  v_archived timestamptz;
  v_client   uuid;
  v_ok       boolean;
begin
  if p_folder is null or auth.uid() is null then
    return false;
  end if;

  select f.agency_id, f.archived_at into v_agency, v_archived
  from public.folders f where f.id = p_folder;

  if v_agency is null then
    return false;                      -- folder does not exist: indistinguishable from denied
  end if;

  if public.is_agency_staff(v_agency) then
    return true;                       -- staff read every folder in their agency, archived included
  end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then
    return false;
  end if;

  if v_archived is not null then
    return false;                      -- clients never see archived folders
  end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p
      join chain c on p.id = c.parent_id
  )
  select exists (
    select 1
    from chain c
    join public.folder_permissions fp on fp.folder_id = c.id
    where fp.client_id = v_client
      and c.archived_at is null
  ) into v_ok;

  return coalesce(v_ok, false);
end;
$$;

```

**Reading this function:** it walks from the requested folder up through its ancestors. If any folder
on that path carries a live `folder_permissions` row for the caller's client company, access is
granted. That is exactly the "sharing a folder shares its descendants" rule, expressed once.

```sql
-- May the current user place new objects in this folder?
create or replace function public.can_upload_to_folder(p_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_client uuid;
  v_ok     boolean;
begin
  select f.agency_id into v_agency from public.folders f
  where f.id = p_folder and f.archived_at is null;
  if v_agency is null then return false; end if;

  if public.is_agency_staff(v_agency) then return true; end if;

  v_client := public.current_client_id(v_agency);
  if v_client is null then return false; end if;

  with recursive chain as (
    select f.id, f.parent_id, f.archived_at
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.archived_at
      from public.folders p join chain c on p.id = c.parent_id
  )
  select exists (
    select 1 from chain c
    join public.folder_permissions fp on fp.folder_id = c.id
    where fp.client_id = v_client and fp.can_upload = true and c.archived_at is null
  ) into v_ok;

  return coalesce(v_ok, false);
end;
$$;

```

### 7.2.2 Derived readability helpers

These exist so that child-table policies never restate parent logic.

```sql
create or replace function public.can_read_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and public.can_access_folder(c.folder_id)
      and (
        public.is_agency_staff(c.agency_id)
        or (c.client_visible = true and c.archived_at is null)
      )
  );
$$;

create or replace function public.can_read_board(p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board
      and public.can_access_folder(b.folder_id)
      and (
        public.is_agency_staff(b.agency_id)
        or (b.client_visible = true and b.archived_at is null)
      )
  );
$$;

create or replace function public.can_read_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and public.can_read_board(t.board_id)
      and (public.is_agency_staff(t.agency_id) or t.client_visible = true)
  );
$$;

create or replace function public.can_read_invoice(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = p_invoice
      and (
        public.is_agency_staff(i.agency_id)
        or (i.client_id = public.current_client_id(i.agency_id) and i.status <> 'draft')
      )
  );
$$;

```

### 7.3 Business triggers

#### 7.3.1 Profile bootstrap on signup

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

```

#### 7.3.2 Owner membership on agency creation

The creator of an agency becomes its owner atomically. This is the only path to `owner` other than
an owner-issued invitation.

```sql
create or replace function public.handle_new_agency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.agency_members (agency_id, profile_id, role, client_id)
  values (new.id, new.created_by, 'owner', null)
  on conflict (agency_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger on_agency_created
  after insert on public.agencies
  for each row execute function public.handle_new_agency();

```

#### 7.3.3 Last-owner protection

```sql
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_count integer;
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;

  if old.role = 'owner' then
    select count(*) into v_owner_count
    from public.agency_members
    where agency_id = old.agency_id and role = 'owner' and id <> old.id;

    if v_owner_count = 0 then
      raise exception 'An agency must keep at least one owner';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_last_owner_trg
  before update or delete on public.agency_members
  for each row execute function public.guard_last_owner();

```

#### 7.3.4 Folder cycle guard

Moving a folder into its own descendant would create an unreachable loop.

```sql
create or replace function public.guard_folder_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'A folder cannot be its own parent';
  end if;

  with recursive chain as (
    select f.id, f.parent_id from public.folders f where f.id = new.parent_id
    union all
    select p.id, p.parent_id from public.folders p join chain c on p.id = c.parent_id
  )
  select exists (select 1 from chain where id = new.id) into v_cycle;

  if v_cycle then
    raise exception 'A folder cannot be moved inside one of its own descendants';
  end if;

  -- parent must live in the same agency
  if not exists (
    select 1 from public.folders f
    where f.id = new.parent_id and f.agency_id = new.agency_id
  ) then
    raise exception 'Parent folder belongs to a different agency';
  end if;

  return new;
end;
$$;

create trigger guard_folder_cycle_trg
  before insert or update of parent_id on public.folders
  for each row execute function public.guard_folder_cycle();

```

#### 7.3.5 Invoice totals — the authoritative arithmetic

The frontend never decides what an invoice is worth.

```sql
create or replace function public.compute_line_item_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.amount_cents = round(new.quantity_milli::numeric * new.unit_price_cents / 1000.0);
  return new;
end;
$$;

create trigger compute_line_item_amount_trg
  before insert or update on public.invoice_line_items
  for each row execute function public.compute_line_item_amount();

create or replace function public.recalculate_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice  uuid := coalesce(new.invoice_id, old.invoice_id);
  v_subtotal bigint;
  v_discount bigint;
  v_rate     integer;
  v_tax      bigint;
begin
  select coalesce(sum(amount_cents), 0) into v_subtotal
  from public.invoice_line_items where invoice_id = v_invoice;

  select discount_cents, tax_rate_bp into v_discount, v_rate
  from public.invoices where id = v_invoice;

  v_discount := least(coalesce(v_discount, 0), v_subtotal);
  v_tax := round((v_subtotal - v_discount)::numeric * coalesce(v_rate, 0) / 10000.0);

  update public.invoices
  set subtotal_cents = v_subtotal,
      tax_cents      = v_tax,
      discount_cents = v_discount,
      total_cents    = v_subtotal - v_discount + v_tax
  where id = v_invoice;

  return null;
end;
$$;

create trigger recalculate_invoice_totals_trg
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.recalculate_invoice_totals();

-- Re-run when the invoice's own rate/discount changes.
create or replace function public.recalculate_invoice_totals_self()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_tax      bigint;
begin
  select coalesce(sum(amount_cents), 0) into v_subtotal
  from public.invoice_line_items where invoice_id = new.id;

  v_discount := least(coalesce(new.discount_cents, 0), v_subtotal);
  v_tax := round((v_subtotal - v_discount)::numeric * coalesce(new.tax_rate_bp, 0) / 10000.0);

  new.subtotal_cents := v_subtotal;
  new.discount_cents := v_discount;
  new.tax_cents      := v_tax;
  new.total_cents    := v_subtotal - v_discount + v_tax;
  return new;
end;
$$;

create trigger recalculate_invoice_totals_self_trg
  before update of tax_rate_bp, discount_cents on public.invoices
  for each row execute function public.recalculate_invoice_totals_self();

```

#### 7.3.6 Invoice number assignment

```sql
create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next integer;
begin
  if new.invoice_number is not null and trim(new.invoice_number) <> '' then
    return new;
  end if;

  select coalesce(max(substring(invoice_number from '\d+$')::integer), 0) + 1
  into v_next
  from public.invoices
  where agency_id = new.agency_id and invoice_number ~ '^INV-\d+$';

  new.invoice_number := 'INV-' || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

create trigger assign_invoice_number_trg
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();

```

#### 7.3.7 Conversation activity stamp

```sql
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return null;
end;
$$;

create trigger touch_conversation_trg
  after insert on public.messages
  for each row execute function public.touch_conversation();

```

### 7.4 RPC functions

#### 7.4.1 `accept_invitation` — the only self-service path to membership

```sql
create or replace function public.accept_invitation(p_token uuid)
returns table (agency_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv        public.invitations%rowtype;
  v_email    text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into inv from public.invitations
  where token = p_token for update;

  if inv.id is null then
    raise exception 'Invitation not found';
  end if;
  if inv.status <> 'pending' then
    raise exception 'Invitation is no longer valid';
  end if;
  if inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(inv.email) <> lower(v_email) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  insert into public.agency_members (agency_id, profile_id, role, client_id, invited_by)
  values (inv.agency_id, auth.uid(), inv.intended_role, inv.client_id, inv.invited_by)
  on conflict (agency_id, profile_id) do nothing;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return query select inv.agency_id, inv.intended_role;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

```

The role written into `agency_members` comes from the invitation row, which only an authorized
inviter could create. A user sending `role=owner` from the browser reaches no code path that reads
it.

#### 7.4.2 `folder_breadcrumb`

```sql
create or replace function public.folder_breadcrumb(p_folder uuid)
returns table (id uuid, name text, color text, depth integer)
language sql
stable
security invoker
as $$
  with recursive chain as (
    select f.id, f.parent_id, f.name, f.color, 0 as depth
      from public.folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.name, p.color, c.depth + 1
      from public.folders p join chain c on p.id = c.parent_id
  )
  select id, name, color, depth from chain order by depth desc;
$$;

```

`SECURITY INVOKER` is deliberate: RLS on `folders` applies, so a client asking for a breadcrumb of an
inaccessible folder receives zero rows rather than folder names.

#### 7.4.3 `search_workspace`

```sql
create or replace function public.search_workspace(p_agency uuid, p_query text)
returns table (
  entity_type text,
  entity_id   uuid,
  folder_id   uuid,
  title       text,
  snippet     text,
  updated_at  timestamptz
)
language sql
stable
security invoker
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  select 'folder', f.id, f.id, f.name, null, f.updated_at
    from public.folders f, q
   where f.agency_id = p_agency and f.archived_at is null and f.name ilike q.pattern
  union all
  select 'task', t.id, t.folder_id, t.title, left(coalesce(t.description,''), 160), t.updated_at
    from public.tasks t, q
   where t.agency_id = p_agency and t.title ilike q.pattern
  union all
  select 'doc', d.id, d.folder_id, d.title, left(d.content_text, 160), d.updated_at
    from public.docs d, q
   where d.agency_id = p_agency and d.archived_at is null
     and (d.title ilike q.pattern or d.content_text ilike q.pattern)
  union all
  select 'conversation', c.id, c.folder_id, c.title, null, c.updated_at
    from public.conversations c, q
   where c.agency_id = p_agency and c.archived_at is null and c.title ilike q.pattern
  union all
  select 'file', fi.id, fi.folder_id, fi.original_name, fi.mime_type, fi.updated_at
    from public.files fi, q
   where fi.agency_id = p_agency and fi.original_name ilike q.pattern
  order by updated_at desc
  limit 60;
$$;

```

`SECURITY INVOKER` again: every underlying table's RLS applies inside the function, so a client's
search can only ever return rows that client could have selected directly. Search leaks nothing.

---

## 8. Full RLS Policies

### 8.1 Enable RLS everywhere

```sql
alter table public.profiles            enable row level security;
alter table public.agencies            enable row level security;
alter table public.clients             enable row level security;
alter table public.agency_members      enable row level security;
alter table public.invitations         enable row level security;
alter table public.folders             enable row level security;
alter table public.folder_permissions  enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.boards              enable row level security;
alter table public.board_columns       enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_comments       enable row level security;
alter table public.docs                enable row level security;
alter table public.files               enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_line_items  enable row level security;
alter table public.payments            enable row level security;
alter table public.activity_logs       enable row level security;

```

Supabase grants `select/insert/update/delete` on `public` tables to `anon` and `authenticated` by
default; with RLS enabled and no permissive policy, the effective result is deny. Every policy below
is written for the `authenticated` role only. **No policy in this project targets** **`anon`****.**

### 8.2 `profiles`

```sql
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_view_profile(id));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

```

No delete policy: profiles die with `auth.users`.

### 8.3 `agencies`

```sql
create policy agencies_select on public.agencies
  for select to authenticated
  using (public.is_agency_member(id));

create policy agencies_insert on public.agencies
  for insert to authenticated
  with check (created_by = auth.uid());

create policy agencies_update_owner on public.agencies
  for update to authenticated
  using (public.is_agency_owner(id))
  with check (public.is_agency_owner(id));

create policy agencies_delete_owner on public.agencies
  for delete to authenticated
  using (public.is_agency_owner(id));

```

Branding (`logo_url`, `primary_color`, `name`) is part of this row, so branding is owner-only by
construction.

### 8.4 `agency_members`

```sql
create policy agency_members_select on public.agency_members
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_agency_staff(agency_id)
    or (public.is_agency_client(agency_id) and client_id = public.current_client_id(agency_id))
  );

create policy agency_members_insert_owner on public.agency_members
  for insert to authenticated
  with check (public.is_agency_owner(agency_id));

create policy agency_members_update_owner on public.agency_members
  for update to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));

create policy agency_members_delete on public.agency_members
  for delete to authenticated
  using (public.is_agency_owner(agency_id) or profile_id = auth.uid());

```

A member may always remove themselves (leave the workspace), subject to the last-owner trigger.

### 8.5 `clients`

```sql
create policy clients_select on public.clients
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or id = public.current_client_id(agency_id)
  );

create policy clients_insert_staff on public.clients
  for insert to authenticated
  with check (public.is_agency_staff(agency_id) and created_by = auth.uid());

create policy clients_update_staff on public.clients
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy clients_delete_owner on public.clients
  for delete to authenticated
  using (public.is_agency_owner(agency_id));

```

A client sees exactly one `clients` row: their own company. Client-to-client discovery is impossible.

### 8.6 `invitations`

```sql
create policy invitations_select_staff on public.invitations
  for select to authenticated
  using (public.is_agency_staff(agency_id));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and (
      -- only owners may invite staff
      (intended_role in ('owner','team') and public.is_agency_owner(agency_id))
      -- owner or team may invite clients, and must anchor to a client of this agency
      or (
        intended_role = 'client'
        and public.is_agency_staff(agency_id)
        and exists (
          select 1 from public.clients c
          where c.id = client_id and c.agency_id = agency_id and c.archived_at is null
        )
      )
    )
  );

create policy invitations_update_staff on public.invitations
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id) and status in ('pending','revoked','expired'));

create policy invitations_delete_owner on public.invitations
  for delete to authenticated
  using (public.is_agency_owner(agency_id));

```

An invitee never reads the `invitations` table. They call `accept_invitation(token)`, which is
`SECURITY DEFINER`. This means a token cannot be brute-forced by listing rows, and error messages
are the only signal — which is why they are deliberately generic.

The `invitations_update_staff` `WITH CHECK` prevents staff from hand-setting `status = 'accepted'`;
only the RPC does that.

### 8.7 `folders`

```sql
create policy folders_select on public.folders
  for select to authenticated
  using (public.can_access_folder(id));

create policy folders_insert_staff on public.folders
  for insert to authenticated
  with check (public.is_agency_staff(agency_id) and created_by = auth.uid());

create policy folders_update_staff on public.folders
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy folders_delete_staff on public.folders
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

```

Clients have no insert/update/delete on folders at all in V1.

### 8.8 `folder_permissions`

```sql
create policy folder_permissions_select on public.folder_permissions
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or client_id = public.current_client_id(agency_id)
  );

create policy folder_permissions_insert_staff on public.folder_permissions
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = agency_id)
  );

create policy folder_permissions_update_staff on public.folder_permissions
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy folder_permissions_delete_staff on public.folder_permissions
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

```

The two `EXISTS` clauses stop a cross-tenant grant: you cannot attach a folder from agency X to a
client of agency Y even if you are staff in both.

### 8.9 `conversations`

```sql
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy conversations_insert_staff on public.conversations
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy conversations_update_staff on public.conversations
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy conversations_delete_staff on public.conversations
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

```

### 8.10 `messages`

```sql
create policy messages_select on public.messages
  for select to authenticated
  using (
    public.can_read_conversation(conversation_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_read_conversation(conversation_id)
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true          -- a client cannot author an internal note
    )
  );

create policy messages_update_sender on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (
    sender_id = auth.uid()
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy messages_delete on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.is_agency_owner(agency_id));

```

**This is the internal-note guarantee.** A client's `SELECT` on `messages` — whether issued through
PostgREST, through an RPC, or delivered by Realtime — passes through `messages_select`, which
requires `client_visible = true` for non-staff. Realtime in Supabase evaluates RLS per subscriber, so
an internal note is never broadcast to a client socket. No `display:none` anywhere in this
architecture is load-bearing.

### 8.11 `boards` and `board_columns`

```sql
create policy boards_select on public.boards
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy boards_insert_staff on public.boards
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy boards_update_staff on public.boards
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy boards_delete_staff on public.boards
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

create policy board_columns_select on public.board_columns
  for select to authenticated
  using (public.can_read_board(board_id));

create policy board_columns_write_staff on public.board_columns
  for all to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (select 1 from public.boards b where b.id = board_id and b.agency_id = agency_id)
  );

```

### 8.12 `tasks`

```sql
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.can_read_board(board_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy tasks_insert_staff on public.tasks
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.boards b
      where b.id = board_id and b.agency_id = agency_id and b.folder_id = folder_id
    )
    and exists (select 1 from public.board_columns c where c.id = column_id and c.board_id = board_id)
  );

create policy tasks_update_staff on public.tasks
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (select 1 from public.board_columns c where c.id = column_id and c.board_id = board_id)
  );

create policy tasks_delete_staff on public.tasks
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

```

Clients read tasks; they do not move, create, or delete them in V1. Client input on a task happens
through `task_comments`.

### 8.13 `task_comments`

```sql
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (
    public.can_read_task(task_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_read_task(task_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_update_author on public.task_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_agency_owner(agency_id));

```

### 8.14 `docs`

```sql
create policy docs_select on public.docs
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (
      public.is_agency_staff(agency_id)
      or (client_visible = true and archived_at is null)
    )
  );

create policy docs_insert_staff on public.docs
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
  );

create policy docs_update_staff on public.docs
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy docs_delete_staff on public.docs
  for delete to authenticated
  using (public.is_agency_staff(agency_id));

```

### 8.15 `files`

```sql
create policy files_select on public.files
  for select to authenticated
  using (
    public.can_access_folder(folder_id)
    and (public.is_agency_staff(agency_id) or client_visible = true)
  );

create policy files_insert on public.files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.can_upload_to_folder(folder_id)
    and exists (select 1 from public.folders f where f.id = folder_id and f.agency_id = agency_id)
    and (
      public.is_agency_staff(agency_id)
      or client_visible = true          -- client uploads are visible to the client who made them
    )
  );

create policy files_update_staff on public.files
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy files_delete on public.files
  for delete to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (uploaded_by = auth.uid() and public.can_upload_to_folder(folder_id))
  );

```

A client may delete a file they uploaded themselves and nothing else.

### 8.16 `invoices`, `invoice_line_items`, `payments`

```sql
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.is_agency_staff(agency_id)
    or (client_id = public.current_client_id(agency_id) and status <> 'draft')
  );

create policy invoices_insert_staff on public.invoices
  for insert to authenticated
  with check (
    public.is_agency_staff(agency_id)
    and created_by = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = agency_id)
  );

create policy invoices_update_staff on public.invoices
  for update to authenticated
  using (public.is_agency_staff(agency_id))
  with check (public.is_agency_staff(agency_id));

create policy invoices_delete_owner_draft on public.invoices
  for delete to authenticated
  using (public.is_agency_owner(agency_id) and status = 'draft');

create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using (public.can_read_invoice(invoice_id));

create policy invoice_line_items_write_staff on public.invoice_line_items
  for all to authenticated
  using (public.is_agency_staff(agency_id))
  with check (
    public.is_agency_staff(agency_id)
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.agency_id = agency_id and i.status = 'draft'
    )
  );

create policy payments_select on public.payments
  for select to authenticated
  using (public.can_read_invoice(invoice_id));

create policy payments_insert_owner_manual on public.payments
  for insert to authenticated
  with check (public.is_agency_owner(agency_id) and provider = 'manual');

```

Line items are editable only while the invoice is `draft`, which means a sent invoice's total cannot
move underneath a client. `payments` rows for Stripe are written exclusively by the webhook Edge
Function using the service-role key, which bypasses RLS by design; the browser has no path to
create, update, or delete them.

### 8.17 `activity_logs`

```sql
create policy activity_logs_select_staff on public.activity_logs
  for select to authenticated
  using (public.is_agency_staff(agency_id));

create policy activity_logs_insert_member on public.activity_logs
  for insert to authenticated
  with check (public.is_agency_member(agency_id) and actor_id = auth.uid());

```

No update, no delete: append-only.

### 8.18 Realtime publication

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.board_columns;
alter publication supabase_realtime add table public.conversations;

```

Supabase evaluates RLS for Realtime subscribers, so adding a table to the publication does not widen
access. No other table is published in V1.

### 8.19 Negative-security test matrix

These must all be verified before either ZIP is considered done.

| # Attack Expected outcome  |                                                                             |                                                |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| N1                         | Client A selects `folders` by Client B's folder UUID                        | 0 rows (`can_access_folder` false)             |
| N2                         | Client A selects a folder shared only with Client B's *parent*              | 0 rows                                         |
| N3                         | Client A reads `messages` where `client_visible = false`                    | 0 rows, and no Realtime event delivered        |
| N4                         | Client A opens a Realtime channel on Client B's conversation                | channel joins, but zero payloads arrive        |
| N5                         | Client A inserts a message with `client_visible = false`                    | `WITH CHECK` violation                         |
| N6                         | Any user inserts into `agency_members` with `role = 'owner'`                | policy violation (only owners may insert)      |
| N7                         | Team member updates `agency_members.role` to promote themselves             | policy violation (owner-only update)           |
| N8                         | Client calls `accept_invitation` with a token issued to another email       | exception: different email address             |
| N9                         | Client A selects Client B's invoice by UUID                                 | 0 rows                                         |
| N10                        | Client selects a `draft` invoice addressed to them                          | 0 rows                                         |
| N11                        | Staff of agency X inserts `folder_permissions` linking folder X to client Y | `EXISTS` check fails                           |
| N12                        | Unauthenticated request to any table                                        | 0 rows (no `anon` policies exist)              |
| N13                        | Client downloads a Storage object under another agency's prefix             | storage policy denies; signed URL not issuable |
| N14                        | Client edits `agency_id` in a request body to a foreign agency              | helper functions return false for that agency  |
| N15                        | Client moves a folder / renames a folder via PostgREST                      | no client UPDATE policy on `folders`           |
| N16                        | Owner deletes the only owner membership                                     | `guard_last_owner` exception                   |
| N17                        | Folder moved into its own descendant                                        | `guard_folder_cycle` exception                 |
| N18                        | Client inserts `invoice_line_items` to reduce a total                       | no client policy; also invoice not `draft`     |

---

## 9. Storage Architecture & Policies

### 9.1 Buckets

| Bucket Public Size limit Purpose Owner  |             |        |                        |                                |
| --------------------------------------- | ----------- | ------ | ---------------------- | ------------------------------ |
| `project-files`                         | **private** | 25 MiB | all folder attachments | B (uploads), A (bucket exists) |
| `agency-branding`                       | public      | 2 MiB  | agency logos           | A                              |
| `avatars`                               | public      | 2 MiB  | profile pictures       | A                              |

`agency-branding` and `avatars` are public because a logo must render on the login screen before a
session exists, and because avatars appear in message lists at high frequency where signed-URL churn
would be wasteful. Neither contains confidential material. Write access to both is still governed by
storage policies — public means *readable*, not *writable*.

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('project-files',   'project-files',   false, 26214400),
  ('agency-branding', 'agency-branding', true,   2097152),
  ('avatars',         'avatars',         true,   2097152)
on conflict (id) do nothing;

```

### 9.2 Path conventions (mandatory, no variation)

```text
project-files    {agency_id}/{folder_id}/{file_id}/{safe_filename}
agency-branding  {agency_id}/logo/{epoch_ms}-{safe_filename}
avatars          {profile_id}/{epoch_ms}-{safe_filename}

```

`file_id` is generated in the browser with `crypto.randomUUID()` **before** upload and is then used
as the `files.id` primary key, so metadata and object always agree. `{epoch_ms}` busts CDN caches on
re-upload.

`safe_filename` is produced by `js/core/utils.js → sanitizeFilename(name)`:

```js
export function sanitizeFilename(name) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^\w\-. ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "file";
  const ext = (dot > 0 ? name.slice(dot + 1) : "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  return ext ? `${base}.${ext}` : base;
}

```

Path segment 1 is always an agency id (or profile id for avatars). Storage policies rely on that
position, so it may never change.

### 9.3 Storage policies

```sql
-- ---------- project-files (private) ----------
create policy project_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.files f
      where f.storage_path = storage.objects.name
        and public.can_access_folder(f.folder_id)
        and (public.is_agency_staff(f.agency_id) or f.client_visible = true)
    )
  );

create policy project_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and public.is_agency_member((storage.foldername(name))[1]::uuid)
    and public.can_upload_to_folder((storage.foldername(name))[2]::uuid)
  );

create policy project_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-files'
    and (
      public.is_agency_staff((storage.foldername(name))[1]::uuid)
      or owner = auth.uid()
    )
  );

-- ---------- agency-branding (public read, owner write) ----------
create policy branding_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

create policy branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

create policy branding_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'agency-branding'
    and public.is_agency_owner((storage.foldername(name))[1]::uuid)
  );

-- ---------- avatars (public read, self write) ----------
create policy avatars_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

```

**Ordering requirement:** the `files` row must be inserted **before** the object is uploaded, because
`project_files_read` joins against it. The upload sequence is therefore:

1. `const fileId = crypto.randomUUID()`
2. build `storagePath`
3. `insert into files (id, …, storage_path)` — RLS validates folder upload rights
4. `supabase.storage.from('project-files').upload(storagePath, blob)`
5. if step 4 fails, delete the `files` row

### 9.4 Download behavior

Private objects are never linked directly. Downloads use short-lived signed URLs:

```js
const { data, error } = await supabase
  .storage.from("project-files")
  .createSignedUrl(file.storage_path, 60);   // 60 seconds

```

Signed URL issuance is itself subject to `project_files_read`, so an unauthorized client cannot mint
a URL for someone else's object. Signed URLs are generated on click, never rendered into the DOM
ahead of time, and never cached.

### 9.5 MIME and size guidance

Accepted MIME prefixes for `project-files` in V1:
`image/*`, `application/pdf`, `text/*`, `application/zip`,
`application/vnd.openxmlformats-officedocument.*`, `application/msword`,
`application/vnd.ms-excel`, `application/vnd.ms-powerpoint`.

Executable types (`application/x-msdownload`, `application/x-sh`, `.exe`, `.bat`, `.sh`, `.ps1`)
are rejected client-side and are additionally not previewable. Because the bucket is private and
objects are only ever served through signed URLs with `Content-Disposition: attachment` for unknown
types, stored-file XSS is not reachable from the application origin.

---

## 10. Authentication & Invitation Flow

### 10.1 Method decision (final)

**Email + password**, with Supabase email verification enabled and password recovery enabled.
No magic links, no OTP, no OAuth providers in V1. Rationale: invitation acceptance must bind a
specific email to a specific token, and password auth gives a client the simplest repeatable
re-entry into their portal without depending on email deliverability every session.

Supabase Auth settings required:

- Enable email provider
- Confirm email: **ON**
- Site URL: the deployed origin
- Additional redirect URLs: `<origin>/login.html`, `<origin>/index.html`, `<origin>/client-view.html`

### 10.2 Agency owner onboarding

```text
login.html (Sign up tab)
  → supabase.auth.signUp({ email, password, options:{ data:{ full_name } } })
  → "Check your inbox" state
  → user clicks confirmation link → returns to login.html with a session
  → trigger handle_new_user() has already created profiles row
  → profile step: update profiles.full_name / avatar
  → agency step: insert into agencies (name, slug, created_by = auth.uid())
  → trigger handle_new_agency() inserts agency_members(role='owner')
  → redirect to index.html

```

### 10.3 Returning user routing

`login.html` on load restores the session, then reads memberships:

| Membership situation Destination                 |                                           |
| ------------------------------------------------ | ----------------------------------------- |
| no session                                       | stay on `login.html`                      |
| session, no `profiles.full_name`                 | profile completion step                   |
| session, zero memberships, no pending invitation | agency creation step                      |
| session, memberships include `owner`/`team`      | `index.html`                              |
| session, memberships are `client` only           | `client-view.html`                        |
| session, both staff and client memberships       | `index.html`, agency switcher offers both |

`index.html` and `client-view.html` each re-verify role on boot and redirect if the role is wrong.
This is convenience routing; RLS is what actually protects the data.

### 10.4 Invitation flow

```text
STAFF INVITE                                CLIENT INVITE
owner → Team settings → Invite              staff → Clients → choose company → Invite contact
insert invitations(                         insert invitations(
  intended_role='team', client_id=null)       intended_role='client', client_id=<company>)
        │                                             │
        └──────────────┬──────────────────────────────┘
                       ▼
      UI shows a copyable link (email delivery is P1):
      https://<origin>/login.html?invite=<token>
                       ▼
      Recipient opens link → login.html reads ?invite=
        ├─ no session  → sign-up/login form prefilled with the invitation email (read-only)
        └─ session     → "Join <Agency>" confirmation
                       ▼
      supabase.rpc('accept_invitation', { p_token })
                       ▼
      membership created with the role stored on the invitation
                       ▼
      redirect: staff → index.html, client → client-view.html

```

Invitation security properties:

- The token is a server-generated uuid; it is never derived from the email.
- The invitee cannot `SELECT` the invitation, so tokens cannot be enumerated.
- `accept_invitation` requires the authenticated email to match the invited email exactly (case-insensitive). Forwarding a link to a colleague does not work — a fresh invitation is needed.
- `intended_role` is read from the row, never from the request.
- Expiry is 14 days; expired tokens flip to `status = 'expired'` on the attempt.
- Revoking sets `status = 'revoked'`, which fails the `pending` check immediately.

### 10.5 Password reset

```js
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${location.origin}/login.html?mode=reset`
});

```

`login.html?mode=reset` waits for the `PASSWORD_RECOVERY` auth event, shows a new-password form, and
calls `supabase.auth.updateUser({ password })`.

### 10.6 Session persistence

The shared client is created with `persistSession: true` and `autoRefreshToken: true`. On every page
boot, `js/auth/auth.js` awaits `supabase.auth.getSession()` **before** rendering the shell, so a
refresh never flashes the logged-out state. `onAuthStateChange` is registered exactly once, in
`js/auth/auth.js`, and is the only producer of the `auth:changed` event.

### 10.7 Logout

```text
user clicks Sign out
  → dispatch app:teardown { reason: 'signout' }
  → active module unmount()
  → realtime.unsubscribeAll()
  → supabase.auth.signOut()
  → state.reset()
  → location.replace('login.html')

```

`app:teardown` fires **before** `signOut()` so that modules can cancel in-flight work while the token
is still valid.

---

## 11. Folder Permission Rules (consolidated)

The complete authorization story in one place. Developer B must not restate or reinterpret any of it.

### 11.1 The two-gate rule

Every folder-scoped resource is readable by a client when **both** gates pass:

```text
GATE 1  can_access_folder(resource.folder_id) = true
GATE 2  resource.client_visible = true   (and, where present, archived_at is null)

```

Staff pass gate 1 for every folder in their agency and skip gate 2 entirely.

### 11.2 Per-entity rule table

| Entity Staff read Client read  |                                        |                                                                                    |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `folders`                      | all folders in agency (incl. archived) | folder or an ancestor is shared with their company, and not archived               |
| `conversations`                | all in accessible folder               | gate 1 + `client_visible` + not archived                                           |
| `messages`                     | all in readable conversation           | conversation readable + `client_visible`                                           |
| `boards`                       | all in accessible folder               | gate 1 + `client_visible` + not archived                                           |
| `board_columns`                | board readable                         | board readable (no own flag)                                                       |
| `tasks`                        | all in readable board                  | board readable + `client_visible`                                                  |
| `task_comments`                | all on readable task                   | task readable + `client_visible`                                                   |
| `docs`                         | all in accessible folder               | gate 1 + `client_visible` + not archived                                           |
| `files`                        | all in accessible folder               | gate 1 + `client_visible`                                                          |
| `invoices`                     | all in agency                          | `client_id` matches their company **and** `status <> 'draft'` (folder-independent) |
| `invoice_line_items`           | parent invoice readable                | parent invoice readable                                                            |
| `payments`                     | parent invoice readable                | parent invoice readable                                                            |
| `clients`                      | all in agency                          | own company only                                                                   |
| `agency_members`               | all in agency                          | own row + contacts at own company                                                  |
| `activity_logs`                | all in agency                          | none                                                                               |

Invoices are deliberately **not** gated on folders: a client must be able to pay a bill even if the
associated project folder was archived or was never shared. `folder_id` on an invoice is
organisational metadata only.

### 11.3 Inheritance, stated precisely

> A grant row `folder_permissions(folder_id = F, client_id = C)` makes folder F and every descendant
> of F accessible to every member of client company C, for as long as F and the requested folder are
> both un-archived.

- There are no deny rows.
- There is no per-user grant; grants are per company.
- Granting a child when a parent is already granted is redundant but harmless.
- Revoking the parent revokes the subtree unless a nearer grant exists.
- A client cannot learn the *name* of an inaccessible folder: the row simply does not exist for them, and `folder_breadcrumb` is `SECURITY INVOKER`.

### 11.4 Reordering contract

Applies identically to `folders.position`, `board_columns.position`, `tasks.position`,
`invoice_line_items.position`, `boards.position`.

- **Initial value:** `(max(position) among siblings) + 100`, or `100` for the first sibling.
- **Sibling scope:** folders → same `parent_id` within the agency; columns → same `board_id`; tasks → same `column_id`; line items → same `invoice_id`.
- **Drop between A and B:** `position = floor((A.position + B.position) / 2)`.
- **Drop at the start:** `position = floor(first.position / 2)`.
- **Drop at the end:** `position = last.position + 100`.
- **Collision / exhaustion:** if the computed position equals a neighbour, or any gap falls below 2, renormalize the whole sibling list to `100, 200, 300, …` in current visual order and persist every changed row in one `upsert` before applying the move.
- Lists are always read with `order by position asc, created_at asc` — never relying on natural order.

---

## 12. Realtime Architecture

### 12.1 Scope

| Channel purpose Table Filter Owner  |                 |                           |   |
| ----------------------------------- | --------------- | ------------------------- | - |
| active conversation messages        | `messages`      | `conversation_id=eq.<id>` | A |
| active board tasks                  | `tasks`         | `board_id=eq.<id>`        | B |
| active board columns                | `board_columns` | `board_id=eq.<id>`        | B |
| conversation list freshness         | `conversations` | `folder_id=eq.<id>`       | A |

Nothing subscribes without a filter. There is no agency-wide firehose.

### 12.2 Channel naming (mandatory)

```text
messages:conversation:{conversationId}
conversations:folder:{folderId}
tasks:board:{boardId}
columns:board:{boardId}

```

### 12.3 The registry

All subscriptions go through `js/core/realtime.js`, owned by Developer A and used by both:

```js
// js/core/realtime.js
export function subscribeChannel(key, builder)   // builder(channel) => channel with .on(...) applied
export function unsubscribeChannel(key)
export function unsubscribeByPrefix(prefix)      // e.g. "tasks:board:"
export function unsubscribeAll()
export function activeChannelKeys()              // for debugging/tests

```

`subscribeChannel(key, builder)` is idempotent: calling it twice with the same key removes the old
channel first. This makes duplicate subscriptions structurally impossible, which is the single most
common bug in this class of application.

Usage:

```js
import { subscribeChannel } from "../core/realtime.js";

subscribeChannel(`messages:conversation:${conversationId}`, (channel) =>
  channel.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "messages",
      filter: `conversation_id=eq.${conversationId}` },
    (payload) => appendMessage(payload.new)
  )
);

```

### 12.4 Lifecycle rules

| Trigger Required cleanup          |                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------- |
| switch conversation               | `unsubscribeByPrefix("messages:conversation:")` before subscribing to the new one |
| switch folder (`folder:selected`) | active module's `unmount()` runs, which unsubscribes its own channels             |
| switch module tab                 | previous module's `unmount()` runs                                                |
| switch agency                     | `app:teardown` → `unsubscribeAll()`                                               |
| sign out                          | `app:teardown` → `unsubscribeAll()`                                               |
| `beforeunload`                    | `unsubscribeAll()`                                                                |

A module that subscribes in `mount()` and does not unsubscribe in `unmount()` is a defect, not a
style preference.

### 12.5 Dedupe on arrival

Realtime INSERT payloads may race an optimistic local render. Both developers dedupe by primary key:
before appending a row, check `document.querySelector('[data-id="<uuid>"]')` (or an in-memory `Map`)
and update in place if present.

---

## 13. File Tree (authoritative)

```text
/
├── index.html                          [A]  internal team portal shell
├── client-view.html                    [A]  client portal shell
├── login.html                          [A]  auth, onboarding, invitations, reset
├── README.md                           [A owns; B appends its own section]
├── SHARED_SPEC.md                      [SHARED — DO NOT EDIT]
├── .gitignore                          [A]   must contain js/config.js
│
├── css/
│   ├── tokens.css                      [A — SHARED, B must not edit]
│   ├── reset.css                       [A — SHARED, B must not edit]
│   ├── layout.css                      [A — SHARED, B must not edit]
│   ├── components.css                  [A — SHARED, B must not edit]
│   ├── core.css                        [A]   shell, sidebar, folder tree, conversation
│   └── modules.css                     [B]   boards, docs, files, invoices, search
│
├── js/
│   ├── config.example.js               [A — SHARED]
│   ├── config.js                       [local only, git-ignored, never committed]
│   ├── supabaseClient.js               [A — SHARED, single createClient]
│   ├── app.js                          [A]   boot for index.html
│   ├── clientApp.js                    [A]   boot for client-view.html
│   ├── loginApp.js                     [A]   boot for login.html
│   │
│   ├── core/
│   │   ├── state.js                    [A — SHARED]
│   │   ├── events.js                   [A — SHARED]
│   │   ├── utils.js                    [A — SHARED]
│   │   ├── permissions.js              [A — SHARED]
│   │   ├── ui.js                       [A — SHARED]  toast/modal/empty/loading/error
│   │   ├── realtime.js                 [A — SHARED]  subscription registry
│   │   ├── appCore.js                  [A — SHARED]  the public integration surface
│   │   └── moduleRegistry.js           [A — SHARED]  lazy module loading + lifecycle
│   │
│   ├── auth/
│   │   ├── auth.js                     [A]
│   │   ├── onboarding.js               [A]
│   │   └── invitations.js              [A]
│   │
│   ├── workspace/
│   │   ├── agencies.js                 [A]
│   │   ├── members.js                  [A]
│   │   ├── clients.js                  [A]
│   │   ├── folders.js                  [A]
│   │   ├── folderTree.js               [A]
│   │   ├── folderPermissions.js        [A]
│   │   └── branding.js                 [A]
│   │
│   ├── conversations/
│   │   ├── conversations.js            [A]
│   │   └── messages.js                 [A]
│   │
│   └── modules/
│       ├── conversation.js             [A]  module adapter for the conversation tab
│       ├── boards.js                   [B]
│       ├── tasks.js                    [B]  helper for boards.js, not a tab
│       ├── docs.js                     [B]
│       ├── files.js                    [B]
│       ├── invoices.js                 [B]
│       ├── payments.js                 [B]  helper for invoices.js, not a tab
│       └── search.js                   [B]  overlay, not a tab
│
├── assets/
│   ├── icons/                          [A] inline SVG sprite + individual icons
│   └── images/                         [A] default logo mark, empty-state art
│
└── supabase/
    ├── migrations/
    │   ├── 0001_shared_schema.sql      [SHARED — identical in both ZIPs, DO NOT EDIT]
    │   ├── 01xx_*.sql                  [A] additive only, 0100–0199
    │   └── 02xx_*.sql                  [B] additive only, 0200–0299
    ├── policies/
    │   └── README.md                   [A] how to re-apply / verify policies
    └── functions/
        ├── create-checkout-session/
        │   └── index.ts                [B]
        └── stripe-webhook/
            └── index.ts                [B]

```

### 13.1 Merge mechanics

Developer A's ZIP contains every `[A]` and `[SHARED]` file, plus **no** `[B]` files at all.
Developer B's ZIP contains every `[B]` file, plus unmodified copies of the `[SHARED]` files it needed
to develop against (`supabaseClient.js`, `core/*`, `css/tokens.css`, `0001_shared_schema.sql`,
`SHARED_SPEC.md`).

Merge procedure: unzip A first, then unzip B **without overwriting** (`unzip -n`). If B's copy of a
shared file differs from A's, that is a contract breach and B's copy is discarded, not merged.

`js/modules/boards.js`, `docs.js`, `files.js`, `invoices.js` and `search.js` **do not exist in
Developer A's ZIP**. `moduleRegistry.js` imports them dynamically and degrades to a placeholder when
the import fails, so Part A runs standalone with no stub files to delete later.

---

## 14. File Ownership Matrix — Developer A vs Developer B

| Area Developer A Developer B                                  |                        |                                                            |
| ------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| HTML pages                                                    | creates all three      | never edits; mounts into containers                        |
| `supabaseClient.js`                                           | creates                | imports only                                               |
| `core/state.js`                                               | creates                | reads via `AppCore`; never mutates directly                |
| `core/events.js`                                              | creates                | uses `on()` / `emit()` for its own module events only      |
| `core/ui.js`                                                  | creates                | uses `toast`, `openModal`, `renderEmptyState`, …           |
| `core/realtime.js`                                            | creates                | uses `subscribeChannel` / `unsubscribeByPrefix`            |
| `core/appCore.js`                                             | creates                | consumes                                                   |
| `core/moduleRegistry.js`                                      | creates                | registers nothing manually; exports default module objects |
| `css/tokens.css`, `reset.css`, `layout.css`, `components.css` | creates                | uses classes/tokens, never edits                           |
| `css/core.css`                                                | creates                | never edits                                                |
| `css/modules.css`                                             | does not create        | creates and owns                                           |
| auth, onboarding, invitations                                 | owns                   | never touches                                              |
| agencies, members, clients, branding                          | owns                   | never touches                                              |
| folders, folderTree, folderPermissions                        | owns                   | never touches                                              |
| conversations, messages, `modules/conversation.js`            | owns                   | never touches                                              |
| boards, tasks, docs, files, invoices, payments, search        | never implements       | owns                                                       |
| Edge Functions                                                | does not create        | owns both                                                  |
| Migrations                                                    | `0100–0199`            | `0200–0299`                                                |
| README                                                        | writes the whole thing | appends a "Modules (Part B)" section at the end            |

**If Developer B needs something from Developer A** — the current folder, the current role, a toast,
a modal, a confirm dialog, a realtime channel, the Supabase client, the user's profile — it comes
from the integration contract. Reimplementing it is a merge failure, not a shortcut.

---

## 15. Naming Conventions

| Domain Convention Example  |                                                                  |                                                    |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| SQL identifiers            | `snake_case`                                                     | `folder_permissions`, `client_visible`             |
| SQL booleans               | positive phrasing                                                | `client_visible`, `can_upload` (never `is_hidden`) |
| SQL timestamps             | `*_at`                                                           | `created_at`, `archived_at`, `paid_at`             |
| SQL money                  | `*_cents` as `bigint`                                            | `total_cents`                                      |
| JS files                   | `camelCase.js`                                                   | `folderTree.js`, `moduleRegistry.js`               |
| JS functions/vars          | `camelCase`                                                      | `getSelectedFolderId`                              |
| JS constants               | `SCREAMING_SNAKE`                                                | `APP_CONFIG`, `MODULE_NAMES`                       |
| JS DB fields               | keep the SQL name verbatim                                       | `row.client_visible`, not `row.clientVisible`      |
| Custom events              | `domain:verb`, lowercase, colon-separated                        | `folder:selected`                                  |
| CSS classes                | `kebab-case` with a component prefix                             | `.ap-btn`, `.ap-folder-tree__item`                 |
| CSS modifiers              | `--modifier` suffix                                              | `.ap-btn--danger`, `.ap-tab--active`               |
| CSS tokens                 | `--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--font-*` | `--color-primary`                                  |
| DOM IDs                    | `kebab-case`, listed in §20                                      | `#module-content`                                  |
| Data attributes            | `data-*` kebab                                                   | `data-folder-id`, `data-module`                    |
| Realtime channels          | `table:scope:{uuid}`                                             | `messages:conversation:abc…`                       |
| Storage paths              | uuid segments, lowercase                                         | `{agency_id}/{folder_id}/{file_id}/name.pdf`       |

**Global CSS prefix:** **`ap-`** (Agency Portal). Every class either uses a token or an `ap-` prefixed
class. Developer B introduces `ap-board__*`, `ap-doc__*`, `ap-file__*`, `ap-invoice__*` and nothing
that redefines an `ap-btn`, `ap-input`, `ap-card`, `ap-modal`, or any token.

Database rows are passed around as plain objects with their **original snake\_case keys**. There is no
camelCase mapping layer. This eliminates an entire category of merge mismatch.

---

## 16. Shared Application State

`js/core/state.js` holds one object. There is no second store anywhere.

```js
// js/core/state.js — Developer A owns this file
const state = {
  session: null,            // Supabase Session | null
  user: null,               // Supabase User | null
  profile: null,            // public.profiles row | null
  memberships: [],          // agency_members rows joined with agencies, for the switcher
  agency: null,             // public.agencies row | null (the active agency)
  membership: null,         // the agency_members row for (user, agency) | null
  role: null,               // 'owner' | 'team' | 'client' | null
  clientId: null,           // agency_members.client_id | null  (clients only)
  folders: [],              // flat array of folders for the active agency
  selectedFolderId: null,   // uuid | null
  selectedModule: null,     // 'conversation' | 'boards' | 'docs' | 'files' | 'invoices' | null
  ready: false              // true after app:ready has been dispatched
};

```

Public surface of `state.js`:

```js
export function getState()                 // returns a shallow frozen copy
export function setState(patch)            // merges, then notifies subscribers
export function subscribe(listener)         // listener(state) -> returns unsubscribe()
export function resetState()               // returns to initial values (logout / agency switch)

```

Rules:

1. `setState` is called **only** by Developer A code. Developer B reads through `AppCore` getters or `AppCore.subscribe`.
2. `getState()` returns a copy. Mutating the result changes nothing.
3. State is memory-only. `localStorage` is used for exactly two non-authoritative UI preferences — `ap.lastAgencyId` and `ap.sidebarCollapsed` — and for nothing else. Supabase owns the auth token through its own storage; the application never reads or writes it.
4. `selectedFolderId` and `selectedModule` are mirrored into the URL hash (`#/f/{folderId}/{module}`) so refresh and deep links work. The hash is a *hint*; state is rebuilt from the database and validated by RLS on every boot.

---

## 17. Supabase Client Contract

```js
// js/supabaseClient.js — the ONLY createClient() call in this project
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { APP_CONFIG } from "./config.js";

export const supabase = createClient(
  APP_CONFIG.SUPABASE_URL,
  APP_CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "ap-auth"
    },
    realtime: { params: { eventsPerSecond: 8 } },
    global: { headers: { "x-application-name": "agency-portal" } }
  }
);

export default supabase;

```

Both a named and a default export exist so neither developer can get the import form wrong.
Any second `createClient(` string found anywhere in the merged repository is a build-breaking defect.

---

## 18. Integration API Contract

`js/core/appCore.js` exports `AppCore` and also assigns `window.AppCore` for debugging. Developer B
**imports the module**; `window.AppCore` is a console convenience, not the contract.

```js
// js/core/appCore.js
import { supabase } from "../supabaseClient.js";

export const AppCore = {
  // --- the client ---
  supabase,                          // the shared instance (property, not a function)

  // --- identity & workspace ---
  getCurrentSession(),               // => Session | null
  getCurrentUser(),                  // => User | null
  getCurrentProfile(),               // => profiles row | null
  getCurrentAgency(),                // => agencies row | null
  getCurrentMembership(),            // => agency_members row | null
  getCurrentRole(),                  // => 'owner' | 'team' | 'client' | null
  getCurrentClientId(),              // => uuid | null   (null for staff)
  isStaff(),                         // => boolean       (owner or team)
  isOwner(),                         // => boolean
  isClient(),                        // => boolean

  // --- folders ---
  getSelectedFolderId(),             // => uuid | null
  getSelectedFolder(),               // => folders row | null
  getFolders(),                      // => folders[] (flat, RLS-filtered, position-ordered)
  getFolderPath(folderId),           // => folders[] root→leaf, from the local tree
  selectFolder(folderId),            // Promise<void>; updates state, URL, breadcrumb, emits event

  // --- modules ---
  getSelectedModule(),               // => module name | null
  selectModule(moduleName),          // Promise<void>; unmounts previous, mounts next, emits event
  getModuleContext(),                // => the context object passed to mount()/refresh()

  // --- state ---
  getState(),                        // => frozen copy of the whole state object
  subscribe(listener),               // => unsubscribe()

  // --- UI helpers (implemented in core/ui.js, re-exported here) ---
  ui: {
    toast(message, variant),         // variant: 'success' | 'error' | 'info' | 'warning'
    confirm({ title, message, confirmLabel, danger }),   // => Promise<boolean>
    openModal({ title, content, actions, onClose }),     // => { close() }
    closeModal(),
    renderLoading(container, label),
    renderEmpty(container, { icon, title, message, actionLabel, onAction }),
    renderError(container, error, onRetry),
    describeError(error)             // => human-readable string from a Supabase error
  },

  // --- pure helpers (implemented in core/utils.js, re-exported here) ---
  utils: {
    escapeHtml(str),
    sanitizeHtml(html),              // allow-list sanitizer used by Docs
    sanitizeFilename(name),
    formatDate(value, style),        // style: 'short' | 'long' | 'relative' | 'datetime'
    formatBytes(bytes),
    formatMoney(cents, currency),
    initials(nameOrEmail),
    debounce(fn, ms),
    uuid()                           // crypto.randomUUID()
  }
};

export default AppCore;

```

### 18.1 Semantics that Developer B may rely on

- `AppCore.getFolders()` never returns a folder the current user cannot access — the array is built from an RLS-filtered query.
- `selectFolder(null)` is legal and means "no folder selected"; it emits `folder:selected` with `folderId: null` and modules must render their empty state.
- `selectModule(name)` with an unknown name is a no-op and logs a warning.
- `getModuleContext()` may be called at any time after `app:ready`.
- All getters are synchronous and cheap. `selectFolder` and `selectModule` return promises because they perform mounting and data loading.
- No getter ever throws. They return `null` before boot completes.

### 18.2 Module context object (exact shape)

```js
{
  supabase,                 // the shared client
  agencyId,                 // uuid
  agency,                   // agencies row
  folderId,                 // uuid | null
  folder,                   // folders row | null
  role,                     // 'owner' | 'team' | 'client'
  membership,               // agency_members row
  clientId,                 // uuid | null
  user,                     // Supabase User
  profile,                  // profiles row
  isStaff: boolean,
  isOwner: boolean,
  isClient: boolean,
  surface: 'team' | 'client',   // which HTML page is hosting the module
  AppCore                   // escape hatch for helpers
}

```

---

## 19. Custom Event Contract

All events are dispatched on `document` with `CustomEvent`. `js/core/events.js` provides:

```js
export function emit(name, detail = {})   // document.dispatchEvent(new CustomEvent(name, { detail }))
export function on(name, handler)         // => off() function
export function off(name, handler)
export const EVENTS = { /* frozen map of the names below */ };

```

Developer B listens with `on(...)` and **must** call the returned `off()` inside `unmount()`.

| Event Producer Consumers `detail` payload Fired when  |                               |                     |                                                                                                                                                              |                                                                     |
| ----------------------------------------------------- | ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `app:ready`                                           | A (`app.js` / `clientApp.js`) | A, B                | `{ agencyId, userId, role, surface }`                                                                                                                        | shell rendered, agency + folders loaded, exactly once per page load |
| `auth:changed`                                        | A (`auth/auth.js`)            | A, B                | `{ event, userId, hasSession }` where `event` is the Supabase auth event string                                                                              | on every `onAuthStateChange`                                        |
| `agency:selected`                                     | A (`workspace/agencies.js`)   | A, B                | `{ agencyId, role }`                                                                                                                                         | active agency set or switched, before folders reload                |
| `folder:selected`                                     | A (`workspace/folders.js`)    | A, **B (critical)** | `{ folderId, agencyId }` — `folderId` may be `null`                                                                                                          | user selects a folder, or a deep link resolves one                  |
| `folder:created`                                      | A                             | A, B                | `{ folderId, parentId, agencyId }`                                                                                                                           | after successful insert                                             |
| `folder:updated`                                      | A                             | A, B                | `{ folderId, agencyId, changes }` where `changes` is an array of column names                                                                                | after rename / move / recolor / reorder                             |
| `folder:deleted`                                      | A                             | A, B                | `{ folderId, agencyId }`                                                                                                                                     | after archive (soft delete)                                         |
| `module:selected`                                     | A (`core/moduleRegistry.js`)  | A, B                | `{ module, previousModule, folderId, agencyId }`                                                                                                             | before mounting the new module                                      |
| `module:mounted`                                      | A (`core/moduleRegistry.js`)  | A, B                | `{ module, folderId }`                                                                                                                                       | after `mount()` resolves                                            |
| `module:unmounted`                                    | A (`core/moduleRegistry.js`)  | A, B                | `{ module }`                                                                                                                                                 | after `unmount()` resolves                                          |
| `branding:changed`                                    | A (`workspace/branding.js`)   | A, B                | `{ agencyId, name, logoUrl, primaryColor }`                                                                                                                  | branding saved or first loaded                                      |
| `app:teardown`                                        | A                             | A, B                | `{ reason: 'signout' \| 'agency-switch' \| 'unload' }`                                                                                                       | before sign-out, agency switch, or page unload                      |
| `data:changed`                                        | A **or** B                    | A, B                | `{ entity, entityId, folderId, action }` where `entity` ∈ `folder,conversation,message,board,task,doc,file,invoice` and `action` ∈ `created,updated,deleted` | optional cross-module refresh hint                                  |

### 19.1 The canonical example

```js
// producer — Developer A, js/workspace/folders.js
import { emit } from "../core/events.js";

emit("folder:selected", { folderId, agencyId });
// equivalent to:
// document.dispatchEvent(new CustomEvent("folder:selected", { detail: { folderId, agencyId } }));

```

```js
// consumer — Developer B, js/modules/boards.js
import { on } from "../core/events.js";

let offFolderSelected = null;

async function mount(container, context) {
  offFolderSelected = on("folder:selected", ({ detail }) => {
    loadBoards(detail.folderId);
  });
}

async function unmount() {
  offFolderSelected?.();
  offFolderSelected = null;
}

```

### 19.2 Firing discipline

- `folder:selected` fires **once** per selection. Re-selecting the already-active folder is a no-op and emits nothing.
- `folder:selected` fires **before** `module:selected` when a folder change causes a remount.
- `app:ready` fires exactly once and never again, including after an agency switch (that emits `agency:selected`).
- No event is dispatched from inside a handler for the same event.
- `data:changed` is advisory. A module must still work correctly if it never receives one.

### 19.3 Forbidden names

These are common alternative spellings that must **never** appear. They are listed so that a grep can
catch them: `folderSelected`, `folder-selected`, `folderChanged`, `selectedFolder`,
`onFolderSelect`, `moduleChanged`, `module-change`, `authChanged`, `appReady`, `brandingUpdated`.

---

## 20. DOM Mounting Contract

Every ID below is unique per page and owned by Developer A. Developer B writes **inside**
`#module-content` and `#global-search-results` and nowhere else.

| ID Page(s) Owner Purpose  |                    |                                          |                                                     |
| ------------------------- | ------------------ | ---------------------------------------- | --------------------------------------------------- |
| `#app`                    | index, client-view | A                                        | root application wrapper                            |
| `#workspace-header`       | index, client-view | A                                        | top bar: logo, agency name, search entry, user menu |
| `#agency-identity`        | index, client-view | A                                        | logo + agency name + agency switcher                |
| `#global-search`          | index, client-view | A                                        | search input container (B mounts behaviour)         |
| `#global-search-results`  | index, client-view | **B renders inside**                     | search results panel                                |
| `#user-menu`              | index, client-view | A                                        | avatar, profile, settings, sign out                 |
| `#workspace-sidebar`      | index, client-view | A                                        | sidebar shell / mobile drawer                       |
| `#folder-tree`            | index, client-view | A                                        | nested folder tree                                  |
| `#folder-tree-actions`    | index              | A                                        | "New folder" and tree-level controls                |
| `#sidebar-backdrop`       | index, client-view | A                                        | mobile drawer backdrop                              |
| `#sidebar-toggle`         | index, client-view | A                                        | hamburger button in the header                      |
| `#page-header`            | index, client-view | A                                        | breadcrumb + folder title + contextual actions      |
| `#breadcrumb`             | index, client-view | A                                        | breadcrumb trail                                    |
| `#folder-actions`         | index              | A                                        | share / rename / archive for the active folder      |
| `#module-tabs`            | index, client-view | A                                        | tab strip; buttons carry `data-module="<name>"`     |
| `#module-content`         | index, client-view | **A owns the element, B renders inside** | the single mount target                             |
| `#toast-container`        | all three          | A                                        | toast stack                                         |
| `#modal-root`             | all three          | A                                        | modal portal                                        |
| `#auth-root`              | login              | A                                        | auth / onboarding / invitation UI                   |

### 20.1 Rules

- `#module-content` is **never removed or replaced**. Modules receive it as `container` and are expected to set `container.innerHTML = ""` in `unmount()`. Core also clears it defensively between mounts.
- Module tab buttons are rendered by Core as `<button class="ap-tab" data-module="boards" role="tab" aria-selected="false">Board</button>`. Developer B never adds, removes, or restyles tabs.
- Developer B must not attach listeners to `document` for DOM events (click, keydown) that are not scoped to its own subtree, except through `on()` for the custom events in §19.
- Any element Developer B creates carries `data-module="<name>"` on its outermost node, so ownership is visible in DevTools and orphan detection is trivial.
- Toasts and modals are requested through `AppCore.ui`, never by writing into `#toast-container` or `#modal-root` directly.

---

## 21. Module Lifecycle

### 21.1 Module names (exact strings)

```text
conversation   boards   docs   files   invoices

```

`search` is a module *file* but not a tab; it mounts into `#global-search-results` on demand.
Tab order in `#module-tabs`, left to right: **Conversation, Board, Docs, Files, Invoices**.
Default module on first folder selection: `conversation`.

### 21.2 The interface (exactly this, no variations)

Every file in `js/modules/` that backs a tab has a **default export** shaped like:

```js
// js/modules/boards.js  [B]
const boardsModule = {
  name: "boards",

  /**
   * @param {HTMLElement} container  always #module-content, already emptied
   * @param {object} context         see §18.2
   * @returns {Promise<void>}
   */
  async mount(container, context) {},

  /**
   * Remove listeners, cancel requests, unsubscribe realtime, clear the container.
   * Must be safe to call when mount() never ran or threw.
   * @returns {Promise<void>}
   */
  async unmount() {},

  /**
   * Re-read data for a context change without a full teardown.
   * Core calls this instead of unmount+mount when only folderId changed.
   * @param {object} context
   * @returns {Promise<void>}
   */
  async refresh(context) {}
};

export default boardsModule;

```

### 21.3 Registry and lazy loading

```js
// js/core/moduleRegistry.js  [A]
const MODULE_LOADERS = {
  conversation: () => import("../modules/conversation.js"),
  boards:       () => import("../modules/boards.js"),
  docs:         () => import("../modules/docs.js"),
  files:        () => import("../modules/files.js"),
  invoices:     () => import("../modules/invoices.js")
};

```

Core resolves a module like this:

1. `import()` the file.
2. If the import rejects (file absent — the normal case in Part A alone), render the integration placeholder into `#module-content`: `“Board — this module will load here.”` with a muted icon, and stop. No error toast.
3. If the module resolves but has no callable `mount`, render the same placeholder and `console.warn` the contract violation.
4. Otherwise call `mount(container, context)`.

This is why Part A ships **no stub files** for Developer B. Nothing has to be deleted at merge time.

### 21.4 Lifecycle state machine

| User action Core behaviour                |                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| selects a folder, no module active        | set state → emit `folder:selected` → `selectModule('conversation')`                                                                                                         |
| selects a different folder, module active | emit `folder:selected` → call active module's `refresh(context)`; if `refresh` is missing or throws, fall back to `unmount()` + `mount()`                                   |
| clicks a different tab                    | emit `module:selected` → previous `unmount()` → emit `module:unmounted` → clear `#module-content` → new `mount()` → emit `module:mounted`                                   |
| switches agency                           | emit `app:teardown{reason:'agency-switch'}` → active `unmount()` → `unsubscribeAll()` → `resetState()` (keeping session) → reload agency + folders → emit `agency:selected` |
| signs out                                 | emit `app:teardown{reason:'signout'}` → active `unmount()` → `unsubscribeAll()` → `auth.signOut()` → redirect                                                               |
| closes the tab                            | `beforeunload` → `unsubscribeAll()`                                                                                                                                         |

Core wraps every `mount`/`unmount`/`refresh` call in `try/catch`. A module that throws renders
`AppCore.ui.renderError(container, err, retry)` and never breaks the shell.

### 21.5 Client surface

`client-view.html` uses the identical registry and lifecycle. Its tab strip shows only
**Conversation, Board, Docs, Files, Invoices** that the client can actually use, and `context.surface`
is `'client'` so a module can render a simplified read-mostly UI. Modules must not decide client
permissions from `surface` — they read `context.isClient` for UX and let RLS decide truth.

---

## 22. UI Information Architecture

### 22.1 Internal team portal (`index.html`)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ #workspace-header                                                         │
│ [☰] #agency-identity ▾   #global-search            #user-menu ▾           │
├───────────────────────┬───────────────────────────────────────────────────┤
│ #workspace-sidebar    │ #page-header                                      │
│                       │   #breadcrumb   Home / Acme / Website Rebuild     │
│ #folder-tree-actions  │   <h1>Website Rebuild</h1>      #folder-actions   │
│  + New folder         ├───────────────────────────────────────────────────┤
│                       │ #module-tabs                                      │
│ #folder-tree          │  [Conversation] [Board] [Docs] [Files] [Invoices] │
│  ▾ ● Acme Corp        ├───────────────────────────────────────────────────┤
│    ▾ ● Website        │                                                   │
│        ● Phase 1      │  #module-content                                  │
│        ● Phase 2      │                                                   │
│    ● Retainer         │                                                   │
│  ▸ ● Northwind        │                                                   │
│                       │                                                   │
│ ─────────────         │                                                   │
│ Clients · Team ·      │                                                   │
│ Settings              │                                                   │
└───────────────────────┴───────────────────────────────────────────────────┘

```

The sidebar footer holds the three administration entries — **Clients**, **Team**, **Settings**
(branding) — which open full-width views inside `#module-content` while clearing the module tabs.
These are Developer A views and are not modules; they set `selectedModule = null`.

### 22.2 Client portal (`client-view.html`)

Same skeleton, fewer affordances: no `#folder-tree-actions`, no `#folder-actions`, no admin footer
links, no "internal" toggles anywhere. The header shows the agency's logo and name (the client sees
the agency's brand, not the product's). The user menu contains only Profile and Sign out.

### 22.3 Login / onboarding (`login.html`)

A single centred card inside `#auth-root` that switches between states:
`signin`, `signup`, `verify-email`, `forgot`, `reset`, `profile`, `create-agency`, `invitation`.
One page, one state machine, no routing library.

### 22.4 Responsive behaviour

| Breakpoint Layout  |                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1100px           | sidebar fixed at 280px, everything visible                                                                                                                                                                                                |
| 768–1099px         | sidebar 240px, `#folder-actions` collapses into a "…" menu                                                                                                                                                                                |
| < 768px            | sidebar becomes an overlay drawer toggled by `#sidebar-toggle`, backed by `#sidebar-backdrop`; `#module-tabs` scrolls horizontally; breadcrumb truncates to `… / parent / current`; modals become full-height sheets with a sticky footer |

Drawer rules: opening traps focus, `Escape` closes, the backdrop closes, selecting a folder closes it,
and `body` gets `overflow: hidden` while open.

---

## 23. Design System

`css/tokens.css` is the only place raw color/size values are declared. No other file contains a hex
color, a px font size, or a hard-coded spacing number.

```css
:root {
  /* brand — --color-primary is overwritten at runtime from agencies.primary_color */
  --color-primary:            #3F5BF6;
  --color-primary-hover:      #3149D4;
  --color-primary-soft:       #EDF0FE;
  --color-primary-contrast:   #FFFFFF;

  /* surfaces */
  --color-bg:                 #F6F7FB;
  --color-surface:            #FFFFFF;
  --color-surface-secondary:  #F0F1F6;
  --color-surface-raised:     #FFFFFF;

  /* text */
  --color-text:               #161A26;
  --color-text-muted:         #6A7186;
  --color-text-inverse:       #FFFFFF;

  /* lines & status */
  --color-border:             #E3E5EE;
  --color-border-strong:      #C9CDDB;
  --color-danger:             #D6455D;
  --color-danger-soft:        #FCEBEE;
  --color-success:            #1E9E6A;
  --color-success-soft:       #E7F6EF;
  --color-warning:            #C7821B;
  --color-warning-soft:       #FDF4E3;
  --color-info:               #3F5BF6;
  --color-focus-ring:         #8AA0FA;

  /* typography */
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  --font-size-xs:   0.75rem;
  --font-size-sm:   0.8125rem;
  --font-size-md:   0.875rem;
  --font-size-lg:   1rem;
  --font-size-xl:   1.25rem;
  --font-size-2xl:  1.5rem;
  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-semibold: 600;
  --line-height-tight: 1.25;
  --line-height-body:  1.55;

  /* spacing — 4px scale */
  --space-1: 0.25rem;  --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;     --space-5: 1.5rem;  --space-6: 2rem;
  --space-7: 3rem;     --space-8: 4rem;

  /* radii */
  --radius-sm: 6px;  --radius-md: 10px;  --radius-lg: 14px;  --radius-pill: 999px;

  /* elevation */
  --shadow-sm: 0 1px 2px rgba(22, 26, 38, .06), 0 1px 3px rgba(22, 26, 38, .04);
  --shadow-md: 0 4px 12px rgba(22, 26, 38, .08);
  --shadow-lg: 0 16px 40px rgba(22, 26, 38, .14);

  /* structure */
  --sidebar-width: 280px;
  --header-height: 56px;
  --content-max:   1240px;
  --z-dropdown: 100; --z-drawer: 200; --z-modal: 300; --z-toast: 400;

  /* motion */
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
}

```

### 23.1 Shared components (`css/components.css`, Developer A)

Developer A implements, and Developer B reuses without redefining:

`.ap-btn` (`--primary`, `--secondary`, `--ghost`, `--danger`, `--sm`, `--icon`, `[disabled]`,
`.is-loading`), `.ap-input`, `.ap-textarea`, `.ap-select`, `.ap-checkbox`, `.ap-radio`,
`.ap-switch`, `.ap-field` (+ `.ap-field__label`, `.ap-field__hint`, `.ap-field__error`),
`.ap-card`, `.ap-panel`, `.ap-badge` (`--neutral/--success/--warning/--danger/--info`),
`.ap-avatar` (`--sm/--md`), `.ap-menu` + `.ap-menu__item`, `.ap-modal` + `.ap-modal__header/body/footer`,
`.ap-toast` (`--success/--error/--info/--warning`), `.ap-tabs` + `.ap-tab` + `.ap-tab--active`,
`.ap-empty`, `.ap-skeleton`, `.ap-spinner`, `.ap-divider`, `.ap-tooltip`, `.ap-dot` (color marker),
`.ap-table`, `.ap-chip`.

Status is never signalled by colour alone: every badge carries a label, every state icon carries an
accessible name.

### 23.2 Branding application

```js
// js/workspace/branding.js  [A]
document.documentElement.style.setProperty("--color-primary", agency.primary_color);
document.documentElement.style.setProperty("--color-primary-hover", shade(agency.primary_color, -12));
document.documentElement.style.setProperty("--color-primary-soft",  tint(agency.primary_color, 92));
document.documentElement.style.setProperty(
  "--color-primary-contrast", contrastOn(agency.primary_color)   // '#FFFFFF' or '#161A26'
);

```

`contrastOn` uses relative luminance so text on a pale brand colour stays readable. Fallbacks when no
branding is set: the token defaults above and `assets/images/default-logo.svg`. There is exactly one
theme system — this one. Developer B introduces no theming of any kind.

---

## 24. Internal Team View — feature matrix

| Feature Owner Team Notes                          |   |   |                                          |
| ------------------------------------------------- | - | - | ---------------------------------------- |
| Folder tree                                       | ✅ | ✅ | all folders in the agency                |
| Create / rename / recolor / move / archive folder | ✅ | ✅ |                                          |
| Share folder with a client                        | ✅ | ✅ | `folder_permissions`                     |
| View who has access                               | ✅ | ✅ |                                          |
| Conversations                                     | ✅ | ✅ | create, archive, toggle `client_visible` |
| Internal notes                                    | ✅ | ✅ | `client_visible = false`, visibly marked |
| Boards / columns / tasks                          | ✅ | ✅ | B                                        |
| Mark task client-visible                          | ✅ | ✅ | B                                        |
| Task comments (internal or shared)                | ✅ | ✅ | B                                        |
| Docs                                              | ✅ | ✅ | B                                        |
| Files upload / delete                             | ✅ | ✅ | B                                        |
| Invoices create / send                            | ✅ | ✅ | B                                        |
| Delete draft invoice                              | ✅ | ❌ |                                          |
| Record manual payment                             | ✅ | ❌ |                                          |
| Clients: create / edit / archive                  | ✅ | ✅ |                                          |
| Invite client contact                             | ✅ | ✅ |                                          |
| Team: invite / remove / change role               | ✅ | ❌ |                                          |
| Branding (name, logo, color)                      | ✅ | ❌ |                                          |
| Agency settings                                   | ✅ | ❌ |                                          |
| Search                                            | ✅ | ✅ | B                                        |
| Activity log                                      | ✅ | ✅ | read-only list                           |

Owner-only controls are not rendered for `team`, **and** are additionally rejected by RLS. Both
layers exist; only the second one matters for security.

---

## 25. Client View

### 25.1 What a client sees

- The agency's logo, name, and brand colour.
- A folder tree containing only shared subtrees.
- Per folder: conversations marked client-visible, client-visible boards/tasks, client-visible docs, client-visible files, and an Invoices tab listing their company's non-draft invoices.
- A profile menu with name, avatar, password change, sign out.

### 25.2 What a client never sees, at any layer

Internal notes · unshared folders (including their names) · unshared or internal boards, tasks, docs,
files · other client companies · the team member list · invitations · branding controls · agency
settings · draft invoices · activity logs · any folder create/rename/move/archive control.

### 25.3 Client capabilities

| Action Allowed                                 |                                               |
| ---------------------------------------------- | --------------------------------------------- |
| Read shared, client-visible content            | ✅                                             |
| Reply in a client-visible conversation         | ✅                                             |
| Comment on a client-visible task               | ✅ (comment is forced `client_visible = true`) |
| Upload a file to a folder granted `can_upload` | ✅                                             |
| Delete a file they uploaded                    | ✅                                             |
| Pay a sent invoice                             | ✅                                             |
| Everything else                                | ❌                                             |

### 25.4 Client UX principles

The client portal opens on the most recently active shared folder and its Conversation tab, because
"what needs my attention" is almost always a message. Empty states speak plainly — "No documents have
been shared with you yet." — and never hint that hidden content exists. Nothing in the client UI uses
the words *internal*, *team*, *owner*, or *agency admin*.

---

## 26. Billing & Stripe Architecture

### 26.1 Flow

```text
Client clicks “Pay invoice” (js/modules/payments.js, Developer B)
   │  supabase.functions.invoke('create-checkout-session', { body: { invoice_id } })
   ▼
Edge Function create-checkout-session
   1. read the caller's JWT from the Authorization header
   2. create a request-scoped Supabase client with the ANON key + that JWT
        → RLS applies exactly as it would in the browser
   3. select the invoice by id; if 0 rows → 404 (never 403 with detail)
   4. reject unless status = 'sent' or 'overdue'
   5. read total_cents and currency FROM THE DATABASE ROW, never from the request body
   6. stripe.checkout.sessions.create({ mode:'payment', line_items:[…], metadata:{ invoice_id } })
   7. insert payments row (service-role client): status='pending', provider_session_id=session.id
   8. return { url: session.url }
   ▼
Browser redirects to session.url
   ▼
Stripe → POST webhook → Edge Function stripe-webhook
   1. stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)
   2. on checkout.session.completed:
        update payments set status='succeeded', provider_payment_id=…, paid_at=now()
        update invoices set status='paid', paid_at=now() where id = metadata.invoice_id
        insert activity_logs (action='invoice.paid')
   3. always return 200 after successful processing; 400 on signature failure

```

### 26.2 Non-negotiables

- The amount charged is read from `invoices.total_cents` inside the function. The request body carries only `invoice_id`.
- The browser sends no amount, no currency, no price id.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` exist **only** as Edge Function secrets. They appear in no `.js` file, no HTML file, no committed config.
- The webhook is idempotent: `payments.provider_payment_id` has a unique index, and a duplicate event is a no-op.
- Until the functions are deployed, `invoke()` fails and Developer B renders "Online payment isn't configured for this workspace yet." This is an honest stub, not a fake success.

### 26.3 Edge Function environment variables

| Variable Where Notes                 |                         |                                           |
| ------------------------------------ | ----------------------- | ----------------------------------------- |
| `SUPABASE_URL`                       | both functions          | injected by Supabase                      |
| `SUPABASE_ANON_KEY`                  | create-checkout-session | used with the caller's JWT so RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY`          | both                    | server-only, bypasses RLS deliberately    |
| `STRIPE_SECRET_KEY`                  | both                    |                                           |
| `STRIPE_WEBHOOK_SECRET`              | stripe-webhook          |                                           |
| `APP_SUCCESS_URL` / `APP_CANCEL_URL` | create-checkout-session | absolute URLs back into the portal        |

Set with `supabase secrets set KEY=value`. Never in `supabase/config.toml`, never in git.

---

## 27. Search Architecture

**Decision:** **`ILIKE`** **+** **`pg_trgm`** **GIN indexes behind the** **`search_workspace`** **RPC (§7.4.3).** Full-text
search with `tsvector` is deferred to P1; trigram `ILIKE` gives substring matching (which users
expect from a filter box) without maintaining generated columns, and the GIN indexes keep it fast at
V1 data volumes.

- Scope: folder names, task titles + descriptions, doc titles + `content_text`, conversation titles, file original names.
- The RPC is `SECURITY INVOKER`, so RLS filters results per caller. Client search is automatically scoped to shared, client-visible content with no extra code.
- Minimum query length 2 characters; input debounced 250 ms; results capped at 60.
- Result rows carry `folder_id`, so clicking a result calls `AppCore.selectFolder(folder_id)` and then `AppCore.selectModule(<mapped module>)`.
- Entity → module mapping: `folder → conversation`, `task → boards`, `doc → docs`, `conversation → conversation`, `file → files`.
- Search never reveals the existence of an inaccessible object. There is no result count from a wider query, no "3 hidden results" affordance.

---

## 28. Security Requirements

### 28.1 Authorization

RLS is enabled on every user-facing table and is the only authority. `js/core/permissions.js` exists
purely to decide what to render; a bug there is a cosmetic bug, never a breach. Every helper function
is `SECURITY DEFINER` with `set search_path = public, pg_temp` to prevent search-path hijacking, and
every one is narrow — none accepts a "user id" parameter that the caller could spoof; they all read
`auth.uid()` themselves.

### 28.2 XSS

`innerHTML` with interpolated user data is banned. Every user-supplied string reaches the DOM through
`textContent` or through `utils.escapeHtml()`. The single exception is `docs.content_html`, which
passes through `utils.sanitizeHtml()` **on save and again on render**. The sanitizer is allow-list
based:

- allowed tags: `p, br, strong, em, u, s, h1, h2, h3, ul, ol, li, blockquote, code, pre, a, hr`
- allowed attributes: `href` on `a` only
- `href` must match `^(https?:|mailto:)` — `javascript:` and `data:` are stripped
- links get `rel="noopener noreferrer nofollow" target="_blank"` injected
- every other tag is unwrapped, every other attribute dropped, comments and `<template>` removed

Implementation uses `DOMParser` + a recursive walk, never a regex.

### 28.3 Files

Filenames sanitized (§9.2). MIME allow-list enforced client-side and reinforced by the bucket's
private setting plus attachment-disposition signed URLs. Size capped at 25 MiB in three independent
places. `project-files` is private; there are no public object URLs for client content.

### 28.4 Secrets

The browser receives `SUPABASE_URL` and `SUPABASE_ANON_KEY` and nothing else — this is the anon key's
designed purpose and it is safe *only because* RLS is correct. `js/config.js` is git-ignored.
`js/config.example.js` contains placeholders. A pre-ZIP grep for `service_role`, `sk_live`, `sk_test`,
`whsec_` must return nothing.

### 28.5 Privilege escalation

Membership is insertable only by an owner or by `accept_invitation`. Roles are constrained by `CHECK`.
The last owner cannot be removed. Invitation role comes from the stored row. A client's `client_id`
is read server-side from their membership, never from a request parameter.

### 28.6 Direct-ID attacks

Every read policy is an authorization predicate, not an obscurity measure. Knowing a UUID grants
nothing. Error responses for missing-vs-forbidden are identical (empty result), so UUID probing
yields no oracle.

### 28.7 Input handling

All database access goes through the Supabase client, which parameterizes. No string-built SQL
anywhere in the frontend. `.eq()`/`.in()` filters on user input are still RLS-bounded. Text lengths
are constrained by `CHECK` so a client cannot store megabytes in a message.

### 28.8 Session

Tokens live in Supabase's own storage under `storageKey: "ap-auth"`. Application code never reads,
copies, logs, or forwards them. `app:teardown` + `unsubscribeAll()` precede `signOut()`.

---

## 29. Configuration & Environment Variables

A browser cannot read `.env`. There is no bundler in this project, so there is no build-time
substitution either. Configuration is therefore a committed *example* file and a git-ignored real
file.

```js
// js/config.example.js   [SHARED] — copy to js/config.js and fill in
export const APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  APP_NAME: "Agency Portal",
  DEFAULT_CURRENCY: "USD",
  MAX_UPLOAD_BYTES: 26214400
};

```

```gitignore
# .gitignore
js/config.js
.env
.DS_Store
node_modules/

```

Setup instruction that both READMEs must carry verbatim:

```bash
cp js/config.example.js js/config.js
# edit js/config.js with your Supabase project URL and anon key

```

For static deploys, `js/config.js` is created by the host's build step or committed to a private
deployment branch. It contains only public values either way.

**Never in any frontend file:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, database connection strings, SMTP credentials.

---

## 30. Migration Strategy

| File Owner Rule          |        |                                                         |
| ------------------------ | ------ | ------------------------------------------------------- |
| `0001_shared_schema.sql` | SHARED | byte-identical in both ZIPs; neither developer edits it |
| `0100–0199_*.sql`        | A      | additive only                                           |
| `0200–0299_*.sql`        | B      | additive only                                           |

Additive means: `CREATE INDEX`, `ALTER TABLE … ADD COLUMN … DEFAULT … NOT NULL` where safe, new
helper functions, new policies on tables you own. Never: renaming a column, dropping a column,
changing a `CHECK` constraint's allowed values, redefining another developer's table, disabling RLS.

Every extra migration gets a line in the README stating what it adds and why. If a genuine schema gap
appears, the correct escalation is to report it rather than to patch around it — a divergent schema
is the one defect that cannot be merged.

Applying migrations: Supabase SQL editor (paste the file) or `supabase db push` with the CLI. The
schema is written so that running `0001` on a fresh project succeeds in one pass, top to bottom.

---

## 31. Error Handling

One convention, implemented in `js/core/ui.js` by Developer A, used by both.

```js
try {
  renderLoading(container, "Loading tasks…");
  const { data, error } = await supabase.from("tasks").select("*").eq("board_id", boardId);
  if (error) throw error;
  if (!data.length) {
    return renderEmpty(container, {
      title: "No tasks yet",
      message: "Add a card to get started.",
      actionLabel: "New task",
      onAction: createTask
    });
  }
  renderTasks(container, data);
} catch (err) {
  renderError(container, err, () => loadTasks(boardId));
}

```

`describeError(error)` maps Supabase errors to plain language:

| Signal Message                                                |                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| PostgREST `42501`, or message containing `row-level security` | "You don't have permission to do that."                            |
| `PGRST116` (no rows from `.single()`)                         | "That item no longer exists."                                      |
| `23505` unique violation                                      | "That already exists."                                             |
| `23514` check violation                                       | "Some of those values aren't valid."                               |
| network / `TypeError: Failed to fetch`                        | "Can't reach the server. Check your connection and try again."     |
| anything else                                                 | "Something went wrong. Please try again." + `console.error(error)` |

Rules: never `alert()`, never `confirm()` — use `AppCore.ui.confirm`. Never render a raw Supabase
error string to a user. Never leave a button in a loading state after a failure. A permission denial
is stated as a permission denial and never as "not found" *in the UI* — while the *database* still
returns empty results so the two are indistinguishable over the wire.

---

## 32. Responsive & Accessibility Rules

- Semantic elements: `<header> <nav> <main> <aside> <ul>/<li>` for the tree, `<button>` for anything clickable, `<a href>` only for navigation.
- The folder tree is `role="tree"` / `role="treeitem"` with `aria-expanded`, `aria-selected`, `aria-level`, and arrow-key navigation (↑ ↓ move, → expand, ← collapse, Enter select).
- Tabs are `role="tablist"` / `role="tab"` with `aria-selected` and left/right arrow support.
- Every input has a `<label>`; errors are linked with `aria-describedby` and `aria-invalid`.
- Modals: focus moves to the dialog, focus is trapped, `Escape` closes, focus returns to the trigger, `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- Toasts live in an `aria-live="polite"` region; errors use `assertive`.
- Visible focus ring everywhere: `outline: 2px solid var(--color-focus-ring); outline-offset: 2px`. `:focus-visible` is used, and focus outlines are never removed without a replacement.
- Contrast: body text ≥ 4.5:1, large text and UI borders ≥ 3:1. Brand colours chosen so that `--color-primary-contrast` is computed, not assumed.
- Status never relies on colour alone — badges carry text, the folder colour dot is decorative with the name adjacent.
- Touch targets ≥ 40×40 px on small screens.
- `prefers-reduced-motion: reduce` disables transitions and drag animations.
- Every image has `alt`; decorative SVGs get `aria-hidden="true"`.

---

## 33. Cross-Developer Merge Procedure

1. Developer A delivers `agency-portal-part-a.zip`. Developer B delivers `agency-portal-part-b.zip`.
2. `unzip agency-portal-part-a.zip -d merged/`
3. `cd merged && unzip -n ../agency-portal-part-b.zip` (`-n` = never overwrite)
4. `diff` every `[SHARED]` file against B's copy. Any difference is a contract breach: keep A's file and file the breach.
5. Confirm `grep -rn "createClient(" js/` returns exactly one hit: `js/supabaseClient.js`.
6. Confirm `grep -rn "folderSelected\|folder-selected\|folderChanged" .` returns nothing.
7. Confirm `grep -rniE "service_role|sk_live|sk_test|whsec_" .` returns nothing.
8. Confirm `js/modules/{boards,docs,files,invoices,search}.js` exist and each has a default export with `mount`, `unmount`, `refresh`.
9. Confirm migrations are `0001` + `01xx` + `02xx` with no renumbering and no edits to `0001`.
10. Run the acceptance matrix in §34.

---

## 34. Acceptance Test Matrix

Legend: **A** = verifiable in Part A alone · **B** = needs Part B · **M** = merged only.

### Authentication

| # Test Scope  |                                                                                          |   |
| ------------- | ---------------------------------------------------------------------------------------- | - |
| T1            | Owner signs up, confirms email, completes profile, creates agency, lands on `index.html` | A |
| T2            | Refresh on `index.html` restores the session without a logged-out flash                  | A |
| T3            | Sign out clears state, unsubscribes realtime, redirects to `login.html`                  | A |
| T4            | Password reset email → `?mode=reset` → new password → sign in                            | A |
| T5            | Team invitation link → accept → membership created with role `team`                      | A |
| T6            | Client invitation link → accept → lands on `client-view.html`                            | A |
| T7            | Accepting an invitation issued to another email is rejected                              | A |

### Workspace

| # Test Scope  |                                                                                                   |   |
| ------------- | ------------------------------------------------------------------------------------------------- | - |
| T8            | Agency name, logo, and primary colour load and apply to `--color-primary`                         | A |
| T9            | Owner uploads a logo; it persists to `agency-branding` and re-renders                             | A |
| T10           | A user in two agencies can switch; folders reload; `agency:selected` fires; realtime is torn down | A |
| T11           | Team member cannot open branding settings, and the UPDATE is rejected server-side                 | A |

### Folders

| # Test Scope  |                                                                          |   |
| ------------- | ------------------------------------------------------------------------ | - |
| T12           | Create root folder, create nested child, create grandchild               | A |
| T13           | Rename, recolor, archive                                                 | A |
| T14           | Drag-reorder siblings; order survives refresh                            | A |
| T15           | Move a folder to a new parent; breadcrumb updates                        | A |
| T16           | Moving a folder into its own descendant is rejected                      | A |
| T17           | Selecting a folder emits `folder:selected` with `{ folderId, agencyId }` | A |
| T18           | Deep link `#/f/{id}/docs` selects the folder and the Docs tab on load    | M |

### Permissions

| # Test Scope  |                                                                        |   |
| ------------- | ---------------------------------------------------------------------- | - |
| T19           | Share Folder A with Client A; Client A sees it and its descendants     | A |
| T20           | Client B sees neither Folder A nor its children                        | A |
| T21           | Client A querying Client B's folder UUID directly gets 0 rows          | A |
| T22           | Revoking the grant removes the whole subtree from Client A immediately | A |
| T23           | Archiving a shared folder hides it from the client, staff still see it | A |

### Messaging

| # Test Scope  |                                                                                                             |   |
| ------------- | ----------------------------------------------------------------------------------------------------------- | - |
| T24           | Team creates a conversation, marks it client-visible, posts a message                                       | A |
| T25           | Client receives that message over Realtime without refreshing                                               | A |
| T26           | Client replies; team receives it over Realtime                                                              | A |
| T27           | Team posts an internal note; it is absent from the client's query **and** from the client's Realtime stream | A |
| T28           | Switching conversations leaves exactly one active `messages:conversation:*` channel                         | A |
| T29           | One-level reply renders with its parent quoted                                                              | A |

### Modules & integration

| # Test Scope  |                                                                                            |   |
| ------------- | ------------------------------------------------------------------------------------------ | - |
| T30           | With Part A alone, Board/Docs/Files/Invoices tabs render the placeholder and log no errors | A |
| T31           | After merge, each tab mounts the real module into `#module-content`                        | M |
| T32           | Changing folders calls the active module's `refresh(context)` with the new `folderId`      | M |
| T33           | Changing tabs calls `unmount()` then `mount()`; no listeners or channels leak              | M |
| T34           | A module that throws in `mount()` shows an error state; the shell stays usable             | M |

### Boards, Docs, Files, Invoices

| # Test Scope  |                                                                                 |   |
| ------------- | ------------------------------------------------------------------------------- | - |
| T35           | Task created, dragged between columns, order persists after refresh             | B |
| T36           | Client-visible task appears in the client portal; internal task does not        | B |
| T37           | Doc saved with `<script>` in the body is stored and rendered sanitized          | B |
| T38           | Team uploads a file; `files` row and Storage object both exist and agree        | B |
| T39           | Authorized client downloads via signed URL; unauthorized client cannot mint one | B |
| T40           | Invoice total equals the sum of line items computed by the database trigger     | B |
| T41           | The intended client sees the sent invoice; another client gets 0 rows           | B |
| T42           | Draft invoices are invisible to clients                                         | B |
| T43           | "Pay" invokes `create-checkout-session` with only `invoice_id`                  | B |
| T44           | Search returns only RLS-permitted rows for a client                             | B |

### Responsive & accessibility

| # Test Scope  |                                                                               |   |
| ------------- | ----------------------------------------------------------------------------- | - |
| T45           | At 375px the drawer opens, traps focus, closes on Escape and on folder select | A |
| T46           | Full keyboard traversal of the folder tree and tab strip                      | A |
| T47           | Modals return focus to their trigger                                          | A |

---

## 35. P0 / P1 / P2 Roadmap

**P0 — required for the merged MVP**
Auth + email verification + reset · invitations (team and client) · profiles · agency creation and
branding · memberships and roles · client companies · nested folders with color, order, move, archive ·
folder permissions with inheritance · conversations, messages, internal notes, realtime, one-level
replies · the shell, tabs, state, events, module lifecycle · boards, columns, tasks with drag ordering
and client visibility · task comments · docs with sanitized HTML · file upload/download with signed
URLs · invoices with DB-computed totals and statuses · the Stripe Checkout Edge Function contract ·
search · full RLS · responsive layout · accessibility baseline.

**P1 — soon after integration**
Transactional invitation emails · notifications and unread badges · activity feed UI · `@mentions` ·
message attachments · task filters and a "my tasks" view · doc version history · file previews for
images and PDFs · invoice PDF export · manual payment recording UI · agency switcher polish ·
`tsvector` full-text search · avatar upload UI · bulk folder actions · CSV export.

**P2 — later**
Email reply synchronisation into conversations · recurring invoices and autopay · external storage
connectors · time tracking · proposals and quotes · custom domains · client-side task creation ·
granular per-user folder permissions with deny rules · multi-currency · an `admin` role tier ·
audit-grade logging · mobile applications.

---

## 36. Final Developer A Checklist

Scaffolding & shared foundations

- [ ] `js/config.example.js` with the exact `APP_CONFIG` shape; `js/config.js` git-ignored
- [ ] `js/supabaseClient.js` — the only `createClient()` in the repository
- [ ] `core/state.js`, `core/events.js`, `core/utils.js`, `core/permissions.js`, `core/ui.js`, `core/realtime.js`, `core/appCore.js`, `core/moduleRegistry.js`
- [ ] `css/tokens.css`, `reset.css`, `layout.css`, `components.css`, `core.css`

Auth & onboarding

- [ ] sign up, email verification state, sign in, sign out, session restore, password reset
- [ ] profile completion, agency creation, owner membership via trigger
- [ ] invitation acceptance through `accept_invitation` RPC, both roles
- [ ] role-based routing between `index.html` and `client-view.html`

Workspace

- [ ] agency load, agency switcher, branding read + write, brand colour applied to CSS variables
- [ ] team member list, invite, remove, role display, owner-only gating
- [ ] client companies CRUD, client contact invitations

Folders

- [ ] tree with unlimited depth, expand/collapse, colour dot, active state, keyboard navigation
- [ ] create, rename, recolor, move, archive, drag reorder with the §11.4 position algorithm
- [ ] breadcrumb, empty states, mobile drawer
- [ ] folder sharing UI: grant, list who has access, revoke, `can_upload` toggle

Conversations

- [ ] list, create, open, client-visible toggle, archive
- [ ] send message, one-level reply, internal note with clear visual marking
- [ ] realtime subscribe/unsubscribe through the registry, no duplicate channels
- [ ] sender identity, timestamps, team vs client differentiation

Shell & integration

- [ ] every DOM ID from §20 present on the right page
- [ ] tab strip with `data-module` values, placeholder rendering for absent B modules
- [ ] `AppCore` complete and matching §18 exactly
- [ ] every event in §19 dispatched with the documented payload at the documented moment
- [ ] `#module-content` never replaced; cleared between mounts

Quality

- [ ] responsive at 375 / 768 / 1280
- [ ] accessibility checklist in §32
- [ ] no `alert()`, no raw error strings, no `innerHTML` with user data
- [ ] README with setup, local server instructions, event/API reference, security notes
- [ ] grep clean for secrets, duplicate clients, forbidden event names

## 37. Final Developer B Checklist

- [ ] imports `supabase` from `js/supabaseClient.js`; contains no `createClient(`
- [ ] every module file has a default export with `name`, `mount`, `unmount`, `refresh`
- [ ] all cross-module communication uses `on()` from `core/events.js`, with `off()` in `unmount()`
- [ ] all realtime uses `subscribeChannel` / `unsubscribeByPrefix` from `core/realtime.js`
- [ ] all toasts, modals, confirms, loading, empty and error states use `AppCore.ui`
- [ ] renders only inside `#module-content` and `#global-search-results`
- [ ] writes CSS only in `css/modules.css`, only `ap-`-prefixed classes, only token values
- [ ] boards: columns, tasks, HTML5 drag ordering with the §11.4 algorithm, client-visibility toggles
- [ ] docs: contenteditable editor, `sanitizeHtml` on save and render, `content_text` maintained
- [ ] files: upload sequence from §9.3 (metadata row first), signed URLs on click, size/MIME guards
- [ ] invoices: line items, DB-computed totals displayed read-only, statuses, client scoping
- [ ] payments: `create-checkout-session` invoked with `invoice_id` only; honest unconfigured state
- [ ] search: `search_workspace` RPC, debounced, result → `selectFolder` + `selectModule`
- [ ] edge functions: secrets only in Supabase secrets, webhook signature verified, idempotent
- [ ] migrations only in `0200–0299`, additive, documented in the README section B appends
- [ ] does not ship modified copies of any `[SHARED]` file

---

# LOCKED CONTRACT — DO NOT CHANGE IN PART A OR PART B

Everything below is frozen. Any deviation breaks the merge.

## Tables (19)

```text
profiles                agencies              clients               agency_members
invitations             folders               folder_permissions    conversations
messages                boards                board_columns         tasks
task_comments           docs                  files                 invoices
invoice_line_items      payments              activity_logs

```

## Roles (exactly 3 strings)

```text
owner    team    client

```

## Storage buckets

```text
project-files      (private, 25 MiB)   {agency_id}/{folder_id}/{file_id}/{safe_filename}
agency-branding    (public,   2 MiB)   {agency_id}/logo/{epoch_ms}-{safe_filename}
avatars            (public,   2 MiB)   {profile_id}/{epoch_ms}-{safe_filename}

```

## Critical column names

```text
agency_id  folder_id  parent_id  client_id  profile_id  created_by  uploaded_by
role  position  color  archived_at  created_at  updated_at
client_visible                 (conversations, messages, boards, tasks, task_comments, docs, files)
can_upload                     (folder_permissions)
reply_to_message_id            (messages)
intended_role  token  status  expires_at  accepted_at   (invitations)
board_id  column_id  assignee_id  due_date  priority  completed_at   (tasks)
content_html  content_text  last_edited_by                 (docs)
bucket_name  storage_path  original_name  mime_type  size_bytes      (files)
invoice_number  currency  issue_date  due_date  status
subtotal_cents  tax_rate_bp  tax_cents  discount_cents  total_cents  (invoices)
quantity_milli  unit_price_cents  amount_cents                       (invoice_line_items)
provider  provider_session_id  provider_payment_id                   (payments)

```

## Enum-style values

```text
agency_members.role      owner | team | client
invitations.intended_role owner | team | client
invitations.status       pending | accepted | revoked | expired
tasks.priority           low | normal | high | urgent
invoices.status          draft | sent | paid | overdue | void
payments.provider        stripe | manual
payments.status          pending | succeeded | failed | refunded

```

## SQL helper functions

```text
public.is_agency_member(uuid)      public.is_agency_owner(uuid)
public.is_agency_team(uuid)        public.is_agency_staff(uuid)
public.is_agency_client(uuid)      public.current_client_id(uuid)
public.can_view_profile(uuid)      public.can_access_folder(uuid)
public.can_upload_to_folder(uuid)  public.can_read_conversation(uuid)
public.can_read_board(uuid)        public.can_read_task(uuid)
public.can_read_invoice(uuid)

```

## RPC functions

```text
public.accept_invitation(p_token uuid)
public.folder_breadcrumb(p_folder uuid)
public.search_workspace(p_agency uuid, p_query text)

```

## Custom events (dispatched on `document`)

```text
app:ready          { agencyId, userId, role, surface }
auth:changed       { event, userId, hasSession }
agency:selected    { agencyId, role }
folder:selected    { folderId, agencyId }
folder:created     { folderId, parentId, agencyId }
folder:updated     { folderId, agencyId, changes }
folder:deleted     { folderId, agencyId }
module:selected    { module, previousModule, folderId, agencyId }
module:mounted     { module, folderId }
module:unmounted   { module }
branding:changed   { agencyId, name, logoUrl, primaryColor }
app:teardown       { reason }
data:changed       { entity, entityId, folderId, action }

```

## Shared exported functions

```text
js/supabaseClient.js    export const supabase           (also default export)

js/core/state.js        getState  setState  subscribe  resetState
js/core/events.js       emit  on  off  EVENTS
js/core/realtime.js     subscribeChannel  unsubscribeChannel
                        unsubscribeByPrefix  unsubscribeAll  activeChannelKeys
js/core/ui.js           toast  confirm  openModal  closeModal
                        renderLoading  renderEmpty  renderError  describeError
js/core/utils.js        escapeHtml  sanitizeHtml  sanitizeFilename  formatDate
                        formatBytes  formatMoney  initials  debounce  uuid
js/core/appCore.js      export const AppCore            (also default export)

AppCore surface:
  supabase
  getCurrentSession  getCurrentUser  getCurrentProfile  getCurrentAgency
  getCurrentMembership  getCurrentRole  getCurrentClientId
  isStaff  isOwner  isClient
  getSelectedFolderId  getSelectedFolder  getFolders  getFolderPath  selectFolder
  getSelectedModule  selectModule  getModuleContext
  getState  subscribe
  ui { … }   utils { … }

```

## DOM mounting IDs

```text
#app                 #workspace-header    #agency-identity     #global-search
#global-search-results                    #user-menu           #workspace-sidebar
#folder-tree         #folder-tree-actions #sidebar-backdrop    #sidebar-toggle
#page-header         #breadcrumb          #folder-actions      #module-tabs
#module-content      #toast-container     #modal-root          #auth-root

```

## Module names and lifecycle

```text
conversation [A]   boards [B]   docs [B]   files [B]   invoices [B]
search [B]  — not a tab; mounts into #global-search-results

export default {
  name: "<module name>",
  async mount(container, context) {},
  async unmount() {},
  async refresh(context) {}
}

```

## Realtime channel keys

```text
messages:conversation:{conversationId}
conversations:folder:{folderId}
tasks:board:{boardId}
columns:board:{boardId}

```

## Configuration format

```js
// js/config.js  (git-ignored; js/config.example.js is committed)
export const APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  APP_NAME: "Agency Portal",
  DEFAULT_CURRENCY: "USD",
  MAX_UPLOAD_BYTES: 26214400
};

```

## Shared file names

```text
index.html  client-view.html  login.html  README.md  SHARED_SPEC.md  .gitignore

css/tokens.css  css/reset.css  css/layout.css  css/components.css
css/core.css [A]                              css/modules.css [B]

js/config.example.js  js/supabaseClient.js
js/app.js  js/clientApp.js  js/loginApp.js
js/core/{state,events,utils,permissions,ui,realtime,appCore,moduleRegistry}.js
js/auth/{auth,onboarding,invitations}.js
js/workspace/{agencies,members,clients,folders,folderTree,folderPermissions,branding}.js
js/conversations/{conversations,messages}.js
js/modules/conversation.js [A]
js/modules/{boards,tasks,docs,files,invoices,payments,search}.js [B]

supabase/migrations/0001_shared_schema.sql   [SHARED, byte-identical]
supabase/migrations/01xx_*.sql               [A]
supabase/migrations/02xx_*.sql               [B]
supabase/functions/create-checkout-session/index.ts  [B]
supabase/functions/stripe-webhook/index.ts           [B]

```

## Fixed conventions

```text
CSS class prefix          ap-
CSS naming                kebab-case, BEM-ish: .ap-block__element--modifier
DB field names in JS      kept snake_case, no camelCase mapping layer
Money                     bigint minor units, columns end in _cents
Quantities                bigint ×1000, column ends in _milli
Ordering                  integer `position`, step 100, midpoint insert, renormalize below gap 2
Soft delete               archived_at timestamptz
Folder inheritance        a grant on F covers F and all descendants; no deny rows
Threading                 one level via reply_to_message_id
Doc content               sanitized HTML in content_html + plain content_text for search
Default module            conversation
Tab order                 Conversation, Board, Docs, Files, Invoices
Migration ranges          A: 0100–0199    B: 0200–0299

```

**End of LOCKED CONTRACT.** Developer A and Developer B implement against this document and nothing
else. Where this document is silent, choose the simplest secure option that leaves every item above
untouched.