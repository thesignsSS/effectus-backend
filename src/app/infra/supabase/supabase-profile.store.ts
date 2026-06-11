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
      .select('id, full_name, role')
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
    };
  }
}
