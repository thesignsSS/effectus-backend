alter table public.engineering_requests
  add column if not exists comments jsonb not null default '[]'::jsonb;
