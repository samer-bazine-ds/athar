-- Invitation lifecycle and acceptance repairs.
-- Apply after 0300_portal_experience.sql.

-- Staff may cancel a pending invitation, but cannot reopen accepted/revoked rows
-- or manufacture an accepted invitation through a normal table update.
drop policy if exists invitations_update_staff on public.invitations;
create policy invitations_update_staff on public.invitations
  for update to authenticated
  using (
    public.is_agency_staff(agency_id)
    and status = 'pending'
  )
  with check (
    public.is_agency_staff(agency_id)
    and status in ('revoked', 'expired')
  );

-- Do not silently consume an invitation when the account already has a
-- different membership in the workspace. A matching pre-existing membership
-- may accept the invitation without a misleading role change.
create or replace function public.accept_invitation(p_token uuid)
returns table (agency_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv              public.invitations%rowtype;
  v_email          text;
  existing_role    text;
  existing_client  uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into inv
  from public.invitations
  where token = p_token
  for update;

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

  select m.role, m.client_id
  into existing_role, existing_client
  from public.agency_members m
  where m.agency_id = inv.agency_id
    and m.profile_id = auth.uid();

  if found then
    if existing_role is distinct from inv.intended_role
       or existing_client is distinct from inv.client_id then
      raise exception 'This account already belongs to the workspace with a different role';
    end if;
  else
    insert into public.agency_members (agency_id, profile_id, role, client_id, invited_by)
    values (inv.agency_id, auth.uid(), inv.intended_role, inv.client_id, inv.invited_by);
  end if;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return query select inv.agency_id, inv.intended_role;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;
