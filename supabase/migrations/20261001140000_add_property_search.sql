-- Busca da lista de imóveis (spec BKL-093, 9.5): um campo para endereço,
-- bairro, código de referência e matrícula, sem diferenciar maiúsculas,
-- minúsculas e acentos. Mesmo padrão de 20260718120000_add_normalized_proposal_search.

create extension if not exists unaccent with schema extensions;

alter table public.properties
  add column if not exists search_text text not null default '';

create or replace function public.sync_property_search_text()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_text := lower(unaccent(concat_ws(' ',
    new.street,
    new.street_number,
    new.complement,
    new.neighborhood,
    new.municipality,
    new.reference_code,
    new.registration_number,
    new.development_name
  )));
  return new;
end;
$$;

drop trigger if exists properties_sync_search_text on public.properties;

create trigger properties_sync_search_text
before insert or update of street, street_number, complement, neighborhood, municipality,
  reference_code, registration_number, development_name
on public.properties
for each row
execute function public.sync_property_search_text();

-- Preenche os imóveis que já existirem antes desta migration.
update public.properties set street = street where search_text = '';

create index if not exists properties_company_search_idx
  on public.properties (company_id, search_text);
