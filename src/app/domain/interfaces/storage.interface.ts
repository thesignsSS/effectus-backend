export interface StorageUploadOptions {
  clientName?: string;
  brokerName?: string;
}

export interface StorageProvider {
  upload(file: Buffer, filename: string, options?: StorageUploadOptions): Promise<string>;
}
