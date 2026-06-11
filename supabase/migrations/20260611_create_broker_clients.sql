create extension if not exists pgcrypto;

create table if not exists public.broker_clients (
  id uuid primary key default gen_random_uuid(),
  broker_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  broker_name text,
  client_name text not null,
  client_name_normalized text generated always as (lower(btrim(client_name))) stored,
  client_cpf text,
  client_email text,
  client_phone text,
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint broker_clients_client_name_not_blank
    check (char_length(btrim(client_name)) > 0)
);

create unique index if not exists broker_clients_broker_user_id_client_name_key
  on public.broker_clients (broker_user_id, client_name_normalized);

create index if not exists broker_clients_broker_user_id_idx
  on public.broker_clients (broker_user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_broker_clients_updated_at on public.broker_clients;

create trigger set_broker_clients_updated_at
before update on public.broker_clients
for each row
execute function public.set_updated_at();

alter table public.broker_clients enable row level security;

drop policy if exists "broker_clients_select_own" on public.broker_clients;
create policy "broker_clients_select_own"
on public.broker_clients
for select
to authenticated
using (broker_user_id = auth.uid());

drop policy if exists "broker_clients_insert_own" on public.broker_clients;
create policy "broker_clients_insert_own"
on public.broker_clients
for insert
to authenticated
with check (broker_user_id = auth.uid());

drop policy if exists "broker_clients_update_own" on public.broker_clients;
create policy "broker_clients_update_own"
on public.broker_clients
for update
to authenticated
using (broker_user_id = auth.uid())
with check (broker_user_id = auth.uid());

drop policy if exists "broker_clients_delete_own" on public.broker_clients;
create policy "broker_clients_delete_own"
on public.broker_clients
for delete
to authenticated
using (broker_user_id = auth.uid());
