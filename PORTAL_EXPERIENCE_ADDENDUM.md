# Portal Experience Addendum

This addendum describes the UI/workflow extension added after `SHARED_SPEC.md` in order to match the supplied reference-video workflow more closely while keeping original Agency Portal branding, code, and assets.

## New navigation model

### Global rail

- Home
- Inbox
- Tasks
- Invoices
- More

### Workspace sidebar

- Home
- My Tasks
- Library
  - Everything
  - Boards
  - Conversations
  - Documents
  - Embeds
  - Files
  - Archive
  - Trash
- Folders
- Team/client/settings administration (staff only)

## New views

`js/views/portalViews.js` owns the new global/workspace collection views. Existing feature modules remain in `js/modules/*` and are opened from collection rows or folder overviews.

## New database extension

`supabase/migrations/0300_portal_experience.sql` adds:

- `trashed_at` on folders, boards, conversations, docs
- `embeds` table
- RLS updates for Trash/Embeds
- search support for embeds and task descriptions
- client protection for trashed content

## Templates

Templates in V1 are built-in application templates. They create real nested folders through the existing folder API. They do not add a new database table yet.

## Compatibility

The original roles, Supabase client, Auth model, agency model, folder permissions, modules, files, invoices, Realtime infrastructure, and Stripe backend remain unchanged. The new experience is an additive UX layer around those systems.
