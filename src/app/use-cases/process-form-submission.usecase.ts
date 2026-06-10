import { FileExtension } from '../domain/constants/file.constants.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import {
  generateDocumentFileName,
  getFileExtension,
  isValidExtension,
} from '../utils/file-validator.js';

export interface FormSubmissionDocument {
  filename: string;
  contentBase64: string;
}

export interface FormSubmissionInput {
  brokerName: string;
  clientName: string;
  formData: Record<string, unknown>;
  documents: FormSubmissionDocument[];
}

export interface FormSubmissionResult {
  uploadedLocations: string[];
}

export class ProcessFormSubmissionUseCase {
  constructor(
    private readonly storageService: OneDriveService,
    private readonly whatsAppService: WhatsAppService,
    private readonly logger: Logger,
  ) {}

  async execute(input: FormSubmissionInput): Promise<FormSubmissionResult> {
    const createdAt = new Date();
    const uploadOptions = {
      brokerName: input.brokerName,
      clientName: input.clientName,
    };
    const uploadedLocations: string[] = [];

    const report = this.buildFormReport(input, createdAt);
    const reportFilename = generateDocumentFileName({
      createdAt,
      sender: 'endpoint',
      originalName: `dados_formulario_${input.clientName}.${FileExtension.TXT}`,
      clientName: input.clientName,
      brokerName: input.brokerName,
    });

    uploadedLocations.push(
      await this.storageService.upload(
        Buffer.from(report, 'utf-8'),
        reportFilename,
        uploadOptions,
      ),
    );

    for (const [index, document] of input.documents.entries()) {
      const extension = getFileExtension(document.filename);

      if (!isValidExtension(extension)) {
        throw new Error(`Extensão inválida no documento: ${document.filename}`);
      }

      const buffer = Buffer.from(document.contentBase64, 'base64');

      if (!buffer.length || buffer.toString('base64') !== normalizeBase64(document.contentBase64)) {
        throw new Error(`Base64 inválido no documento: ${document.filename}`);
      }

      const filename = generateDocumentFileName({
        createdAt,
        sender: 'endpoint',
        originalName: document.filename,
        messageId: `api-${index + 1}`,
        clientName: input.clientName,
        brokerName: input.brokerName,
      });

      uploadedLocations.push(
        await this.storageService.upload(buffer, filename, uploadOptions),
      );
    }

    await this.whatsAppService.sendTextToConfiguredChat(
      [
        'Arquivos recebidos com sucesso no OneDrive.',
        `Corretor: ${input.brokerName}`,
        `Cliente: ${input.clientName}`,
        `Arquivos enviados: ${uploadedLocations.length}`,
      ].join('\n'),
    );

    this.logger.info('Submissão do endpoint processada com sucesso', {
      brokerName: input.brokerName,
      clientName: input.clientName,
      filesUploaded: uploadedLocations.length,
    });

    return { uploadedLocations };
  }

  private buildFormReport(input: FormSubmissionInput, createdAt: Date): string {
    const lines = [
      'Dados do formulário',
      `Recebido em: ${createdAt.toISOString()}`,
      `Corretor: ${input.brokerName}`,
      `Cliente: ${input.clientName}`,
      '',
      ...Object.entries(input.formData).map(
        ([key, value]) => `${key}: ${formatValue(value)}`,
      ),
      '',
    ];

    return lines.join('\n');
  }
}

function normalizeBase64(value: string): string {
  return value.replace(/\s+/g, '');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}
