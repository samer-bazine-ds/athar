# Agency Portal — Complete Project

A complete framework-free agency client portal built from the authoritative `SHARED_SPEC.md` contract. It includes the Core platform and all productivity modules in one project.

## Included

- Supabase Auth: email/password, verification, password recovery, persistent sessions
- Owner onboarding and agency creation
- Team/client invitations and client companies
- Multi-agency membership model
- Nested folders, color, ordering, drag-to-nest, breadcrumbs, archive
- Folder-level client sharing with inherited descendant access and `can_upload`
- Conversations, one-level replies, internal notes, Supabase Realtime
- Kanban boards, columns, tasks, comments, due dates, priorities, drag/drop ordering
- Rich-text Docs using `contenteditable` and allow-list sanitization
- Private Supabase Storage file uploads, signed downloads and client upload rules
- Invoices, line items, database-computed totals and statuses
- Stripe Checkout Edge Function + verified webhook implementation
- RLS-scoped global search
- Team and client views, responsive shell, shared design system
- Video-inspired portal workflow: global rail, Home, Inbox, global Tasks, global Invoices, Library collections, Archive, Trash, Embeds and Templates

## 1. Create a Supabase project

Create a normal Supabase project. In **Authentication → Providers → Email**:

- Enable Email provider
- Enable email confirmation
- Set Site URL to your deployment origin
- Add redirect URLs for `/login.html`, `/index.html`, `/client-view.html`

## 2. Apply the database migration

Run the entire file in Supabase SQL Editor:

```text
supabase/migrations/0001_shared_schema.sql
```

Then run the remaining migrations **in this order**:

```text
supabase/migrations/0200_search_task_descriptions.sql
supabase/migrations/0250_security_repairs.sql
supabase/migrations/0300_portal_experience.sql
supabase/migrations/0400_invitation_lifecycle.sql
```

`0250_security_repairs.sql` contains the consolidated RLS/bootstrap fixes (including the workspace/folder permission issues discovered during testing). `0300_portal_experience.sql` adds the global Library experience, Embeds, and separate Archive/Trash support. `0400_invitation_lifecycle.sql` prevents accepted invitations from being reopened and makes invitation acceptance safe for existing memberships.

The shared migration creates all 19 tables, functions, triggers, RPCs, RLS policies, Realtime publication entries, Storage buckets, and Storage policies described in `SHARED_SPEC.md`.

Do **not** disable RLS.

## 3. Frontend configuration

`js/config.js` is included with placeholders for convenience in this ZIP and is listed in `.gitignore`. Replace the values before running:

```js
export const APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  APP_NAME: "Agency Portal",
  DEFAULT_CURRENCY: "USD",
  MAX_UPLOAD_BYTES: 26214400
};
```

Only the Supabase URL and **anon/public key** belong in the browser. Never place a service-role key or Stripe secret in frontend files.

## 4. Run locally

Because the project uses browser ES modules, serve it over HTTP instead of double-clicking the HTML file.

```bash
python -m http.server 8080
```

or

```bash
npx serve .
```

Then open:

```text
http://localhost:8080/login.html
```

## 5. First user flow

1. Sign up with email/password.
2. Confirm the email through Supabase.
3. Return to `login.html`.
4. Complete profile name if needed.
5. Create the agency workspace.
6. The database trigger creates the owner membership automatically.
7. You are redirected to `index.html`.

## 6. Invitations

### Team

Owner → Team → Invite team member. The app sends the invitation email and also shows a backup link.

### Client

Clients → create a client company → Invite contact. The app sends the invitation email and also shows a backup link.

Deploy the email function and configure Resend before sending invitations:

```bash
supabase functions deploy send-invitation-email
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set INVITATION_FROM_EMAIL="Athar <invites@yourdomain.com>"
supabase secrets set APP_BASE_URL=https://your-site.example
```

The sender domain must be verified in Resend. The authenticated invitee must use the same email address as the invitation. Membership role comes only from the stored invitation row.

## 7. Folder sharing

Select a folder and click **Share**. Grants apply to the selected client company and are inherited by descendants. `can_upload` controls client file uploads.

Security is enforced by PostgreSQL RLS; hiding UI is never the security boundary.

## 8. File Storage

Bucket: `project-files` (private, 25 MiB)

Path:

```text
{agency_id}/{folder_id}/{file_id}/{safe_filename}
```

The implementation creates the metadata row first and then uploads the Storage object, matching the Storage policy contract. Downloads use 60-second signed URLs.

## 9. Stripe setup

The browser invokes `create-checkout-session` with **only** `invoice_id`.

Deploy the functions:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

Set secrets:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set APP_SUCCESS_URL=https://your-site/client-view.html
supabase secrets set APP_CANCEL_URL=https://your-site/client-view.html
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are normally injected/available in the Edge Functions environment as configured by Supabase. The checkout function uses the caller JWT with the anon key so RLS verifies invoice access; service role is used only for server-side payment row operations. The webhook verifies the raw Stripe signature and is idempotent through the unique provider payment id.

Until Stripe functions/secrets are configured, the UI reports that online payment is not configured instead of faking success.

## 10. Main file tree

