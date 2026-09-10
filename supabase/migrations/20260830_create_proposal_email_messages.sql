create table if not exists public.proposal_email_messages (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  broker_user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null unique,
  recipient text not null,
  subject text not null,
  sent_at timestamptz not null default timezone('utc', now()),
  replied_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists proposal_email_messages_proposal_id_idx
  on public.proposal_email_messages (proposal_id);
