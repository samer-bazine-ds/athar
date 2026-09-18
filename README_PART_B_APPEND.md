# Agency Portal — Modules (Part B)

This ZIP is Developer B's merge-safe half of Agency Portal. It implements only the files owned by Developer B in `SHARED_SPEC.md`: Boards/Tasks, Docs, Files, Invoices/Payments, Search, `css/modules.css`, B-range SQL migration(s), and the two Stripe Edge Functions.

## Merge target

Start with Developer A's finished project, then copy the B-owned files from this ZIP into the same relative paths. Do **not** overwrite Developer A's shared/core files. `SHARED_SPEC.md` in this ZIP is a reference copy of the authoritative contract provided for development.

Developer B depends on the exact Core API from the shared specification:

- `js/supabaseClient.js` → `export const supabase`
- `js/core/appCore.js` → `AppCore`
- `js/core/events.js` → `emit`, `on`, `off`, `EVENTS`
- `js/core/realtime.js` → `subscribeChannel`, `unsubscribeChannel`, `unsubscribeByPrefix`, `unsubscribeAll`, `activeChannelKeys`
- `#module-content` for tab modules
- `#global-search-results` for Search results
- module context shape from §18.2

Tab modules export exactly `name`, `mount(container, context)`, `unmount()`, and `refresh(context)`.

## B-owned files

```text
css/modules.css
js/modules/boards.js
js/modules/tasks.js
js/modules/docs.js
js/modules/files.js
js/modules/invoices.js
js/modules/payments.js
js/modules/search.js
supabase/migrations/0200_search_task_descriptions.sql
supabase/functions/create-checkout-session/index.ts
supabase/functions/stripe-webhook/index.ts
```

## Configuration

The browser configuration is still owned by Core. Use the shared setup exactly:

```bash
cp js/config.example.js js/config.js
# edit js/config.js with your Supabase project URL and anon key
```

No Stripe secret or service-role key belongs in browser files.

## Database

Run the shared `0001_shared_schema.sql` from Developer A first. Then apply B migrations in numeric order.

`0200_search_task_descriptions.sql` keeps the locked `search_workspace(p_agency uuid, p_query text)` signature and corrects the implementation to include task descriptions, matching §27 of the shared spec. It also adds a trigram index for non-null task descriptions.

No shared table is renamed or redefined.

## Boards / Tasks

`boards.js` provides:

- board create/edit/archive and client visibility
- ordered columns with create/edit/delete and drag reorder
- task create/edit/delete, assignment, due date, priority, completion and client visibility
- native HTML5 task drag/drop between columns
- position persistence using the shared step-100/midpoint ordering contract
- task comments; clients are forced to `client_visible = true`
- scoped Realtime channels: `tasks:board:{boardId}` and `columns:board:{boardId}`

Clients receive read-only task controls; RLS remains authoritative.

## Docs

`docs.js` uses `contenteditable` and the shared `AppCore.utils.sanitizeHtml()` allow-list. It sanitizes immediately before save and again before render. It maintains `content_text` from `textContent` for search and debounces saves.

Clients get a read-only document view and see only RLS-permitted client-visible docs.

## Files

The Storage sequence follows §9.3 exactly:

1. Generate `fileId` in the browser.
2. Build `{agency_id}/{folder_id}/{file_id}/{safe_filename}`.
3. Insert the `files` metadata row first.
4. Upload to private bucket `project-files`.
5. Delete the metadata row if upload fails.

Downloads mint 60-second signed URLs only when clicked. V1 limits uploads to 25 MiB and rejects executable types. Clients can upload only where `can_upload_to_folder()` allows and may delete only their own uploads through RLS.

## Invoices / Payments

Invoice amounts use bigint minor units only. Quantity inputs are converted to `quantity_milli`; prices/discounts use cents. The frontend displays database-computed totals and never submits `subtotal_cents`, `tax_cents`, or `total_cents`.

Clients see only their non-draft invoices through RLS. `Pay invoice` invokes:

```js
supabase.functions.invoke("create-checkout-session", {
  body: { invoice_id }
});
```

No amount, currency, or Stripe price ID is sent from the browser.

## Stripe Edge Functions

Set server secrets in Supabase:

```bash
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set APP_SUCCESS_URL=https://your-app.example/client-view.html?payment=success
supabase secrets set APP_CANCEL_URL=https://your-app.example/client-view.html?payment=cancelled
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied to `create-checkout-session` by the Supabase environment.

Deploy:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

`create-checkout-session` authenticates the caller, lets RLS resolve the invoice, verifies that the caller is the invoice's client company, reads the authoritative amount/currency from Postgres, creates Stripe Checkout, then writes a pending payment with the server client.

`stripe-webhook` verifies the Stripe signature, validates amount/currency against the invoice, marks the matching pending payment succeeded, marks the invoice paid, and appends `invoice.paid` once. Repeated completed events are idempotent with respect to invoice status and the unique provider payment ID.

## Search integration

Search uses `search_workspace`, minimum 2 characters, 250 ms debounce, and maps results exactly:

- folder → `conversation`
- task → `boards`
- doc → `docs`
- conversation → `conversation`
- file → `files`

Clicking a result calls `AppCore.selectFolder(folder_id)` then `AppCore.selectModule(module)`.

`search.js` is deliberately not part of the tab registry. Core owns `#global-search`, while B owns search behavior and rendering inside `#global-search-results`. The Core boot should optional-load the module after `app:ready` and call its `mount()` with `#global-search-results` and `AppCore.getModuleContext()`. This optional import must degrade silently while Part A is run without B files, just like the tab module imports.

Conceptual Core-side loader (for Developer A to implement in its owned boot code, not included in this ZIP):

```js
import("./modules/search.js")
  .then(({ default: search }) => search.mount(
    document.getElementById("global-search-results"),
    AppCore.getModuleContext()
  ))
  .catch(() => {});
```

The search module itself exports `mountGlobalSearch()` as a convenience but does not mutate Core state directly.

## Merge checklist

1. Copy B files into Developer A's matching paths without overwriting A-owned/shared files.
2. Confirm Developer A's HTML already links `css/modules.css`; if Part A intentionally leaves the link in place while the file is absent, merging B satisfies it.
3. Confirm Core optional-loads `js/modules/search.js` for global search behavior.
4. Apply `0001_shared_schema.sql`, then `0200_search_task_descriptions.sql`.
5. Verify `project-files` is private and its policies from `0001` are present.
6. Deploy/configure the Stripe Edge Functions only when online payment is wanted.
7. Run the shared acceptance/security tests T35–T44 and N1–N18.

## Security notes

- RLS is the authorization authority; UI checks are convenience only.
- B code never creates a second browser Supabase client.
- User strings are rendered through `textContent`; Docs HTML goes through the locked sanitizer.
- Private project files have no public URLs.
- Stripe/service-role secrets appear only in Edge Functions via `Deno.env`.
- Direct UUID knowledge grants no access because every query remains RLS-scoped.
