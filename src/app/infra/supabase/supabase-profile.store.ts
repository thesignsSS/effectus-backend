import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ProfileStore,
  StoredUserPreferences,
  UserProfile,
  UserRole,
} from '../../domain/interfaces/profile-store.interface.js';

export interface SupabaseProfileStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

export class SupabaseProfileStore implements ProfileStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseProfileStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read profiles',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async getById(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, role, is_active, appears_in_chat, avatar_path, can_view_preferences_insights, ux_preferences, ux_preferences_updated_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase profile get failed: ${error.message}`);
    }

    const role = (data.role === 'admin' ? 'admin' : 'broker') as UserRole;

    return {
      id: data.id,
      fullName: data.full_name ?? '',
      role,
      isAdmin: role === 'admin',
      isActive: data.is_active !== false,
      appearsInChat: data.appears_in_chat !== false,
      avatarPath: data.avatar_path ?? null,
      canViewPreferencesInsights:
        role === 'admin' || data.can_view_preferences_insights === true,
      preferencesSnapshot: this.parseStoredUserPreferences(data.ux_preferences),
      preferencesUpdatedAt: data.ux_preferences_updated_at ?? null,
      updatedAt: data.updated_at ?? null,
    };
  }

  async searchByName(input: {
    query: string;
    excludeUserId?: string;
    limit?: number;
  }): Promise<UserProfile[]> {
    let query = this.client
      .from('profiles')
      .select('id, full_name, role, is_active, appears_in_chat, avatar_path, can_view_preferences_insights, ux_preferences, ux_preferences_updated_at, updated_at')
      .eq('is_active', true)
      .ilike('full_name', `%${input.query.replace(/[,%]/g, '')}%`)
      .limit(Math.min(20, Math.max(1, input.limit ?? 10)));

    if (input.excludeUserId) {
      query = query.neq('id', input.excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Supabase profile search failed: ${error.message}`);
    }

    return ((data as Array<{
      id: string;
      full_name: string | null;
      role: string | null;
      is_active: boolean | null;
      appears_in_chat: boolean | null;
      avatar_path: string | null;
      can_view_preferences_insights: boolean | null;
      ux_preferences: unknown;
      ux_preferences_updated_at: string | null;
      updated_at: string | null;
    }> | null) ?? []).map((item) => {
      const role = (item.role === 'admin' ? 'admin' : 'broker') as UserRole;

      return {
        id: item.id,
        fullName: item.full_name ?? '',
        role,
        isAdmin: role === 'admin',
        isActive: item.is_active !== false,
        appearsInChat: item.appears_in_chat !== false,
        avatarPath: item.avatar_path ?? null,
        canViewPreferencesInsights:
          role === 'admin' || item.can_view_preferences_insights === true,
        preferencesSnapshot: this.parseStoredUserPreferences(item.ux_preferences),
        preferencesUpdatedAt: item.ux_preferences_updated_at ?? null,
        updatedAt: item.updated_at ?? null,
      };
    });
  }

  async listPreferenceInsights(): Promise<UserProfile[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, role, is_active, appears_in_chat, avatar_path, can_view_preferences_insights, ux_preferences, ux_preferences_updated_at, updated_at')
      .order('full_name', { ascending: true });

    if (error) {
      throw new Error(`Supabase preference insights failed: ${error.message}`);
    }

    return ((data as Array<{
      id: string;
      full_name: string | null;
      role: string | null;
      is_active: boolean | null;
      appears_in_chat: boolean | null;
      avatar_path: string | null;
      can_view_preferences_insights: boolean | null;
      ux_preferences: unknown;
      ux_preferences_updated_at: string | null;
      updated_at: string | null;
    }> | null) ?? []).map((item) => {
      const role = (item.role === 'admin' ? 'admin' : 'broker') as UserRole;

      return {
        id: item.id,
        fullName: item.full_name ?? '',
        role,
        isAdmin: role === 'admin',
        isActive: item.is_active !== false,
        appearsInChat: item.appears_in_chat !== false,
        avatarPath: item.avatar_path ?? null,
        canViewPreferencesInsights:
          role === 'admin' || item.can_view_preferences_insights === true,
        preferencesSnapshot: this.parseStoredUserPreferences(item.ux_preferences),
        preferencesUpdatedAt: item.ux_preferences_updated_at ?? null,
        updatedAt: item.updated_at ?? null,
      };
    });
  }

  private parseStoredUserPreferences(value: unknown): StoredUserPreferences | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const preferences = value as Record<string, unknown>;

    let sanitizedNotificationTypes: Record<string, boolean> | undefined;

    if (
      preferences.notifications &&
      typeof preferences.notifications === 'object' &&
      !Array.isArray(preferences.notifications) &&
      (preferences.notifications as { types?: unknown }).types &&
      typeof (preferences.notifications as { types?: unknown }).types === 'object' &&
      !Array.isArray((preferences.notifications as { types?: unknown }).types)
    ) {
      sanitizedNotificationTypes = Object.fromEntries(
        Object.entries(
          (preferences.notifications as { types: Record<string, unknown> }).types,
        ).filter(([, itemValue]) => typeof itemValue === 'boolean'),
      ) as Record<string, boolean>;
    }

    return {
      theme: typeof preferences.theme === 'string' ? preferences.theme : undefined,
      fontSize: typeof preferences.fontSize === 'string' ? preferences.fontSize : undefined,
      density: typeof preferences.density === 'string' ? preferences.density : undefined,
      proposalsLayout:
        typeof preferences.proposalsLayout === 'string'
          ? preferences.proposalsLayout
          : undefined,
      chatWallpaper:
        typeof preferences.chatWallpaper === 'string'
          ? preferences.chatWallpaper
          : undefined,
      enterBehavior:
        typeof preferences.enterBehavior === 'string'
          ? preferences.enterBehavior
          : undefined,
      notifications:
        preferences.notifications &&
        typeof preferences.notifications === 'object' &&
        !Array.isArray(preferences.notifications)
          ? {
              sound:
                typeof (preferences.notifications as { sound?: unknown }).sound ===
                'boolean'
                  ? (preferences.notifications as { sound: boolean }).sound
                  : undefined,
              types: sanitizedNotificationTypes,
            }
          : undefined,
    };
  }
}
