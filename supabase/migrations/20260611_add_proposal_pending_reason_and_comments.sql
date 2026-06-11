alter table public.proposals
  add column if not exists pending_reason text,
  add column if not exists proposal_comments jsonb not null default '[]'::jsonb;
