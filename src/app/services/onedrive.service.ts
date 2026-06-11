import {
  StorageProvider,
  StorageUploadOptions,
} from '../domain/interfaces/storage.interface.js';

export class OneDriveService {
  constructor(private readonly storageProvider: StorageProvider) {}

  upload(file: Buffer, filename: string, options?: StorageUploadOptions): Promise<string> {
    return this.storageProvider.upload(file, filename, options);
  }

  async delete(location: string): Promise<void> {
    if (!this.storageProvider.delete) {
      throw new Error('Storage provider does not support delete');
    }

    await this.storageProvider.delete(location);
  }

  async download(location: string): Promise<Buffer> {
    if (!this.storageProvider.download) {
      throw new Error('Storage provider does not support download');
    }

    return this.storageProvider.download(location);
  }

  async createSignedUrl(location: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.storageProvider.createSignedUrl) {
      throw new Error('Storage provider does not support signed URLs');
    }

    return this.storageProvider.createSignedUrl(location, expiresInSeconds);
  }
}
