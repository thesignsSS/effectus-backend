alter table public.proposals
  add column if not exists status text not null default 'em_analise';

alter table public.proposals
  drop constraint if exists proposals_status_check;

update public.proposals
set status = case status
  when 'in_progress' then 'em_analise'
  when 'approved' then 'aprovado'
  when 'rejected' then 'reprovado'
  when 'em_analise' then 'em_analise'
  when 'pendente' then 'pendente'
  when 'condicionado' then 'condicionado'
  when 'reprovado' then 'reprovado'
  when 'aprovado' then 'aprovado'
  else 'em_analise'
end;

alter table public.proposals
  alter column status set default 'em_analise';

alter table public.proposals
  add constraint proposals_status_check
  check (status in ('em_analise', 'pendente', 'condicionado', 'reprovado', 'aprovado'));

create index if not exists proposals_status_idx
  on public.proposals (status);
