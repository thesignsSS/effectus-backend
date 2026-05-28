import { FileService } from '../services/file.service.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { DashboardPresenter } from '../domain/interfaces/dashboard.interface.js';
import { RemittanceSessionService } from '../services/remittance-session.service.js';
import { ExtractDocumentInfoUseCase } from './extract-document-info.usecase.js';
import {
  generateDocumentFileName,
  isValidExtension,
} from '../utils/file-validator.js';

export class ProcessIncomingDocumentUseCase {
  constructor(
    private readonly fileService: FileService,
    private readonly oneDriveService: OneDriveService,
    private readonly logger: Logger,
    private readonly remittanceSessionService: RemittanceSessionService,
    private readonly dashboardPresenter?: DashboardPresenter,
    private readonly extractDocumentInfo?: ExtractDocumentInfoUseCase,
  ) {}

  async execute(message: IncomingMessage): Promise<void> {
    if (!message.hasMedia) {
      return;
    }

    this.logger.info('Documento recebido', {
      messageId: message.id,
      sender: message.sender,
    });

    const document = await this.fileService.download(message);

    this.logger.info('Download realizado', {
      name: document.name,
      extension: document.extension,
      sender: document.sender,
    });

    if (!isValidExtension(document.extension)) {
      this.logger.warn('Extensão inválida', {
        name: document.name,
        extension: document.extension,
      });
      return;
    }

    const filename = generateDocumentFileName({
      createdAt: document.createdAt,
      sender: document.sender,
      originalName: document.name,
      messageId: message.id,
      clientName: message.remittance?.clientName,
      brokerName: message.remittance?.brokerName,
    });
    const tempPath = await this.fileService.saveTemporarily(document, filename);

    this.logger.info('Arquivo salvo temporariamente', {
      filename,
      tempPath,
    });

    try {
      const location = await this.oneDriveService.upload(document.buffer, filename, {
        clientName: message.remittance?.clientName,
        brokerName: message.remittance?.brokerName,
      });

      this.logger.info('Upload concluído', {
        filename,
        location,
      });

      this.dashboardPresenter?.addDocument({
        id: location,
        originalName: document.name,
        filename,
        extension: document.extension,
        sender: document.sender,
        location,
        receivedAt: document.createdAt.toISOString(),
      });

      try {
        const extraction = await this.extractDocumentInfo?.execute({
          document,
          filename,
          messageId: message.id,
          clientName: message.remittance?.clientName,
          brokerName: message.remittance?.brokerName,
        });

        if (extraction && message.remittance) {
          this.remittanceSessionService.addDocumentReading(message.chatId, {
            filename,
            originalName: document.name,
            extension: document.extension,
            text: extraction.text,
            confidence: extraction.confidence,
            receivedAt: document.createdAt.toISOString(),
            visionInputs: extraction.visionInputs,
          });
          this.logger.info('Leitura anexada à remessa ativa', {
            filename,
            textLength: extraction.text.length,
            visionInputs: extraction.visionInputs.length,
          });
        }
      } catch (error) {
        this.logger.error('Falha ao extrair informações do documento', {
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      this.logger.error('Falha no upload', {
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
