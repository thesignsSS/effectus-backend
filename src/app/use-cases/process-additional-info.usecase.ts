import { Document } from '../domain/entities/document.entity.js';
import { DashboardPresenter } from '../domain/interfaces/dashboard.interface.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { FileExtension } from '../domain/constants/file.constants.js';
import { Logger } from '../domain/interfaces/logger.interface.js';
import { FileService } from '../services/file.service.js';
import { OneDriveService } from '../services/onedrive.service.js';
import { generateDocumentFileName } from '../utils/file-validator.js';

export class ProcessAdditionalInfoUseCase {
  constructor(
    private readonly fileService: FileService,
    private readonly storageService: OneDriveService,
    private readonly logger: Logger,
    private readonly dashboardPresenter?: DashboardPresenter,
  ) {}

  async execute(message: IncomingMessage): Promise<void> {
    if (!message.text || !message.remittance) {
      return;
    }

    const originalName = `informacoes_adicionais_${message.remittance.clientName}.${FileExtension.TXT}`;
    const buffer = Buffer.from(this.buildContent(message), 'utf-8');
    const document = new Document(
      originalName,
      FileExtension.TXT,
      buffer,
      message.sender,
      message.timestamp,
    );
    const filename = generateDocumentFileName({
      createdAt: document.createdAt,
      sender: document.sender,
      originalName: document.name,
      messageId: message.id,
      clientName: message.remittance.clientName,
      brokerName: message.remittance.brokerName,
    });
    const tempPath = await this.fileService.saveTemporarily(document, filename);

    this.logger.info('Informações adicionais salvas temporariamente', {
      filename,
      tempPath,
    });

    const location = await this.storageService.upload(document.buffer, filename, {
      clientName: message.remittance.clientName,
      brokerName: message.remittance.brokerName,
    });

    this.logger.info('Informações adicionais enviadas ao storage', {
      filename,
      location,
    });

    this.dashboardPresenter?.addDocument({
      id: location,
      originalName,
      filename,
      extension: FileExtension.TXT,
      sender: document.sender,
      location,
      receivedAt: document.createdAt.toISOString(),
    });
  }

  private buildContent(message: IncomingMessage): string {
    return [
      `Cliente: ${message.remittance?.clientName}`,
      `Corretor: ${message.remittance?.brokerName}`,
      `Remetente: ${message.sender}`,
      `Recebido em: ${message.timestamp.toISOString()}`,
      '',
      'Mensagens:',
      message.text,
      '',
    ].join('\n');
  }
}
