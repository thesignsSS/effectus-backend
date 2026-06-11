create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'broker' check (role in ('broker', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_profiles_updated_at on public.profiles;

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = user_id
      and profiles.role = 'admin'
  );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin()
);

drop policy if exists "profiles_insert_own_or_admin" on public.profiles;
create policy "profiles_insert_own_or_admin"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  or public.is_admin()
);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.is_admin()
)
with check (
  id = auth.uid()
  or public.is_admin()
);

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
on public.profiles
for delete
to authenticated
using (public.is_admin());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

drop policy if exists "broker_clients_select_own" on public.broker_clients;
create policy "broker_clients_select_own_or_admin"
on public.broker_clients
for select
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "broker_clients_insert_own" on public.broker_clients;
create policy "broker_clients_insert_own_or_admin"
on public.broker_clients
for insert
to authenticated
with check (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "broker_clients_update_own" on public.broker_clients;
create policy "broker_clients_update_own_or_admin"
on public.broker_clients
for update
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
)
with check (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "broker_clients_delete_own" on public.broker_clients;
create policy "broker_clients_delete_own_or_admin"
on public.broker_clients
for delete
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "proposals_select_own" on public.proposals;
create policy "proposals_select_own_or_admin"
on public.proposals
for select
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "proposals_insert_own" on public.proposals;
create policy "proposals_insert_own_or_admin"
on public.proposals
for insert
to authenticated
with check (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "proposals_update_own" on public.proposals;
create policy "proposals_update_own_or_admin"
on public.proposals
for update
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
)
with check (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "proposals_delete_own" on public.proposals;
create policy "proposals_delete_own_or_admin"
on public.proposals
for delete
to authenticated
using (
  broker_user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "proposal_documents_select_own" on public.proposal_documents;
create policy "proposal_documents_select_own_or_admin"
on public.proposal_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_documents.proposal_id
      and (
        proposals.broker_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "proposal_documents_insert_own" on public.proposal_documents;
create policy "proposal_documents_insert_own_or_admin"
on public.proposal_documents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_documents.proposal_id
      and (
        proposals.broker_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "proposal_documents_delete_own" on public.proposal_documents;
create policy "proposal_documents_delete_own_or_admin"
on public.proposal_documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_documents.proposal_id
      and (
        proposals.broker_user_id = auth.uid()
        or public.is_admin()
      )
  )
);

drop policy if exists "proposal_documents_update_own" on public.proposal_documents;
create policy "proposal_documents_update_own_or_admin"
on public.proposal_documents
for update
to authenticated
using (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_documents.proposal_id
      and (
        proposals.broker_user_id = auth.uid()
        or public.is_admin()
      )
  )
)
with check (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_documents.proposal_id
      and (
        proposals.broker_user_id = auth.uid()
        or public.is_admin()
      )
  )
);
