alter table public.broker_clients
  add column if not exists broker_name text,
  add column if not exists client_cpf text,
  add column if not exists client_email text,
  add column if not exists client_phone text,
  add column if not exists form_data jsonb not null default '{}'::jsonb;
