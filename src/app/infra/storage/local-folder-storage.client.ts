import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  StorageProvider,
  StorageUploadOptions,
} from '../../domain/interfaces/storage.interface.js';

export interface LocalFolderStorageClientConfig {
  rootDir: string;
}

export class LocalFolderStorageClient implements StorageProvider {
  constructor(private readonly config: LocalFolderStorageClientConfig) {}

  async upload(
    file: Buffer,
    filename: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    const brokerFolder = sanitizePathSegment(options?.brokerName ?? 'Sem corretor');
    const clientFolder = sanitizePathSegment(options?.clientName ?? 'Sem cliente');
    const outputDir = path.join(this.config.rootDir, brokerFolder, clientFolder);

    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, sanitizePathSegment(filename));
    await fs.writeFile(outputPath, file, { flag: 'wx' });

    return outputPath;
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'Sem nome';
}
