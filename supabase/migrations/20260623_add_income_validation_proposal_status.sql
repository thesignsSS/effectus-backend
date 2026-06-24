alter table public.proposals
  drop constraint if exists proposals_status_check;

alter table public.proposals
  add constraint proposals_status_check
  check (
    status in (
      'em_analise',
      'pendente',
      'condicionado',
      'reprovado',
      'aprovado',
      'validacao_renda'
    )
  );
