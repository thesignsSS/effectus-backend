import { Logger } from '../domain/interfaces/logger.interface.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { DocumentProcessingQueueService } from '../services/document-processing-queue.service.js';
import { RemittanceSessionService } from '../services/remittance-session.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { ProcessAdditionalInfoUseCase } from '../use-cases/process-additional-info.usecase.js';
import { GenerateCustomerRegistrationReportUseCase } from '../use-cases/generate-customer-registration-report.usecase.js';
import { ProcessIncomingDocumentUseCase } from '../use-cases/process-incoming-document.usecase.js';

const WHATSAPP_CHANNEL_DEPRECATED_MESSAGE = [
  'Este fluxo de envio por comandos no WhatsApp não está mais ativo.',
  '',
  'Agora o envio e acompanhamento das propostas acontece pelo sistema da Effectus.',
  'Se precisar, fale com o administrador para receber o acesso ou suporte.',
].join('\n');

export class WhatsAppController {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly processIncomingDocument: ProcessIncomingDocumentUseCase,
    private readonly processAdditionalInfo: ProcessAdditionalInfoUseCase,
    private readonly logger: Logger,
    private readonly processingQueue: DocumentProcessingQueueService,
    private readonly remittanceSessionService: RemittanceSessionService,
    private readonly generateCustomerRegistrationReport: GenerateCustomerRegistrationReportUseCase,
  ) {}

  async start(): Promise<void> {
    this.whatsAppService.onDocumentReceived((message) =>
      this.handleIncomingMessage(message),
    );
    await this.whatsAppService.connect();
  }

  private async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    if (message.text && !message.hasMedia) {
      await this.handleTextMessage(message);
      return;
    }

    if (!message.hasMedia) {
      return;
    }

    const activeRemittance = this.remittanceSessionService.getActive(message.chatId);

    if (!activeRemittance) {
      this.logger.warn('Documento ignorado sem remessa ativa', {
        messageId: message.id,
        chatId: message.chatId,
      });
      await this.whatsAppService.sendText(
        message.chatId,
        WHATSAPP_CHANNEL_DEPRECATED_MESSAGE,
      );
      return;
    }

    this.processingQueue.enqueue({
      ...message,
      remittance: activeRemittance,
    });
    this.logger.info('Documento adicionado à fila', {
      messageId: message.id,
      clientName: activeRemittance.clientName,
      brokerName: activeRemittance.brokerName,
      active: this.processingQueue.active(),
      queued: this.processingQueue.size(),
    });
  }

  async processQueuedMessage(message: IncomingMessage): Promise<void> {
    try {
      await this.processIncomingDocument.execute(message);
    } catch (error) {
      this.logger.error('Erro ao processar mensagem recebida', {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleTextMessage(message: IncomingMessage): Promise<void> {
    const text = message.text?.trim() ?? '';
    const activeRemittance = this.remittanceSessionService.getActive(message.chatId);

    if (!activeRemittance) {
      this.logger.info('Mensagem recebida em canal legado do WhatsApp', {
        messageId: message.id,
        chatId: message.chatId,
        hasText: Boolean(text),
      });
      await this.whatsAppService.sendText(
        message.chatId,
        WHATSAPP_CHANNEL_DEPRECATED_MESSAGE,
      );
      return;
    }

    this.remittanceSessionService.addAdditionalMessage(message.chatId, text);
    this.logger.info('Informação adicional registrada na remessa', {
      messageId: message.id,
      clientName: activeRemittance.clientName,
      brokerName: activeRemittance.brokerName,
    });
  }

  async processQueuedTextMessage(message: IncomingMessage): Promise<void> {
    try {
      await this.processAdditionalInfo.execute(message);
    } catch (error) {
      this.logger.error('Erro ao processar informações adicionais', {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

}
