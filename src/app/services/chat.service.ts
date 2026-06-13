import {
  ChatConversationSummary,
  ChatDirectoryUser,
  ChatMessageItem,
  ChatStore,
} from '../domain/interfaces/chat-store.interface.js';
import { NotificationItem } from '../domain/interfaces/notification-store.interface.js';
import { NotificationService } from './notification.service.js';

export interface SendChatMessageResult {
  conversation: ChatConversationSummary;
  message: ChatMessageItem;
  sender: ChatDirectoryUser;
  recipient: ChatDirectoryUser;
  notification: NotificationItem | null;
}

export class ChatService {
  constructor(
    private readonly store: ChatStore,
    private readonly notificationService: NotificationService,
  ) {}

  async listDirectoryUsers(userId: string) {
    return this.store.listDirectoryUsers(userId);
  }

  async listConversations(userId: string) {
    return this.store.listConversations(userId);
  }

  async getConversationById(userId: string, conversationId: string) {
    return this.store.getConversationById(userId, conversationId);
  }

  async openDirectConversation(userId: string, otherUserId: string) {
    return this.store.getOrCreateDirectConversation(userId, otherUserId);
  }

  async listMessages(userId: string, conversationId: string) {
    return this.store.listMessages(userId, conversationId);
  }

  async sendMessage(input: {
    senderUserId: string;
    recipientUserId: string;
    content: string;
  }): Promise<SendChatMessageResult> {
    const result = await this.store.createMessage(input);
    const notification = await this.notificationService.notifyUserAboutChatMessage({
      userId: result.recipient.id,
      conversationId: result.conversation.id,
      senderName: result.sender.fullName,
      messagePreview: result.message.content,
    });

    return {
      conversation: result.conversation,
      message: result.message,
      sender: result.sender,
      recipient: result.recipient,
      notification,
    };
  }

  async markConversationAsRead(userId: string, conversationId: string) {
    await this.store.markConversationAsRead(userId, conversationId);
  }
}
