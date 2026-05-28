import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Document } from '../domain/entities/document.entity.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { getFileExtension } from '../utils/file-validator.js';

export class FileService {
  constructor(private readonly tempDir: string) {}

  async download(message: IncomingMessage): Promise<Document> {
    const buffer = await message.downloadMedia();
    const name = message.originalFileName ?? `${message.id}.bin`;
    const extension = getFileExtension(name);

    return new Document(name, extension, buffer, message.sender, message.timestamp);
  }

  async saveTemporarily(document: Document, filename: string): Promise<string> {
    const outputDir = path.join(process.cwd(), this.tempDir);
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, document.buffer, { flag: 'wx' });

    return outputPath;
  }
}
