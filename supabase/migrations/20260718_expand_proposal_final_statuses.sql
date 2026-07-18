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
      'validacao_renda',
      'renda_validada',
      'renda_nao_validada',
      'engenharia',
      'formularios',
      'aguardando_reserva',
      'conformidade',
      'agendamento_agencia',
      'itbi',
      'assinatura_contrato',
      'registro',
      'finalizado'
    )
  );
