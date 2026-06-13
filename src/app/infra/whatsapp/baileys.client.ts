import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  proto,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { FileExtension } from '../../domain/constants/file.constants.js';
import { DashboardPresenter } from '../../domain/interfaces/dashboard.interface.js';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import {
  IncomingMessage,
  MessagingProvider,
} from '../../domain/interfaces/messaging.interface.js';
import { QrCodePresenter } from '../../domain/interfaces/qr-code-presenter.interface.js';

type MessageHandler = (message: IncomingMessage) => Promise<void>;
type WhatsAppSocket = ReturnType<typeof makeWASocket>;

export interface BaileysClientConfig {
  sessionDir: string;
  allowedChatName: string;
  allowedChatId?: string;
}

export class BaileysClient implements MessagingProvider {
  private handlers: MessageHandler[] = [];
  private socket?: WhatsAppSocket;
  private readonly groupNameCache = new Map<string, string>();
  private readonly sentMessageIds = new Set<string>();

  constructor(
    private readonly config: BaileysClientConfig,
    private readonly logger: Logger,
    private readonly qrCodePresenter: QrCodePresenter,
    private readonly dashboardPresenter?: DashboardPresenter,
  ) {}

  onDocumentReceived(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.config.sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 120_000,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.dashboardPresenter?.updateConnectionStatus('waiting_qr');
        this.qrCodePresenter.show(qr);
      }

      if (connection === 'open') {
        this.dashboardPresenter?.updateConnectionStatus('connected');
        this.logger.info('WhatsApp conectado');
        void this.logParticipatingGroups();
      }

