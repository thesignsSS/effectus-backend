import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StorageProvider } from '../../domain/interfaces/storage.interface.js';

export class MockOneDriveClient implements StorageProvider {
  constructor(private readonly folder: string) {}

  async upload(file: Buffer, filename: string): Promise<string> {
    const outputDir = path.join(process.cwd(), this.folder.replace(/^\/+/, ''));
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, file, { flag: 'wx' });

    return outputPath;
  }
}
