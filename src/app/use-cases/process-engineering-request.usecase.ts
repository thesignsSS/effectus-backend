import {
  EngineeringPropertyKind,
  EngineeringRequestDocumentInput,
  EngineeringRequestStore,
  formatEngineeringRequestCode,
} from '../domain/interfaces/engineering-request-store.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import {
  generateDocumentFileName,
  getContentTypeByFilename,
  getFileExtension,
  isValidExtension,
} from '../utils/file-validator.js';

const REQUIRED_DOCUMENT_KEYS_BY_PROPERTY_KIND: Record<EngineeringPropertyKind, string[]> = {
  Usado: ['usado-matricula'],
  Novo: [
    'novo-matricula',
    'novo-art',
    'novo-habite-se',
    'novo-memorial-descritivo',
    'novo-alvara',
  ],
  Terreno: ['terreno-matricula'],
};

export interface EngineeringRequestDocument {
  documentKey: string;
  filename: string;
  contentBase64: string;
}

export interface ProcessEngineeringRequestInput {
  brokerUserId: string;
  brokerName: string;
  propertyKind: EngineeringPropertyKind;
  propertyValue: number;
  contactPhone: string;
  accompanyingName: string;
  documents: EngineeringRequestDocument[];
}

export interface ProcessEngineeringRequestResult {
  requestId: string;
  requestNumber: number;
  uploadedLocations: string[];
}

export class ProcessEngineeringRequestUseCase {
  constructor(
    private readonly storageService: OneDriveService,
    private readonly engineeringRequestStore: EngineeringRequestStore,
    private readonly whatsAppService: WhatsAppService,
    private readonly logger: Logger,
  ) {}

  async execute(
    input: ProcessEngineeringRequestInput,
  ): Promise<ProcessEngineeringRequestResult> {
    const requiredDocumentKeys =
      REQUIRED_DOCUMENT_KEYS_BY_PROPERTY_KIND[input.propertyKind];
    const providedDocumentKeys = new Set(
      input.documents.map((document) => document.documentKey),
    );
    const missingDocumentKeys = requiredDocumentKeys.filter(
      (key) => !providedDocumentKeys.has(key),
    );

    if (missingDocumentKeys.length > 0) {
      throw new Error(
        `Documentos obrigatórios ausentes para o tipo de imóvel selecionado: ${missingDocumentKeys.join(', ')}`,
      );
    }

    const createdAt = new Date();
    const uploadOptions = {
      brokerName: input.brokerName,
      clientName: input.accompanyingName,
    };
    const uploadedLocations: string[] = [];
    const documentInputs: EngineeringRequestDocumentInput[] = [];

    for (const [index, document] of input.documents.entries()) {
      const extension = getFileExtension(document.filename);

      if (!isValidExtension(extension)) {
        throw new Error(`Extensão inválida no documento: ${document.filename}`);
      }

      const buffer = Buffer.from(document.contentBase64, 'base64');

      if (!buffer.length) {
        throw new Error(`Base64 inválido no documento: ${document.filename}`);
      }

      const filename = generateDocumentFileName({
        createdAt,
        sender: 'endpoint',
        originalName: document.filename,
        messageId: `engenharia-${index + 1}`,
        clientName: input.accompanyingName,
        brokerName: input.brokerName,
      });

      const location = await this.storageService.upload(buffer, filename, uploadOptions);
      uploadedLocations.push(location);
      documentInputs.push({
        documentKey: document.documentKey,
        originalFilename: document.filename,
        storageLocation: location,
        contentType: getContentTypeByFilename(filename),
        sizeBytes: buffer.length,
        uploadedAt: createdAt.toISOString(),
      });
    }

    const { id, requestNumber } = await this.engineeringRequestStore.create({
      brokerUserId: input.brokerUserId,
      propertyKind: input.propertyKind,
      propertyValue: input.propertyValue,
      contactPhone: input.contactPhone,
      accompanyingName: input.accompanyingName,
      formData: {
        brokerName: input.brokerName,
      },
      documents: documentInputs,
    });

    try {
      await this.whatsAppService.sendTextToConfiguredChat(
        [
          'Nova solicitação de engenharia recebida.',
          `Solicitação: ${formatEngineeringRequestCode(requestNumber)}`,
          `Corretor: ${input.brokerName}`,
          `Tipo de imóvel: ${input.propertyKind}`,
          `Acompanhante: ${input.accompanyingName}`,
          `Documentos enviados: ${input.documents.length}`,
        ].join('\n'),
      );
    } catch (error) {
      this.logger.warn('Aviso de solicitação de engenharia não enviado pelo WhatsApp', {
        brokerName: input.brokerName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info('Solicitação de engenharia processada com sucesso', {
      brokerName: input.brokerName,
      requestId: id,
      filesUploaded: uploadedLocations.length,
    });

    return { requestId: id, requestNumber, uploadedLocations };
  }
}
