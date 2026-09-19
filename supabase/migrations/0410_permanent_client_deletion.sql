-- Permanent client deletion
--
-- Deleting a client already cascades their agency membership, invitations and
-- folder permissions. Invoices were the one remaining blocking dependency.
-- Make them cascade too, including their line items and payment rows.

alter table public.invoices
  drop constraint if exists invoices_client_id_fkey;

alter table public.invoices
  add constraint invoices_client_id_fkey
  foreign key (client_id)
  references public.clients(id)
  on delete cascade;
