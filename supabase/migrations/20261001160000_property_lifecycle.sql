-- Excluir, inativar e transferir imóvel (spec BKL-093, seção 15) e o vínculo
-- de propostas e engenharias com o imóvel (seções 13 e 14). Migration aditiva.

-- 1) Quem cadastrou pode deixar a empresa: o imóvel fica, sem o autor.
--    (Antes era restrict, o que travaria a exclusão de qualquer usuário que
--    tivesse cadastrado um imóvel.)
alter table public.properties alter column created_by drop not null;
alter table public.properties drop constraint if exists properties_created_by_fkey;
alter table public.properties
  add constraint properties_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

-- 2) Proposta e engenharia passam a poder apontar para o imóvel (0 ou 1).
--    Propostas e engenharias antigas continuam sem imóvel (seção 1, item 5).
alter table public.proposals
  add column if not exists property_id uuid references public.properties (id) on delete restrict;
alter table public.engineering_requests
  add column if not exists property_id uuid references public.properties (id) on delete restrict;

create index if not exists proposals_property_idx on public.proposals (property_id) where property_id is not null;
create index if not exists engineering_requests_property_idx
  on public.engineering_requests (property_id) where property_id is not null;

-- 3) Excluir só sem histórico (15.1), checando na mesma operação da exclusão:
--    um único DELETE com a condição, sem janela entre checar e apagar.
--    Campanha ([FUTURO], módulo de Anúncios) entra aqui quando existir.
create or replace function public.delete_property_if_unused(p_company_id uuid, p_property_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted uuid;
begin
  if not exists (
    select 1 from public.properties where id = p_property_id and company_id = p_company_id
  ) then
    return 'not_found';
  end if;

  delete from public.properties p
  where p.id = p_property_id
    and p.company_id = p_company_id
    and not exists (select 1 from public.proposals where property_id = p.id)
    and not exists (select 1 from public.engineering_requests where property_id = p.id)
  returning p.id into deleted;

  return case when deleted is null then 'has_history' else 'deleted' end;
end;
$$;

revoke all on function public.delete_property_if_unused(uuid, uuid) from public, anon, authenticated;
