import {
  IncomingMessage,
  MessagingProvider,
} from '../domain/interfaces/messaging.interface.js';

export class WhatsAppService {
  constructor(private readonly messagingProvider: MessagingProvider) {}

  connect(): Promise<void> {
    return this.messagingProvider.connect();
  }

  onDocumentReceived(handler: (message: IncomingMessage) => Promise<void>): void {
    this.messagingProvider.onDocumentReceived(handler);
  }

  sendText(chatId: string, text: string): Promise<void> {
    return this.messagingProvider.sendText(chatId, text);
  }

  sendTextToConfiguredChat(text: string): Promise<void> {
    return this.messagingProvider.sendTextToConfiguredChat(text);
  }
}