      if (connection === 'close') {
        const statusCode = this.getDisconnectStatusCode(lastDisconnect?.error);
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.dashboardPresenter?.updateConnectionStatus('disconnected');

        this.logger.warn('Conexão WhatsApp encerrada', {
          statusCode,
          shouldReconnect,
        });

        if (shouldReconnect) {
          void this.connect();
        }
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      this.logger.info('Pacote de mensagens recebido do WhatsApp', {
        type,
        count: messages.length,
      });

      for (const message of messages) {
        this.logger.info('Mensagem bruta recebida', {
          messageId: message.key.id,
          remoteJid: message.key.remoteJid,
          destinationJid: message.message?.deviceSentMessage?.destinationJid,
          participant: message.key.participant,
          fromMe: message.key.fromMe,
          messageType: this.getMessageType(message),
        });

        const incoming = await this.toIncomingMessage(message);

        if (!incoming) {
          continue;
        }

        await Promise.all(this.handlers.map((handler) => handler(incoming)));
      }
    });
  }

  async sendText(chatId: string, text: string): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp socket is not connected');
    }

    let targetChatId = chatId;

    if (this.isDirectChat(chatId)) {
      targetChatId = await this.resolveDirectRecipientChatId(chatId);
    }

    const messageId = `bot_${randomUUID().replace(/-/g, '')}`;
    this.sentMessageIds.add(messageId);

    try {
      await this.socket.sendMessage(targetChatId, { text }, { messageId });
      this.logger.info('Mensagem enviada pelo WhatsApp', {
        chatId: targetChatId,
        originalChatId: chatId,
        messageId,
        directMessage: this.isDirectChat(chatId),
      });
    } catch (error) {
      this.sentMessageIds.delete(messageId);
      throw error;
    }
  }

  async sendTextToConfiguredChat(text: string): Promise<void> {
    const chatId = await this.getConfiguredChatId();
    await this.sendText(chatId, text);
  }

  async terminateSession(): Promise<void> {
    this.logger.warn('Encerrando sessão do WhatsApp manualmente');

    try {
      await this.socket?.logout();
    } catch (error) {
      this.logger.warn('Falha ao fazer logout do WhatsApp antes de limpar a sessão', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      this.socket?.end(new Error('Sessão encerrada manualmente'));
    } catch (error) {
      this.logger.warn('Falha ao encerrar socket do WhatsApp', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.socket = undefined;
    this.groupNameCache.clear();
    this.sentMessageIds.clear();
    this.qrCodePresenter.clear();
    this.dashboardPresenter?.updateConnectionStatus('disconnected');

    await rm(this.config.sessionDir, { recursive: true, force: true }).catch((error) => {
      this.logger.warn('Falha ao limpar diretório da sessão do WhatsApp', {
        sessionDir: this.config.sessionDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    await this.connect();
  }

  private async toIncomingMessage(message: WAMessage): Promise<IncomingMessage | null> {
    if (message.key.id && this.sentMessageIds.delete(message.key.id)) {
      this.logger.info('Mensagem ignorada porque foi enviada automaticamente pelo bot', {
        messageId: message.key.id,
        chatId: message.key.remoteJid,
      });
      return null;
    }

    const content = this.unwrapMessageContent(message.message);
    const documentMessage = content?.documentMessage;
    const imageMessage = content?.imageMessage;
    const mediaMessage = documentMessage ?? imageMessage;
    const chatId = this.getChatId(message);

    if (!chatId || this.shouldIgnoreSender(chatId)) {
      this.logger.info('Mensagem ignorada por remetente inválido', {
        messageId: message.key.id,
        chatId,
      });
      return null;
    }

    const allowedChat = await this.isAllowedChat(chatId);

    if (!allowedChat.allowed) {
      this.logger.info('Mensagem ignorada por chat não permitido', {
        messageId: message.key.id,
        chatId,
        reason: allowedChat.reason,
        groupName: allowedChat.groupName,
        allowedChatName: this.config.allowedChatName,
      });
      return null;
    }

    const text = this.extractText(content);
    this.logger.info('Mensagem aceita para processamento', {
      messageId: message.key.id,
      chatId,
      hasMedia: Boolean(mediaMessage),
      hasText: Boolean(text),
    });

    if (!mediaMessage) {
      if (!text) {
        this.logger.info('Mensagem ignorada sem texto ou mídia', {
          messageId: message.key.id,
          chatId,
        });
        return null;
      }

      return {
        id: message.key.id ?? randomUUID(),
        chatId,
        sender: this.getSender(message, chatId),
        timestamp: this.getMessageTimestamp(message),
        hasMedia: false,
        text,
        downloadMedia: async () => Buffer.alloc(0),
      };
    }

    if (!mediaMessage.mediaKey) {
      this.logger.warn('Mídia ignorada sem chave para download', {
        messageId: message.key.id,
        sender: this.getSender(message, chatId),
      });
      return null;
    }

    const originalFileName =
      documentMessage?.fileName ??
      imageMessage?.caption ??
      this.defaultFileName(mediaMessage.mimetype ?? undefined, message.key.id ?? undefined);

    return {
      id: message.key.id ?? randomUUID(),
      chatId,
      sender: this.getSender(message, chatId),
      timestamp: this.getMessageTimestamp(message),
      hasMedia: true,
      text,
      originalFileName,
      mimeType: mediaMessage.mimetype ?? undefined,
      downloadMedia: async () => {
        const media = await downloadMediaMessage(message, 'buffer', {});

        if (!Buffer.isBuffer(media)) {
          throw new Error('Baileys did not return media as a buffer');
        }

        return media;
      },
    };
  }

  private isDirectChat(chatId: string): boolean {
    return chatId.endsWith('@s.whatsapp.net');
  }

  private async resolveDirectRecipientChatId(chatId: string): Promise<string> {
    if (!this.socket) {
      throw new Error('WhatsApp socket is not connected');
    }

    const digits = chatId.split('@')[0]?.replace(/\D/g, '') ?? '';
    const lookup = await this.socket.onWhatsApp(chatId, digits);
    const recipient =
      lookup?.find((entry) => this.isSameWhatsAppUser(entry.jid, chatId)) ??
      lookup?.find((entry) => entry.exists) ??
      null;

    if (!recipient?.exists) {
      this.logger.warn('Número do corretor não pôde ser validado antes do envio no WhatsApp', {
        chatId,
        digits,
        lookupCount: lookup?.length ?? 0,
      });
      return chatId;
    }

    return recipient.jid || chatId;
  }

  private isSameWhatsAppUser(left: string | undefined, right: string): boolean {
    if (!left) {
      return false;
    }

    return left.split('@')[0] === right.split('@')[0];
  }

  private getSender(message: WAMessage, chatId: string): string {
    if (message.key.fromMe) {
      return this.socket?.user?.id ?? message.key.participant ?? chatId;
    }

    return message.key.participant ?? chatId;
  }

  private getChatId(message: WAMessage): string | null | undefined {
    return message.message?.deviceSentMessage?.destinationJid ?? message.key.remoteJid;
  }

  private getMessageTimestamp(message: WAMessage): Date {
    return new Date(
      Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    );
  }

  private extractText(content: proto.IMessage | undefined): string | undefined {
    return (
      content?.conversation ??
      content?.extendedTextMessage?.text ??
      content?.documentMessage?.caption ??
      content?.imageMessage?.caption ??
      undefined
    );
  }

  private async isAllowedChat(chatId: string): Promise<{
    allowed: boolean;
    reason?: string;
    groupName?: string;
  }> {
    if (this.config.allowedChatId && chatId === this.config.allowedChatId) {
      return {
        allowed: true,
        reason: 'chat_id_match',
      };
    }

    if (!chatId.endsWith('@g.us')) {
      return {
        allowed: false,
        reason: this.config.allowedChatId ? 'chat_id_mismatch' : 'not_group',
      };
    }

    const groupName = await this.getGroupName(chatId);

    const allowed =
      this.normalizeChatName(groupName) ===
      this.normalizeChatName(this.config.allowedChatName);

    return {
      allowed,
      reason: allowed ? undefined : 'group_name_mismatch',
      groupName,
    };
  }

  private async getGroupName(chatId: string): Promise<string | undefined> {
    const cachedName = this.groupNameCache.get(chatId);

    if (cachedName) {
      return cachedName;
    }

    if (!this.socket) {
      return undefined;
    }

    try {
      const metadata = await this.socket.groupMetadata(chatId);
      this.groupNameCache.set(chatId, metadata.subject);
      return metadata.subject;
    } catch (error) {
      this.logger.warn('Não foi possível ler o nome do grupo', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async getConfiguredChatId(): Promise<string> {
    if (this.config.allowedChatId) {
      return this.config.allowedChatId;
    }

    if (!this.socket) {
      throw new Error('WhatsApp socket is not connected');
    }

    const groups = await this.socket.groupFetchAllParticipating();
    const group = Object.values(groups).find(
      (candidate) =>
        this.normalizeChatName(candidate.subject) ===
        this.normalizeChatName(this.config.allowedChatName),
    );

    if (!group) {
      throw new Error(
        `Grupo configurado não encontrado: ${this.config.allowedChatName}`,
      );
    }

    this.groupNameCache.set(group.id, group.subject);
    return group.id;
  }

  private normalizeChatName(chatName?: string): string {
    return (chatName ?? '').trim().toLowerCase();
  }

  private async logParticipatingGroups(): Promise<void> {
    if (!this.socket) {
      return;
    }

    try {
      const groups = await this.socket.groupFetchAllParticipating();
      const groupList = Object.values(groups)
        .map((group) => ({
          id: group.id,
          subject: group.subject,
          matchesAllowed:
            this.normalizeChatName(group.subject) ===
            this.normalizeChatName(this.config.allowedChatName),
        }))
        .sort((left, right) => left.subject.localeCompare(right.subject));

      this.logger.info('Grupos carregados pelo WhatsApp', {
        allowedChatName: this.config.allowedChatName,
        allowedChatId: this.config.allowedChatId,
        count: groupList.length,
        groups: groupList,
      });
    } catch (error) {
      this.logger.warn('Não foi possível listar grupos do WhatsApp', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getMessageType(message: WAMessage): string | undefined {
    const content = this.unwrapMessageContent(message.message);

    return content ? Object.keys(content)[0] : undefined;
  }

  private unwrapMessageContent(
    content: proto.IMessage | null | undefined,
  ): proto.IMessage | undefined {
    let unwrappedContent = content ?? undefined;

    while (
      unwrappedContent?.ephemeralMessage?.message ||
      unwrappedContent?.viewOnceMessage?.message ||
      unwrappedContent?.viewOnceMessageV2?.message ||
      unwrappedContent?.documentWithCaptionMessage?.message ||
      unwrappedContent?.deviceSentMessage?.message
    ) {
      unwrappedContent =
        unwrappedContent.ephemeralMessage?.message ??
        unwrappedContent.viewOnceMessage?.message ??
        unwrappedContent.viewOnceMessageV2?.message ??
        unwrappedContent.documentWithCaptionMessage?.message ??
        unwrappedContent.deviceSentMessage?.message ??
        unwrappedContent;
    }

    return unwrappedContent;
  }

  private defaultFileName(mimeType?: string, messageId?: string | null): string {
    const suffix = messageId ? `_${messageId.replace(/[^\w-]+/g, '').slice(-10)}` : '';

    if (mimeType === 'image/jpeg') {
      return `image${suffix}.${FileExtension.JPG}`;
    }

    if (mimeType === 'application/pdf') {
      return `document${suffix}.${FileExtension.PDF}`;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return `document${suffix}.${FileExtension.XLSX}`;
    }

    return 'document.bin';
  }

  private shouldIgnoreSender(sender: string): boolean {
    return sender.endsWith('@newsletter') || sender === 'status@broadcast';
  }

  private getDisconnectStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const output = (error as { output?: unknown }).output;

    if (!output || typeof output !== 'object') {
      return undefined;
    }

    const statusCode = (output as { statusCode?: unknown }).statusCode;

    return typeof statusCode === 'number' ? statusCode : undefined;
  }
}
