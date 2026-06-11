export interface StorageUploadOptions {
  clientName?: string;
  brokerName?: string;
}

export interface StorageProvider {
  upload(file: Buffer, filename: string, options?: StorageUploadOptions): Promise<string>;
  delete?(location: string): Promise<void>;
  download?(location: string): Promise<Buffer>;
  createSignedUrl?(location: string, expiresInSeconds: number): Promise<string>;
}
