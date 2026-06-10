import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  StorageProvider,
  StorageUploadOptions,
} from '../../domain/interfaces/storage.interface.js';

export class MockOneDriveClient implements StorageProvider {
  constructor(private readonly folder: string) {}

  async upload(
    file: Buffer,
    filename: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    const outputDir = path.join(
      process.cwd(),
      this.folder.replace(/^\/+/, ''),
      sanitizePathSegment(options?.brokerName ?? 'Sem corretor'),
      sanitizePathSegment(options?.clientName ?? 'Sem cliente'),
    );
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, sanitizePathSegment(filename));
    await fs.writeFile(outputPath, file, { flag: 'wx' });

    return outputPath;
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = replaceControlCharacters(value)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'Sem nome';
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) =>
      (character.codePointAt(0) ?? 0) < 32 ? '_' : character,
    )
    .join('');
}
