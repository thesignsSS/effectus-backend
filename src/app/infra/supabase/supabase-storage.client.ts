import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DashboardDocument } from '../../domain/interfaces/dashboard.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import {
  StorageProvider,
  StorageUploadOptions,
} from '../../domain/interfaces/storage.interface.js';
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

  constructor(
    private readonly config: SupabaseStorageClientConfig,
    private readonly logger?: Logger,
  ) {
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

  async upload(
    file: Buffer,
    filename: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    const storagePath = this.buildStoragePath(filename, options);
    this.logger?.info('Iniciando upload no Supabase Storage', {
      bucket: this.config.bucket,
      folder: this.normalizeFolder(),
      brokerName: options?.brokerName,
      clientName: options?.clientName,
      filename,
      storagePath,
    });

    const { error } = await this.client.storage
      .from(this.config.bucket)
      .upload(storagePath, file, {
        upsert: false,
        contentType: getContentTypeByFilename(filename),
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    this.logger?.info('Upload concluido no Supabase Storage', {
      bucket: this.config.bucket,
      storagePath,
    });

    return `${this.config.bucket}/${storagePath}`;
  }

  async listDocuments(): Promise<DashboardDocument[]> {
    const folder = this.normalizeFolder();
    return this.listDocumentsRecursively(folder);
  }

  async delete(location: string): Promise<void> {
    const { bucket, path } = this.parseLocation(location);
    const { error } = await this.client.storage.from(bucket).remove([path]);

    if (error) {
      throw new Error(`Supabase delete failed: ${error.message}`);
    }
  }

  async download(location: string): Promise<Buffer> {
    const { bucket, path } = this.parseLocation(location);
    const { data, error } = await this.client.storage.from(bucket).download(path);

    if (error || !data) {
      throw new Error(`Supabase download failed: ${error?.message ?? 'empty response'}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async createSignedUrl(location: string, expiresInSeconds: number): Promise<string> {
    const { bucket, path } = this.parseLocation(location);
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Supabase signed URL failed: ${error?.message ?? 'empty response'}`);
    }

    return data.signedUrl;
  }

  private buildStoragePath(
    filename: string,
    options?: StorageUploadOptions,
  ): string {
    const folder = this.normalizeFolder();
    const brokerFolder = sanitizePathSegment(options?.brokerName ?? 'Sem corretor');
    const clientFolder = sanitizePathSegment(options?.clientName ?? 'Sem cliente');
    const nestedFolder = [folder, brokerFolder, clientFolder].filter(Boolean).join('/');

    return nestedFolder ? `${nestedFolder}/${filename}` : filename;
  }

  private normalizeFolder(): string {
    return this.config.folder.replace(/^\/+|\/+$/g, '');
  }

  private parseLocation(location: string): { bucket: string; path: string } {
    const [bucket, ...pathParts] = location.split('/');
    const path = pathParts.join('/');

    if (!bucket || !path) {
      throw new Error(`Invalid storage location: ${location}`);
    }

    return { bucket, path };
  }

  private async listDocumentsRecursively(folder: string): Promise<DashboardDocument[]> {
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

    const documents: DashboardDocument[] = [];

    for (const item of data ?? []) {
      if (item.name === '.emptyFolderPlaceholder') {
        continue;
      }

      const itemPath = folder ? `${folder}/${item.name}` : item.name;

      if (!item.id) {
        const nestedDocuments = await this.listDocumentsRecursively(itemPath);
        documents.push(...nestedDocuments);
        continue;
      }

      documents.push(
        this.toDashboardDocument(item.name, folder, item.created_at ?? undefined),
      );
    }

    return documents.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
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

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'Sem nome';
}
