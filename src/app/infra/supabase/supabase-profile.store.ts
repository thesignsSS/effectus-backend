import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ProfileStore,
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
      .select('id, full_name, role, is_active, avatar_path, updated_at')
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
      avatarPath: data.avatar_path ?? null,
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
      .select('id, full_name, role, is_active, avatar_path, updated_at')
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
      avatar_path: string | null;
      updated_at: string | null;
    }> | null) ?? []).map((item) => {
      const role = (item.role === 'admin' ? 'admin' : 'broker') as UserRole;

      return {
        id: item.id,
        fullName: item.full_name ?? '',
        role,
        isAdmin: role === 'admin',
        isActive: item.is_active !== false,
        avatarPath: item.avatar_path ?? null,
        updatedAt: item.updated_at ?? null,
      };
    });
  }
}
