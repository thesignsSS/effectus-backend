import path from 'node:path';
import {
  ALLOWED_FILE_EXTENSIONS,
  DEFAULT_FILE_CONTENT_TYPE,
  FILE_CONTENT_TYPES,
  FileExtension,
} from '../domain/constants/file.constants.js';

const allowedExtensions = new Set<string>(ALLOWED_FILE_EXTENSIONS);

export function getFileExtension(filename: string): string {
  return path.extname(filename).replace('.', '').toLowerCase();
}

export function isValidExtension(extension: string): boolean {
  return allowedExtensions.has(extension.toLowerCase());
}

export function getContentTypeByExtension(extension: string): string {
  const normalizedExtension = extension.toLowerCase() as FileExtension;

  return FILE_CONTENT_TYPES[normalizedExtension] ?? DEFAULT_FILE_CONTENT_TYPE;
}

export function getContentTypeByFilename(filename: string): string {
  return getContentTypeByExtension(getFileExtension(filename));
}

export function generateDocumentFileName(input: {
  createdAt: Date;
  sender: string;
  originalName: string;
  messageId?: string;
  clientName?: string;
  brokerName?: string;
}): string {
  const timestamp = input.createdAt.toISOString().replace(/[:.]/g, '-');
  const sender = input.sender.replace(/\D/g, '') || 'unknown';
  const messageId = input.messageId
    ? input.messageId.replace(/[^\w-]+/g, '').slice(-10)
    : undefined;
  const clientName = input.clientName ? sanitizeFilenamePart(input.clientName) : undefined;
  const brokerName = input.brokerName ? sanitizeFilenamePart(input.brokerName) : undefined;
  const sanitizedOriginalName = sanitizeFilenamePart(input.originalName);

  return [timestamp, sender, messageId, clientName, brokerName, sanitizedOriginalName]
    .filter(Boolean)
    .join('_');
}

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
