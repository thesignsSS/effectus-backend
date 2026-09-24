import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ChatConversationSummary,
  ChatDirectoryUser,
  ChatMessageItem,
  ChatStore,
  CreateChatMessageResult,
} from '../../domain/interfaces/chat-store.interface.js';
import { UserRole } from '../../domain/interfaces/profile-store.interface.js';
import { resolveCompanyIdForUser } from './company-scope.js';

export interface SupabaseChatStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string;
  appears_in_chat: boolean | null;
};

type ConversationRow = {
  id: string;
  direct_user_a: string;
  direct_user_b: string;
  created_at: string;
  updated_at: string;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  chat_conversations?: ConversationRow | ConversationRow[] | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  content: string;
  created_at: string;
};

export class SupabaseChatStore implements ChatStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseChatStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to manage chat',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async listDirectoryUsers(excludeUserId: string): Promise<ChatDirectoryUser[]> {
    const requester = await this.getDirectoryUserById(excludeUserId);

    if (!requester) {
      throw new Error('Usuário do chat não encontrado.');
    }

    const companyId = await resolveCompanyIdForUser(this.client, excludeUserId);

    let query = this.client
      .from('profiles')
      .select('id, full_name, role, appears_in_chat')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .neq('id', excludeUserId)
      .eq('appears_in_chat', true)
      .order('full_name', { ascending: true });

    if (!requester.isAdmin) {
      query = query.eq('role', 'admin');
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Supabase chat users list failed: ${error.message}`);
    }

    return this.toDirectoryUsers((data as ProfileRow[] | null) ?? []);
  }

  async listConversations(userId: string): Promise<ChatConversationSummary[]> {
    return this.loadConversationSummaries(userId);
  }

  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ChatConversationSummary | null> {
    const conversations = await this.loadConversationSummaries(userId, [conversationId]);
    return conversations[0] ?? null;
  }

  async getOrCreateDirectConversation(
    userId: string,
    otherUserId: string,
  ): Promise<ChatConversationSummary> {
    await this.assertUsersCanInteract(userId, otherUserId);

    const companyId = await resolveCompanyIdForUser(this.client, userId);
    const conversation = await this.upsertDirectConversation(userId, otherUserId, companyId);
    const profiles = await this.getProfilesByIds([userId, otherUserId]);
    const counterpart = profiles.get(otherUserId);

    if (!counterpart) {
      throw new Error('Usuário do chat não encontrado.');
    }

    return {
      id: conversation.id,
      counterpart,
      lastMessage: null,
      lastMessageAt: null,
      lastMessageSenderId: null,
      unreadCount: 0,
    };
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessageItem[]> {
    const participant = await this.requireParticipant(userId, conversationId);

    if (!participant) {
      throw new Error('Conversa não encontrada.');
    }

    const conversation = await this.getConversationById(userId, conversationId);

    if (!conversation) {
      throw new Error('Conversa não encontrada.');
    }

    const { data, error } = await this.client
      .from('chat_messages')
      .select('id, conversation_id, sender_user_id, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Supabase chat messages list failed: ${error.message}`);
    }

    const rows = (data as MessageRow[] | null) ?? [];
    const senderIds = [...new Set(rows.map((item) => item.sender_user_id))];
    const profiles = await this.getProfilesByIds(senderIds);

    return rows.map((item) => ({
      id: item.id,
      conversationId: item.conversation_id,
      senderUserId: item.sender_user_id,
      senderName: profiles.get(item.sender_user_id)?.fullName || 'Usuário',
      content: item.content,
      createdAt: item.created_at,
    }));
  }

  async createMessage(input: {
    senderUserId: string;
    recipientUserId: string;
    content: string;
  }): Promise<CreateChatMessageResult> {
    const content = input.content.trim();

    if (!content) {
      throw new Error('A mensagem não pode estar vazia.');
    }

    await this.assertUsersCanInteract(input.senderUserId, input.recipientUserId);

    const companyId = await resolveCompanyIdForUser(this.client, input.senderUserId);
    const conversation = await this.upsertDirectConversation(
      input.senderUserId,
      input.recipientUserId,
      companyId,
    );
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from('chat_messages')
      .insert({
        conversation_id: conversation.id,
        company_id: companyId,
        sender_user_id: input.senderUserId,
        content,
      })
      .select('id, conversation_id, sender_user_id, content, created_at')
      .single();

    if (error || !data) {
      throw new Error(
        `Supabase chat message create failed: ${error?.message ?? 'unknown error'}`,
      );
    }

    const { error: conversationError } = await this.client
      .from('chat_conversations')
      .update({ updated_at: now })
      .eq('id', conversation.id);

    if (conversationError) {
      throw new Error(
        `Supabase chat conversation update failed: ${conversationError.message}`,
      );
    }

    const { error: participantError } = await this.client
      .from('chat_conversation_participants')
      .upsert(
        [
          {
            conversation_id: conversation.id,
            company_id: companyId,
            user_id: input.senderUserId,
            last_read_at: now,
          },
          {
            conversation_id: conversation.id,
            company_id: companyId,
            user_id: input.recipientUserId,
          },
        ],
        { onConflict: 'conversation_id,user_id' },
      );

    if (participantError) {
      throw new Error(
        `Supabase chat participants upsert failed: ${participantError.message}`,
      );
    }

    const profiles = await this.getProfilesByIds([
      input.senderUserId,
      input.recipientUserId,
    ]);
    const sender = profiles.get(input.senderUserId);
    const recipient = profiles.get(input.recipientUserId);

    if (!sender || !recipient) {
      throw new Error('Participantes da conversa não encontrados.');
    }

    return {
      conversation: {
        id: conversation.id,
        counterpart: recipient,
        lastMessage: data.content,
        lastMessageAt: data.created_at,
        lastMessageSenderId: data.sender_user_id,
        unreadCount: 0,
      },
      message: {
        id: data.id,
        conversationId: data.conversation_id,
        senderUserId: data.sender_user_id,
        senderName: sender.fullName,
        content: data.content,
        createdAt: data.created_at,
      },
      recipient,
      sender,
    };
  }

  async markConversationAsRead(userId: string, conversationId: string): Promise<void> {
    const participant = await this.requireParticipant(userId, conversationId);

    if (!participant) {
      throw new Error('Conversa não encontrada.');
    }

    const { error } = await this.client
      .from('chat_conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Supabase chat read update failed: ${error.message}`);
    }
  }

  private async loadConversationSummaries(
    userId: string,
    onlyConversationIds?: string[],
  ): Promise<ChatConversationSummary[]> {
    const requester = await this.getDirectoryUserById(userId);

    if (!requester) {
      throw new Error('Usuário do chat não encontrado.');
    }

    if (requester.appearsInChat === false) {
      return [];
    }

    let query = this.client
      .from('chat_conversation_participants')
      .select(
        'conversation_id, user_id, last_read_at, chat_conversations!inner(id, direct_user_a, direct_user_b, created_at, updated_at)',
      )
      .eq('user_id', userId);

    if (onlyConversationIds && onlyConversationIds.length > 0) {
      query = query.in('conversation_id', onlyConversationIds);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Supabase chat conversations list failed: ${error.message}`);
    }

    const participantRows = ((data as ParticipantRow[] | null) ?? []).map((item) => ({
      ...item,
      chat_conversations: Array.isArray(item.chat_conversations)
        ? item.chat_conversations[0] ?? null
        : item.chat_conversations ?? null,
    }));

    if (participantRows.length === 0) {
      return [];
    }

    const conversations = participantRows
      .map((item) => item.chat_conversations)
      .filter((item): item is ConversationRow => Boolean(item));
    const conversationIds = conversations.map((item) => item.id);
    const otherUserIds = conversations.map((item) =>
      item.direct_user_a === userId ? item.direct_user_b : item.direct_user_a,
    );
    const profiles = await this.getProfilesByIds(otherUserIds);
    const messages = await this.getMessagesByConversationIds(conversationIds);

    const summaries = participantRows
      .map((participant): ChatConversationSummary | null => {
        const conversation = participant.chat_conversations;

        if (!conversation) {
          return null;
        }

        const counterpartId =
          conversation.direct_user_a === userId
            ? conversation.direct_user_b
            : conversation.direct_user_a;
        const counterpart = profiles.get(counterpartId);

        if (!counterpart || !this.canUsersInteract(requester, counterpart)) {
          return null;
        }

        const conversationMessages = messages.filter(
          (item) => item.conversation_id === conversation.id,
        );
        const latestMessage = conversationMessages[0] ?? null;
        const unreadCount = conversationMessages.filter((item) => {
          if (item.sender_user_id === userId) {
            return false;
          }

          if (!participant.last_read_at) {
            return true;
          }

          return item.created_at > participant.last_read_at;
        }).length;

        return {
          id: conversation.id,
          counterpart,
          lastMessage: latestMessage?.content ?? null,
          lastMessageAt: latestMessage?.created_at ?? null,
          lastMessageSenderId: latestMessage?.sender_user_id ?? null,
          unreadCount,
        };
      })
      .filter((item): item is ChatConversationSummary => item !== null);

    return summaries.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  private async getDirectoryUserById(userId: string): Promise<ChatDirectoryUser | null> {
    const profiles = await this.getProfilesByIds([userId]);
    return profiles.get(userId) ?? null;
  }

  private async assertUsersCanInteract(userId: string, otherUserId: string): Promise<void> {
    const profiles = await this.getProfilesByIds([userId, otherUserId]);
    const user = profiles.get(userId);
    const otherUser = profiles.get(otherUserId);

    if (!user || !otherUser) {
      throw new Error('Usuário do chat não encontrado.');
    }

    if (!this.canUsersInteract(user, otherUser)) {
      throw new Error('Você não tem permissão para conversar com este usuário.');
    }
  }

  private canUsersInteract(user: ChatDirectoryUser, otherUser: ChatDirectoryUser): boolean {
    return (
      user.appearsInChat !== false &&
      otherUser.appearsInChat !== false &&
      (user.isAdmin || otherUser.isAdmin)
    );
  }

  private async getProfilesByIds(userIds: string[]): Promise<Map<string, ChatDirectoryUser>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, role, appears_in_chat')
      .in('id', uniqueIds);

    if (error) {
      throw new Error(`Supabase chat profiles fetch failed: ${error.message}`);
    }

    return new Map(
      this.toDirectoryUsers((data as ProfileRow[] | null) ?? []).map((item) => [
        item.id,
        item,
      ]),
    );
  }

  private async getMessagesByConversationIds(
    conversationIds: string[],
  ): Promise<MessageRow[]> {
    if (conversationIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('chat_messages')
      .select('id, conversation_id, sender_user_id, content, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Supabase chat messages fetch failed: ${error.message}`);
    }

    return (data as MessageRow[] | null) ?? [];
  }

  private async upsertDirectConversation(
    userId: string,
    otherUserId: string,
    companyId: string,
  ) {
    const [directUserA, directUserB] = [userId, otherUserId].sort((a, b) =>
      a.localeCompare(b),
    );

    const { data, error } = await this.client
      .from('chat_conversations')
      .upsert(
        {
          direct_user_a: directUserA,
          direct_user_b: directUserB,
          company_id: companyId,
        },
        { onConflict: 'direct_user_a,direct_user_b' },
      )
      .select('id, direct_user_a, direct_user_b, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(
        `Supabase chat conversation upsert failed: ${error?.message ?? 'unknown error'}`,
      );
    }

    const { error: participantError } = await this.client
      .from('chat_conversation_participants')
      .upsert(
        [
          { conversation_id: data.id, company_id: companyId, user_id: directUserA },
          { conversation_id: data.id, company_id: companyId, user_id: directUserB },
        ],
        { onConflict: 'conversation_id,user_id' },
      );

    if (participantError) {
      throw new Error(
        `Supabase chat conversation participants upsert failed: ${participantError.message}`,
      );
    }

    return data as ConversationRow;
  }

  private async requireParticipant(userId: string, conversationId: string) {
    const { data, error } = await this.client
      .from('chat_conversation_participants')
      .select('conversation_id, user_id, last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase chat participant lookup failed: ${error.message}`);
    }

    return (data as ParticipantRow | null) ?? null;
  }

  private toDirectoryUsers(rows: ProfileRow[]): ChatDirectoryUser[] {
    return rows.map((item) => {
      const role = (item.role === 'admin' ? 'admin' : 'broker') as UserRole;

      return {
        id: item.id,
        fullName: item.full_name?.trim() || 'Usuário',
        role,
        isAdmin: role === 'admin',
        appearsInChat: item.appears_in_chat !== false,
      };
    });
  }
}
