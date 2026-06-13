import { UserRole } from './profile-store.interface.js';

export interface ChatDirectoryUser {
  id: string;
  fullName: string;
  role: UserRole;
  isAdmin: boolean;
}

export interface ChatConversationSummary {
  id: string;
  counterpart: ChatDirectoryUser;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
}

export interface ChatMessageItem {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface CreateChatMessageResult {
  conversation: ChatConversationSummary;
  message: ChatMessageItem;
  recipient: ChatDirectoryUser;
  sender: ChatDirectoryUser;
}

export interface ChatStore {
  listDirectoryUsers(excludeUserId: string): Promise<ChatDirectoryUser[]>;
  listConversations(userId: string): Promise<ChatConversationSummary[]>;
  getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ChatConversationSummary | null>;
  getOrCreateDirectConversation(
    userId: string,
    otherUserId: string,
  ): Promise<ChatConversationSummary>;
  listMessages(userId: string, conversationId: string): Promise<ChatMessageItem[]>;
  createMessage(input: {
    senderUserId: string;
    recipientUserId: string;
    content: string;
  }): Promise<CreateChatMessageResult>;
  markConversationAsRead(userId: string, conversationId: string): Promise<void>;
}
