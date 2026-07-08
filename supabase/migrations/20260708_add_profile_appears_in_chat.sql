alter table public.profiles
  add column if not exists appears_in_chat boolean not null default true;
