export type NotificationType =
  | 'proposal_submitted'
  | 'proposal_status_changed'
  | 'proposal_comment_added'
  | 'proposal_resubmitted'
  | 'proposal_collaborator_added'
  | 'proposal_invitation_received'
  | 'chat_message';

export interface NotificationItem {
  id: string;
  userId: string;
  proposalId: string | null;
  conversationId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface CreateNotificationInput {
  userId: string;
  proposalId?: string;
  conversationId?: string;
  type: NotificationType;
  title: string;
  message: string;
}

export interface NotificationStore {
  createMany(input: CreateNotificationInput[]): Promise<NotificationItem[]>;
  listByUser(userId: string): Promise<NotificationItem[]>;
  markAsRead(userId: string, notificationId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  listUserIdsByRole(role: 'admin' | 'broker'): Promise<string[]>;
}
