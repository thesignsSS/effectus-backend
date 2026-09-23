import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  BrokerClientStore,
  SaveBrokerClientInput,
} from '../../domain/interfaces/broker-client-store.interface.js';
import { resolveCompanyIdForUser } from './company-scope.js';

export interface SupabaseBrokerClientStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

export class SupabaseBrokerClientStore implements BrokerClientStore {
  private readonly client: SupabaseClient;

  constructor(private readonly config: SupabaseBrokerClientStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to save broker clients',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async save(input: SaveBrokerClientInput): Promise<void> {
    const companyId = await resolveCompanyIdForUser(this.client, input.brokerUserId);

    const { error } = await this.client.from('broker_clients').upsert(
      {
        broker_user_id: input.brokerUserId,
        company_id: companyId,
        broker_name: input.brokerName,
        client_name: input.clientName,
        client_cpf: input.clientCpf ?? null,
        client_email: input.clientEmail ?? null,
        client_phone: input.clientPhone ?? null,
        form_data: input.formData,
      },
      {
        onConflict: 'broker_user_id,client_name_normalized',
      },
    );

    if (error) {
      throw new Error(`Supabase broker client save failed: ${error.message}`);
    }
  }
}
