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
}
