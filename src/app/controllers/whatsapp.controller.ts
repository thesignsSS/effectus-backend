import { Logger } from '../domain/interfaces/logger.interface.js';
import { IncomingMessage } from '../domain/interfaces/messaging.interface.js';
import { DocumentProcessingQueueService } from '../services/document-processing-queue.service.js';
import { RemittanceSessionService } from '../services/remittance-session.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { ProcessAdditionalInfoUseCase } from '../use-cases/process-additional-info.usecase.js';
import { GenerateCustomerRegistrationReportUseCase } from '../use-cases/generate-customer-registration-report.usecase.js';
import { ProcessIncomingDocumentUseCase } from '../use-cases/process-incoming-document.usecase.js';

/**
 * LEGADO — o recebimento de documentos por WhatsApp está DESATIVADO.
 *
 * Este canal foi o fluxo original: o cliente do corretor mandava documentos por
 * WhatsApp e o bot lia, extraía dados e anexava à proposta. Hoje isso acontece
 * pelo sistema, e o recebimento não é mais usado (confirmado pelo dono do
 * projeto em 2026-09-25).
 *
 * Toda mensagem que chega é respondida com o aviso abaixo e descartada. Nada é
 * enfileirado, nada é processado, nada é gravado.
 *
 * Antes desta mudança o fluxo já estava morto, mas por acidente: nenhum lugar
 * do código chamava `RemittanceSessionService.start()`, então nunca havia
 * remessa ativa e todo documento caía no mesmo aviso. Bastava alguém voltar a
 * criar sessão para revivê-lo sem querer. Agora a recusa é incondicional.
 *
 * Consequência disso, se alguém reativar: este caminho identifica a empresa por
 * `resolveCompanyIdForProposal`, que NÃO checa o status da assinatura. A trava
 * de acesso por pagamento (em `resolveCompanyIdForUser`) não cobre ele —
 * empresa suspensa seguiria sendo atendida por aqui. Ver
 * `effectus-api/docs/prd-trial-cobranca-e-cancelamento.md`.
 *
 * O ENVIO de mensagens continua ativo e não é legado: é por ele que saem os
 * avisos de proposta e de solicitação de engenharia.
 *
 * Inalcançáveis a partir daqui, mantidos por ora: `ProcessIncomingDocumentUseCase`,
 * `ProcessAdditionalInfoUseCase`, `DocumentProcessingQueueService` e
 * `RemittanceSessionService`.
 */
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

  /**
   * Responde o aviso e descarta. Não enfileira nem processa — ver o bloco
   * LEGADO no topo do arquivo.
   */
  private async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    this.logger.info('Mensagem recebida em canal legado do WhatsApp', {
      messageId: message.id,
      chatId: message.chatId,
      hasMedia: message.hasMedia,
    });

    await this.whatsAppService.sendText(
      message.chatId,
      WHATSAPP_CHANNEL_DEPRECATED_MESSAGE,
    );
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
