import { Logger } from '../domain/interfaces/logger.interface.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { DocumentProcessingQueueService } from '../services/document-processing-queue.service.js';
import { RemittanceSessionService } from '../services/remittance-session.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { ProcessAdditionalInfoUseCase } from '../use-cases/process-additional-info.usecase.js';
import { GenerateCustomerRegistrationReportUseCase } from '../use-cases/generate-customer-registration-report.usecase.js';
import { ProcessIncomingDocumentUseCase } from '../use-cases/process-incoming-document.usecase.js';

const AVAILABLE_COMMANDS_MESSAGE = [
  'Não entendi essa mensagem.',
  '',
  'Comandos disponíveis:',
  'Novo cliente: Nome do cliente',
  'Nome do corretor: Nome do corretor',
  '',
  'Quando terminar de enviar os documentos, envie:',
  'Finalizado',
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
        'Nenhuma remessa ativa. Envie primeiro:\nNovo cliente: Nome do cliente\nNome do corretor: Nome do corretor',
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

    if (/^finalizado$/i.test(text)) {
      const activeSession = this.remittanceSessionService.getActive(message.chatId);

      if (!activeSession) {
        await this.whatsAppService.sendText(
          message.chatId,
          'Nenhuma remessa ativa para finalizar.',
        );
        return;
      }

      await this.processingQueue.waitForIdle();

      this.remittanceSessionService.finish(message.chatId);
      const reportLocation =
        await this.generateCustomerRegistrationReport.execute(activeSession);

      await this.whatsAppService.sendText(
        message.chatId,
        [
          'Remessa finalizada',
          `Cliente: ${activeSession.clientName}`,
          `Corretor: ${activeSession.brokerName}`,
          `Documentos lidos: ${activeSession.documentReadings.length}`,
          `Relatório cadastral: ${reportLocation}`,
        ].join('\n'),
      );
      return;
    }

    const trigger = this.parseStartTrigger(text);

    if (!trigger) {
      const activeRemittance = this.remittanceSessionService.getActive(message.chatId);

      if (!activeRemittance) {
        this.logger.info('Mensagem não reconhecida sem remessa ativa', {
          messageId: message.id,
          chatId: message.chatId,
        });
        await this.whatsAppService.sendText(message.chatId, AVAILABLE_COMMANDS_MESSAGE);
        return;
      }

      this.remittanceSessionService.addAdditionalMessage(message.chatId, text);
      this.logger.info('Informação adicional registrada na remessa', {
        messageId: message.id,
        clientName: activeRemittance.clientName,
        brokerName: activeRemittance.brokerName,
      });
      return;
    }

    const session = this.remittanceSessionService.start({
      chatId: message.chatId,
      clientName: trigger.clientName,
      brokerName: trigger.brokerName,
    });

    this.logger.info('Remessa iniciada', {
      remittanceId: session.id,
      clientName: session.clientName,
      brokerName: session.brokerName,
    });

    await this.whatsAppService.sendText(
      message.chatId,
      `Chat Iniciado\nCliente: ${session.clientName}\nCorretor: ${session.brokerName}`,
    );
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

  private parseStartTrigger(text: string):
    | {
        clientName: string;
        brokerName: string;
      }
    | undefined {
    const clientName = this.extractField(text, 'novo cliente');
    const brokerName = this.extractField(text, 'nome do corretor');

    if (!clientName || !brokerName) {
      return undefined;
    }

    return {
      clientName,
      brokerName,
    };
  }

  private extractField(text: string, label: string): string | undefined {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const field = text.match(
      new RegExp(`${escapedLabel}\\s*:\\s*([^\\n;]+)`, 'i'),
    )?.[1]?.trim();

    return field || undefined;
  }
}
