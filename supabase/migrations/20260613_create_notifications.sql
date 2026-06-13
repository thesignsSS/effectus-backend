create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  proposal_id uuid references public.proposals (id) on delete cascade,
  type text not null check (
    type in (
      'proposal_submitted',
      'proposal_status_changed',
      'proposal_comment_added',
      'proposal_resubmitted'
    )
  ),
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
create policy "notifications_select_own_or_admin"
on public.notifications
for select
using (
  user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "notifications_update_own_or_admin" on public.notifications;
create policy "notifications_update_own_or_admin"
on public.notifications
for update
using (
  user_id = auth.uid()
  or public.is_admin()
)
with check (
  user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "notifications_insert_service_role" on public.notifications;
create policy "notifications_insert_service_role"
on public.notifications
for insert
with check (true);
