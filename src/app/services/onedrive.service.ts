import {
  StorageProvider,
  StorageUploadOptions,
} from '../domain/interfaces/storage.interface.js';

export class OneDriveService {
  constructor(private readonly storageProvider: StorageProvider) {}

  upload(file: Buffer, filename: string, options?: StorageUploadOptions): Promise<string> {
    return this.storageProvider.upload(file, filename, options);
  }
}
