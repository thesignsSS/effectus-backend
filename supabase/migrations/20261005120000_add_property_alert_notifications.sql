-- BKL-093, seção 13: avisos do imóvel (vendido por outra proposta; finalizada com imóvel inativo).
-- Recria a lista completa de tipos. Inclui 'proposal_invitation_received', que a
-- migration de compartilhamento (mesma data da de convites) acabou removendo no dev.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'proposal_submitted',
      'proposal_status_changed',
      'proposal_comment_added',
      'proposal_resubmitted',
      'proposal_collaborator_added',
      'proposal_invitation_received',
      'chat_message',
      'property_alert'
    )
  );
