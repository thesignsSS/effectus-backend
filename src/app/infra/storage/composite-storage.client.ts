import { DashboardDocument } from '../../domain/interfaces/dashboard.interface.js';
import {
  StorageProvider,
  StorageUploadOptions,
} from '../../domain/interfaces/storage.interface.js';

type ListableStorageProvider = StorageProvider & {
  listDocuments?: () => Promise<DashboardDocument[]>;
};

export class CompositeStorageClient implements StorageProvider {
  constructor(
    private readonly primary: ListableStorageProvider,
    private readonly mirrors: StorageProvider[],
  ) {}

  async upload(
    file: Buffer,
    filename: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    const primaryLocation = await this.primary.upload(file, filename, options);

    for (const mirror of this.mirrors) {
      await mirror.upload(file, filename, options);
    }

    return primaryLocation;
  }

  async listDocuments(): Promise<DashboardDocument[]> {
    if (!this.primary.listDocuments) {
      return [];
    }

    return this.primary.listDocuments();
  }

  async delete(location: string): Promise<void> {
    if (!this.primary.delete) {
      throw new Error('Primary storage provider does not support delete');
    }

    await this.primary.delete(location);
  }

  async download(location: string): Promise<Buffer> {
    if (!this.primary.download) {
      throw new Error('Primary storage provider does not support download');
    }

    return this.primary.download(location);
  }

  async createSignedUrl(location: string, expiresInSeconds: number): Promise<string> {
    if (!this.primary.createSignedUrl) {
      throw new Error('Primary storage provider does not support signed URLs');
    }

    return this.primary.createSignedUrl(location, expiresInSeconds);
  }
}
