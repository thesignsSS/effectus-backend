create table if not exists public.proposal_invitations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  inviter_user_id uuid not null references public.profiles (id) on delete cascade,
  invitee_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  unique (proposal_id, invitee_user_id)
);

create index if not exists proposal_invitations_invitee_status_idx
  on public.proposal_invitations (invitee_user_id, status, created_at desc);

create index if not exists proposal_invitations_proposal_idx
  on public.proposal_invitations (proposal_id);

drop trigger if exists set_proposal_invitations_updated_at on public.proposal_invitations;

create trigger set_proposal_invitations_updated_at
before update on public.proposal_invitations
for each row
execute function public.set_updated_at();

alter table public.proposal_invitations enable row level security;

drop policy if exists "proposal_invitations_select_related_or_admin" on public.proposal_invitations;
create policy "proposal_invitations_select_related_or_admin"
on public.proposal_invitations
for select
using (
  public.is_admin()
  or invitee_user_id = auth.uid()
  or inviter_user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_invitations.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_invitations_insert_owner_or_admin" on public.proposal_invitations;
create policy "proposal_invitations_insert_owner_or_admin"
on public.proposal_invitations
for insert
with check (
  public.is_admin()
  or inviter_user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_invitations.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_invitations_update_related_or_admin" on public.proposal_invitations;
create policy "proposal_invitations_update_related_or_admin"
on public.proposal_invitations
for update
using (
  public.is_admin()
  or invitee_user_id = auth.uid()
  or inviter_user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_invitations.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or invitee_user_id = auth.uid()
  or inviter_user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_invitations.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'proposal_submitted',
      'proposal_status_changed',
      'proposal_comment_added',
      'proposal_resubmitted',
      'proposal_collaborator_added',
      'proposal_invitation_received',
      'chat_message'
    )
  );
