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

  terminateSession(): Promise<void> {
    return this.messagingProvider.terminateSession();
  }

  async sendTextToPhone(phone: string, text: string): Promise<void> {
    const chatId = toWhatsAppChatId(phone);
    return this.messagingProvider.sendText(chatId, text);
  }
}

function toWhatsAppChatId(phone: string): string {
  const digits = phone.replace(/\D/g, '')

  if (!digits) {
    throw new Error('Número de WhatsApp do corretor não informado');
  }

  const normalizedDigits =
    digits.length === 10 || digits.length === 11 ? `55${digits}` : digits

  if (normalizedDigits.length < 12 || normalizedDigits.length > 13) {
    throw new Error('Número de WhatsApp do corretor inválido');
  }

  return `${normalizedDigits}@s.whatsapp.net`
}
