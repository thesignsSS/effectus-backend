create table if not exists public.proposal_share_links (
  proposal_id uuid primary key references public.proposals (id) on delete cascade,
  token text not null unique,
  created_by_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz
);

create index if not exists proposal_share_links_token_idx
  on public.proposal_share_links (token);

drop trigger if exists set_proposal_share_links_updated_at on public.proposal_share_links;

create trigger set_proposal_share_links_updated_at
before update on public.proposal_share_links
for each row
execute function public.set_updated_at();

alter table public.proposal_share_links enable row level security;

drop policy if exists "proposal_share_links_select_owner_or_admin" on public.proposal_share_links;
create policy "proposal_share_links_select_owner_or_admin"
on public.proposal_share_links
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_share_links.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_share_links_insert_owner_or_admin" on public.proposal_share_links;
create policy "proposal_share_links_insert_owner_or_admin"
on public.proposal_share_links
for insert
with check (
  public.is_admin()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_share_links.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_share_links_update_owner_or_admin" on public.proposal_share_links;
create policy "proposal_share_links_update_owner_or_admin"
on public.proposal_share_links
for update
using (
  public.is_admin()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_share_links.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_share_links.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

create table if not exists public.proposal_collaborators (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (proposal_id, user_id)
);

create index if not exists proposal_collaborators_user_id_idx
  on public.proposal_collaborators (user_id);

alter table public.proposal_collaborators enable row level security;

drop policy if exists "proposal_collaborators_select_related_or_admin" on public.proposal_collaborators;
create policy "proposal_collaborators_select_related_or_admin"
on public.proposal_collaborators
for select
using (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_collaborators.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_collaborators_insert_owner_or_admin" on public.proposal_collaborators;
create policy "proposal_collaborators_insert_owner_or_admin"
on public.proposal_collaborators
for insert
with check (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_collaborators.proposal_id
      and proposals.broker_user_id = auth.uid()
  )
);

drop policy if exists "proposal_collaborators_delete_owner_or_admin" on public.proposal_collaborators;
create policy "proposal_collaborators_delete_owner_or_admin"
on public.proposal_collaborators
for delete
using (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.proposals
    where proposals.id = proposal_collaborators.proposal_id
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
      'chat_message'
    )
  );
