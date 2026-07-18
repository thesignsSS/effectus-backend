create extension if not exists unaccent with schema extensions;

alter table public.proposals
  add column if not exists client_name_search text not null default '',
  add column if not exists broker_name_search text not null default '';

update public.proposals
set
  client_name_search = lower(extensions.unaccent(coalesce(client_name, ''))),
  broker_name_search = lower(extensions.unaccent(coalesce(broker_name, '')));

create or replace function public.sync_proposal_search_columns()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.client_name_search := lower(unaccent(coalesce(new.client_name, '')));
  new.broker_name_search := lower(unaccent(coalesce(new.broker_name, '')));
  return new;
end;
$$;

drop trigger if exists proposals_sync_search_columns on public.proposals;

create trigger proposals_sync_search_columns
before insert or update of client_name, broker_name
on public.proposals
for each row
execute function public.sync_proposal_search_columns();
