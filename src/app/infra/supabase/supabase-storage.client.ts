import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DashboardDocument } from '../../domain/interfaces/dashboard.interface.js';
import { StorageProvider } from '../../domain/interfaces/storage.interface.js';
import {
  getContentTypeByFilename,
  getFileExtension,
} from '../../utils/file-validator.js';

export interface SupabaseStorageClientConfig {
  url?: string;
  serviceRoleKey?: string;
  bucket: string;
  folder: string;
}

export class SupabaseStorageClient implements StorageProvider {
  private readonly client: SupabaseClient;

  constructor(private readonly config: SupabaseStorageClientConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_PROVIDER=supabase',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async upload(file: Buffer, filename: string): Promise<string> {
    const storagePath = this.buildStoragePath(filename);
    const { error } = await this.client.storage
      .from(this.config.bucket)
      .upload(storagePath, file, {
        upsert: false,
        contentType: getContentTypeByFilename(filename),
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    return `${this.config.bucket}/${storagePath}`;
  }

  async listDocuments(): Promise<DashboardDocument[]> {
    const folder = this.normalizeFolder();
    const { data, error } = await this.client.storage
      .from(this.config.bucket)
      .list(folder, {
        limit: 100,
        offset: 0,
        sortBy: {
          column: 'created_at',
          order: 'desc',
        },
      });

    if (error) {
      throw new Error(`Supabase list documents failed: ${error.message}`);
    }

    return (data ?? [])
      .filter((item) => item.name !== '.emptyFolderPlaceholder')
      .map((item) =>
        this.toDashboardDocument(item.name, folder, item.created_at ?? undefined),
      );
  }

  private buildStoragePath(filename: string): string {
    const folder = this.normalizeFolder();

    return folder ? `${folder}/${filename}` : filename;
  }

  private normalizeFolder(): string {
    return this.config.folder.replace(/^\/+|\/+$/g, '');
  }

  private toDashboardDocument(
    filename: string,
    folder: string,
    createdAt?: string,
  ): DashboardDocument {
    const parsed = this.parseStoredFilename(filename);
    const storagePath = folder ? `${folder}/${filename}` : filename;

    return {
      id: storagePath,
      originalName: parsed.originalName,
      filename,
      extension: getFileExtension(filename),
      sender: parsed.sender,
      location: `${this.config.bucket}/${storagePath}`,
      receivedAt: parsed.receivedAt ?? createdAt ?? new Date().toISOString(),
    };
  }

  private parseStoredFilename(filename: string): {
    originalName: string;
    sender: string;
    receivedAt?: string;
  } {
    const parts = filename.split('_');

    if (parts.length < 3) {
      return {
        originalName: filename,
        sender: 'unknown',
      };
    }

    return {
      receivedAt: parts[0].replace(
        /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
        '$1:$2:$3.$4',
      ),
      sender: parts[1],
      originalName: parts.slice(this.getOriginalNameStartIndex(parts)).join('_'),
    };
  }

  private getOriginalNameStartIndex(parts: string[]): number {
    if (parts.length >= 6) {
      return 5;
    }

    if (parts.length >= 4) {
      return 3;
    }

    return 2;
  }
}
