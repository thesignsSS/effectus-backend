create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  direct_user_a uuid not null references public.profiles (id) on delete cascade,
  direct_user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint chat_conversations_distinct_users check (direct_user_a <> direct_user_b),
  constraint chat_conversations_unique_pair unique (direct_user_a, direct_user_b)
);

drop trigger if exists set_chat_conversations_updated_at on public.chat_conversations;

create trigger set_chat_conversations_updated_at
before update on public.chat_conversations
for each row
execute function public.set_updated_at();

create table if not exists public.chat_conversation_participants (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default timezone('utc', now()),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  sender_user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists chat_conversation_participants_user_id_idx
  on public.chat_conversation_participants (user_id);

create index if not exists chat_messages_conversation_id_created_at_idx
  on public.chat_messages (conversation_id, created_at desc);

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_participants enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_conversations_select_participant_or_admin" on public.chat_conversations;
create policy "chat_conversations_select_participant_or_admin"
on public.chat_conversations
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.chat_conversation_participants
    where chat_conversation_participants.conversation_id = chat_conversations.id
      and chat_conversation_participants.user_id = auth.uid()
  )
);

drop policy if exists "chat_conversations_insert_participant_or_admin" on public.chat_conversations;
create policy "chat_conversations_insert_participant_or_admin"
on public.chat_conversations
for insert
to authenticated
with check (
  public.is_admin()
  or auth.uid() in (direct_user_a, direct_user_b)
);

drop policy if exists "chat_conversations_update_participant_or_admin" on public.chat_conversations;
create policy "chat_conversations_update_participant_or_admin"
on public.chat_conversations
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.chat_conversation_participants
    where chat_conversation_participants.conversation_id = chat_conversations.id
      and chat_conversation_participants.user_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.chat_conversation_participants
    where chat_conversation_participants.conversation_id = chat_conversations.id
      and chat_conversation_participants.user_id = auth.uid()
  )
);

drop policy if exists "chat_participants_select_own_or_admin" on public.chat_conversation_participants;
create policy "chat_participants_select_own_or_admin"
on public.chat_conversation_participants
for select
to authenticated
using (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.chat_conversation_participants as participant
    where participant.conversation_id = chat_conversation_participants.conversation_id
      and participant.user_id = auth.uid()
  )
);

drop policy if exists "chat_participants_insert_own_or_admin" on public.chat_conversation_participants;
create policy "chat_participants_insert_own_or_admin"
on public.chat_conversation_participants
for insert
to authenticated
with check (
  public.is_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.chat_conversations
    where chat_conversations.id = conversation_id
      and auth.uid() in (chat_conversations.direct_user_a, chat_conversations.direct_user_b)
  )
);

drop policy if exists "chat_participants_update_own_or_admin" on public.chat_conversation_participants;
create policy "chat_participants_update_own_or_admin"
on public.chat_conversation_participants
for update
to authenticated
using (
  public.is_admin()
  or user_id = auth.uid()
)
with check (
  public.is_admin()
  or user_id = auth.uid()
);

drop policy if exists "chat_messages_select_participant_or_admin" on public.chat_messages;
create policy "chat_messages_select_participant_or_admin"
on public.chat_messages
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.chat_conversation_participants
    where chat_conversation_participants.conversation_id = chat_messages.conversation_id
      and chat_conversation_participants.user_id = auth.uid()
  )
);

drop policy if exists "chat_messages_insert_participant_or_admin" on public.chat_messages;
create policy "chat_messages_insert_participant_or_admin"
on public.chat_messages
for insert
to authenticated
with check (
  public.is_admin()
  or sender_user_id = auth.uid()
);

alter table public.notifications
  add column if not exists conversation_id uuid references public.chat_conversations (id) on delete cascade;

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
      'chat_message'
    )
  );

create index if not exists notifications_user_id_read_at_created_at_idx
  on public.notifications (user_id, read_at, created_at desc);
