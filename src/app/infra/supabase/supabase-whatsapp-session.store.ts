import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { WhatsAppSessionStore } from '../../domain/interfaces/whatsapp-session-store.interface.js';

export interface SupabaseWhatsAppSessionStoreConfig {
  url?: string;
  serviceRoleKey?: string;
  bucket: string;
  path: string;
}

export class SupabaseWhatsAppSessionStore implements WhatsAppSessionStore {
  private readonly client: SupabaseClient;

  constructor(
    private readonly config: SupabaseWhatsAppSessionStoreConfig,
    private readonly logger?: Logger,
  ) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for WhatsApp session persistence',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async load(): Promise<Buffer | null> {
    const { data, error } = await this.client.storage
      .from(this.config.bucket)
      .download(this.config.path);

    if (error) {
      const statusCode =
        typeof error === 'object' && error && 'statusCode' in error
          ? String(error.statusCode)
          : undefined;

      if (statusCode === '404') {
        return null;
      }

      throw new Error(`Supabase WhatsApp session download failed: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    this.logger?.info('Sessão do WhatsApp carregada do Supabase Storage', {
      bucket: this.config.bucket,
      path: this.config.path,
    });

    return Buffer.from(await data.arrayBuffer());
  }

  async save(snapshot: Buffer): Promise<void> {
    const { error } = await this.client.storage.from(this.config.bucket).upload(
      this.config.path,
      snapshot,
      {
        upsert: true,
        contentType: 'application/json',
      },
    );

    if (error) {
      throw new Error(`Supabase WhatsApp session upload failed: ${error.message}`);
    }

    this.logger?.info('Sessão do WhatsApp salva no Supabase Storage', {
      bucket: this.config.bucket,
      path: this.config.path,
      sizeBytes: snapshot.length,
    });
  }

  async clear(): Promise<void> {
    const { error } = await this.client.storage.from(this.config.bucket).remove([this.config.path]);

    if (error) {
      throw new Error(`Supabase WhatsApp session delete failed: ${error.message}`);
    }

    this.logger?.info('Sessão do WhatsApp removida do Supabase Storage', {
      bucket: this.config.bucket,
      path: this.config.path,
    });
  }
}
