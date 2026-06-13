export interface IncomingMessage {
  id: string;
  chatId: string;
  sender: string;
  timestamp: Date;
  hasMedia: boolean;
  text?: string;
  originalFileName?: string;
  mimeType?: string;
  remittance?: {
    id: string;
    clientName: string;
    brokerName: string;
    startedAt: string;
  };
  downloadMedia(): Promise<Buffer>;
}

export interface MessagingProvider {
  connect(): Promise<void>;
  onDocumentReceived(handler: (message: IncomingMessage) => Promise<void>): void;
  sendText(chatId: string, text: string): Promise<void>;
  sendTextToConfiguredChat(text: string): Promise<void>;
  terminateSession(): Promise<void>;
}
