import {
  CreateNotificationInput,
  NotificationItem,
  NotificationStore,
} from '../domain/interfaces/notification-store.interface.js';
import { ProposalStatus } from '../domain/interfaces/proposal-store.interface.js';

const STATUS_LABELS: Record<ProposalStatus, string> = {
  em_analise: 'Em análise',
  pendente: 'Pendente',
  condicionado: 'Condicionado',
  reprovado: 'Reprovado',
  aprovado: 'Aprovado',
  validacao_renda: 'Validação de Renda',
  renda_validada: 'Renda Validada',
  renda_nao_validada: 'Renda Não Validada',
  engenharia: 'Engenharia',
  formularios: 'Formulários',
  conformidade: 'Conformidade',
};

export class NotificationService {
  constructor(private readonly store: NotificationStore) {}

  async notifyAdminsAboutSubmittedProposal(input: {
    proposalId: string;
    proposalCode: string;
    brokerName: string;
  }): Promise<NotificationItem[]> {
    const adminIds = await this.store.listUserIdsByRole('admin');

    return this.store.createMany(
      adminIds.map((userId) => ({
        userId,
        proposalId: input.proposalId,
        type: 'proposal_submitted',
        title: 'Nova proposta para análise',
        message: `A proposta ${input.proposalCode} foi enviada por ${input.brokerName} e está em análise.`,
      })),
    );
  }

  async notifyBrokerAboutStatusChanged(input: {
    proposalId: string;
    proposalCode: string;
    brokerUserId: string;
    nextStatus: ProposalStatus;
  }): Promise<NotificationItem[]> {
    return this.store.createMany([
      {
        userId: input.brokerUserId,
        proposalId: input.proposalId,
        type: 'proposal_status_changed',
        title: 'Status da proposta atualizado',
        message: `A proposta ${input.proposalCode} mudou para ${STATUS_LABELS[input.nextStatus]}.`,
      },
    ]);
  }

  async notifyAdminsAboutComment(input: {
    proposalId: string;
    proposalCode: string;
    authorName: string;
    excludeUserId?: string;
  }): Promise<NotificationItem[]> {
    return this.notifyAdmins({
      proposalId: input.proposalId,
      proposalCode: input.proposalCode,
      title: 'Novo comentário em proposta',
      message: `${input.authorName} registrou um comentário na proposta ${input.proposalCode}.`,
      type: 'proposal_comment_added',
      excludeUserId: input.excludeUserId,
    });
  }

  async notifyAdminsAboutResubmission(input: {
    proposalId: string;
    proposalCode: string;
    brokerName: string;
    excludeUserId?: string;
  }): Promise<NotificationItem[]> {
    return this.notifyAdmins({
      proposalId: input.proposalId,
      proposalCode: input.proposalCode,
      title: 'Proposta reenviada para análise',
      message: `${input.brokerName} reenviou a proposta ${input.proposalCode} para análise.`,
      type: 'proposal_resubmitted',
      excludeUserId: input.excludeUserId,
    });
  }

  async notifyUserAboutChatMessage(input: {
    userId: string;
    conversationId: string;
    senderName: string;
    messagePreview: string;
  }): Promise<NotificationItem | null> {
    const notifications = await this.store.createMany([
      {
        userId: input.userId,
        conversationId: input.conversationId,
        type: 'chat_message',
        title: 'Nova mensagem no chat',
        message: `${input.senderName}: ${truncateMessage(input.messagePreview)}`,
      },
    ]);

    return notifications[0] ?? null;
  }

  async notifyProposalOwnerAboutNewCollaborator(input: {
    ownerUserId: string;
    proposalId: string;
    proposalCode: string;
    guestName: string;
  }): Promise<NotificationItem | null> {
    const notifications = await this.store.createMany([
      {
        userId: input.ownerUserId,
        proposalId: input.proposalId,
        type: 'proposal_collaborator_added',
        title: 'Novo convidado na proposta',
        message: `${input.guestName} agora está vinculado à proposta ${input.proposalCode}.`,
      },
    ]);

    return notifications[0] ?? null;
  }

  async notifyUserAboutProposalInvitation(input: {
    userId: string;
    proposalId: string;
    proposalCode: string;
    inviterName: string;
  }): Promise<NotificationItem | null> {
    const notifications = await this.store.createMany([
      {
        userId: input.userId,
        proposalId: input.proposalId,
        type: 'proposal_invitation_received',
        title: 'Novo convite de proposta',
        message: `${input.inviterName} convidou você para a proposta ${input.proposalCode}.`,
      },
    ]);

    return notifications[0] ?? null;
  }

  async listByUser(userId: string) {
    return this.store.listByUser(userId);
  }

  async markAsRead(userId: string, notificationId: string) {
    await this.store.markAsRead(userId, notificationId);
  }

  async markAllAsRead(userId: string) {
    await this.store.markAllAsRead(userId);
  }

  private async notifyAdmins(input: {
    proposalId: string;
    proposalCode: string;
    title: string;
    message: string;
    type: CreateNotificationInput['type'];
    excludeUserId?: string;
  }): Promise<NotificationItem[]> {
    const adminIds = await this.store.listUserIdsByRole('admin');
    const recipients = adminIds.filter((userId) => userId !== input.excludeUserId);

    return this.store.createMany(
      recipients.map((userId) => ({
        userId,
        proposalId: input.proposalId,
        type: input.type,
        title: input.title,
        message: input.message,
      })),
    );
  }
}

function truncateMessage(message: string) {
  const normalized = message.trim();

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}