```text
index.html
client-view.html
login.html
SHARED_SPEC.md
README.md
css/
  tokens.css
  reset.css
  layout.css
  components.css
  core.css
  modules.css
  portal.css
js/
  config.example.js
  config.js
  supabaseClient.js
  app.js
  clientApp.js
  loginApp.js
  core/
    state.js events.js utils.js permissions.js ui.js realtime.js appCore.js moduleRegistry.js
  auth/
    auth.js onboarding.js invitations.js
  workspace/
    agencies.js members.js clients.js folders.js folderTree.js folderPermissions.js branding.js
  conversations/
    conversations.js messages.js
  modules/
    conversation.js boards.js tasks.js docs.js files.js invoices.js payments.js search.js
  views/
    portalViews.js
supabase/
  migrations/
    0001_shared_schema.sql
    0200_search_task_descriptions.sql
    0250_security_repairs.sql
    0300_portal_experience.sql
    0400_invitation_lifecycle.sql
  policies/README.md
  functions/
    create-checkout-session/index.ts
    send-invitation-email/index.ts
    stripe-webhook/index.ts
```

## 11. Integration contract

The implementation follows the frozen contract in `SHARED_SPEC.md`:

- roles: `owner`, `team`, `client`
- tab modules: `conversation`, `boards`, `docs`, `files`, `invoices`
- one browser Supabase client: `js/supabaseClient.js`
- folder event: `folder:selected { folderId, agencyId }`
- module mount point: `#module-content`
- search results mount point: `#global-search-results`
- Realtime keys: `messages:conversation:*`, `conversations:folder:*`, `tasks:board:*`, `columns:board:*`
- database row keys stay `snake_case` in JavaScript

## 12. Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, or `STRIPE_WEBHOOK_SECRET` in frontend JS/HTML.
- All user-facing tables have RLS enabled.
- Clients see only shared folders plus `client_visible` content.
- Docs are sanitized on save and render.
- Project files are private and accessed via signed URLs.
- Clients cannot create/move tasks in V1; they can comment on visible tasks.
- Draft invoices are invisible to clients.
- Stripe payment amount/currency are read server-side from the invoice row.

## 13. Verification before production

Install the development checks once, then run the full static, lint, and browser smoke suite:

```bash
npm install
npm run check
```

The browser suite starts its own local HTTP server on port `8765`.

Run these acceptance cases with four test accounts: Owner, Team, Client A, Client B.

- Owner/team login and session refresh
- Client routing to `client-view.html`
- Client A cannot query Client B folder UUID
- Folder permission inheritance
- Internal message never appears for client, including Realtime
- Task ordering persists after refresh
- Private task/doc/file stays hidden from client
- Client file upload requires `can_upload`
- Another client cannot mint a signed file URL
- Draft invoice invisible to client
- Sent invoice visible only to intended client
- Checkout request body contains only `invoice_id`
- Search returns only rows RLS permits

## 14. Static hosting

The frontend is static and can be hosted on GitHub Pages, Netlify, Vercel, or Cloudflare Pages. Ensure `js/config.js` exists in the deployed artifact with the public Supabase values and that Supabase Auth redirect URLs include the deployed pages.

## 15. Portal workflow matching the reference video

The internal portal now follows the same **workflow pattern** demonstrated in the supplied recording while keeping original Agency Portal branding/code:

- far-left global rail: Home, Inbox, Tasks, Invoices, More
- workspace sidebar: Home, My Tasks, expandable Library, Folders
- Library collections: Everything, Boards, Conversations, Documents, Embeds, Files, Archive, Trash
- Home: recent folders, recent items, quick-create cards
- Inbox drawer: Chats, Tasks, Files, Updates
- global Tasks: All/Completed plus Table/Calendar views
- global Invoices: search/filter plus Create Invoice menu
- Templates under More: reusable folder structures
- folder overview: mixed item table with search/visibility filters and Create menu
- compact typography, light borders, restrained surfaces and high information density

The implementation deliberately does **not** copy any third-party logo, proprietary source code, imagery, or exact marketing text.

### Fresh setup reminder

For a fresh Supabase project, do not stop after `0001_shared_schema.sql`. Run every migration listed in section 2. If you already ran the earlier schema and the manual consolidated SQL repair patch, run `0300_portal_experience.sql` and `0400_invitation_lifecycle.sql` afterward.

## Kitchen-style interface update

The team workspace UI has been rebuilt to closely match the supplied Kitchen.co screenshots while keeping this project's existing Supabase data model and functionality. The update includes:

- Kitchen-style global navigation rail, search bar, profile menu, rounded workspace panels, spacing and typography
- Home dashboard with recent folders, recent items and six quick-create cards
- Split Inbox layout with workspace preview on the right
- Clients table and create-client flow
- Tasks table and calendar views
- Settings shell and pages for Home, Branding, Proposals, Invoices, Quotes, Tasks, Forms, Zapier, Pabbly Connect, Members, Permissions, Teams and Billing
- Existing folder, board, conversation, document, file, invoice, authentication and Supabase features remain connected to the original project

The implementation recreates the visual layout from the provided references; it does not include or copy Kitchen.co's proprietary source code or backend.

### Invitation email delivery

Client and team invitations are sent by the `send-invitation-email` Supabase Edge Function. Deploy it and configure the required secrets before inviting users:

```sh
supabase functions deploy send-invitation-email
supabase secrets set RESEND_API_KEY=re_xxx INVITATION_FROM_EMAIL="Athar <invites@example.com>" APP_BASE_URL=https://your-site.example
```

The `INVITATION_FROM_EMAIL` value must use a verified sender/domain in Resend. If the function or secrets are not configured, the invitation is revoked and the UI shows the delivery error instead of presenting a link that was never emailed.
