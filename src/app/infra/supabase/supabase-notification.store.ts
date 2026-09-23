import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CreateNotificationInput,
  NotificationItem,
  NotificationStore,
} from '../../domain/interfaces/notification-store.interface.js';
import { resolveCompanyIdForUser } from './company-scope.js';

export interface SupabaseNotificationStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type NotificationRow = {
  id: string;
  user_id: string;
  proposal_id: string | null;
  conversation_id: string | null;
  type: NotificationItem['type'];
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

export class SupabaseNotificationStore implements NotificationStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseNotificationStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to manage notifications',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async createMany(input: CreateNotificationInput[]): Promise<NotificationItem[]> {
    if (input.length === 0) {
      return [];
    }

    const uniqueUserIds = [...new Set(input.map((item) => item.userId))];
    const companyIdByUser = new Map(
      await Promise.all(
        uniqueUserIds.map(
          async (userId) =>
            [userId, await resolveCompanyIdForUser(this.client, userId)] as const,
        ),
      ),
    );

    const { data, error } = await this.client
      .from('notifications')
      .insert(
        input.map((item) => ({
          user_id: item.userId,
          company_id: companyIdByUser.get(item.userId),
          proposal_id: item.proposalId ?? null,
          conversation_id: item.conversationId ?? null,
          type: item.type,
          title: item.title,
          message: item.message,
        })),
      )
      .select('id, user_id, proposal_id, conversation_id, type, title, message, created_at, read_at');

    if (error) {
      throw new Error(`Supabase notifications create failed: ${error.message}`);
    }

    return ((data as NotificationRow[] | null) ?? []).map((item) => ({
      id: item.id,
      userId: item.user_id,
      proposalId: item.proposal_id,
      conversationId: item.conversation_id,
      type: item.type,
      title: item.title,
      message: item.message,
      createdAt: item.created_at,
      readAt: item.read_at,
    }));
  }

  async listByUser(userId: string): Promise<NotificationItem[]> {
    const expiresAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.client
      .from('notifications')
      .select('id, user_id, proposal_id, conversation_id, type, title, message, created_at, read_at')
      .eq('user_id', userId)
      .or(`read_at.is.null,read_at.gte.${expiresAfter}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Supabase notifications list failed: ${error.message}`);
    }

    return ((data as NotificationRow[] | null) ?? []).map((item) => ({
      id: item.id,
      userId: item.user_id,
      proposalId: item.proposal_id,
      conversationId: item.conversation_id,
      type: item.type,
      title: item.title,
      message: item.message,
      createdAt: item.created_at,
      readAt: item.read_at,
    }));
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const { error } = await this.client
      .from('notifications')
      .update({
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Supabase notification update failed: ${error.message}`);
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    const { error } = await this.client
      .from('notifications')
      .update({
        read_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) {
      throw new Error(`Supabase notifications mark all failed: ${error.message}`);
    }
  }

  async listUserIdsByRole(role: 'admin' | 'broker'): Promise<string[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id')
      .eq('role', role)
      .eq('is_active', true);

    if (error) {
      throw new Error(`Supabase profiles by role failed: ${error.message}`);
    }

    return ((data as Array<{ id: string }> | null) ?? []).map((item) => item.id);
  }
}
