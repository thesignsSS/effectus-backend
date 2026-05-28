import { randomUUID } from 'node:crypto';

export interface RemittanceSession {
  id: string;
  chatId: string;
  clientName: string;
  brokerName: string;
  startedAt: string;
  additionalMessages: string[];
  documentReadings: RemittanceDocumentReading[];
}

export interface RemittanceDocumentReading {
  filename: string;
  originalName: string;
  extension: string;
  text: string;
  confidence?: number;
  receivedAt: string;
  visionInputs: RemittanceDocumentVisionInput[];
}

export interface RemittanceDocumentVisionInput {
  filename: string;
  mimeType: string;
  dataUrl: string;
}

export class RemittanceSessionService {
  private activeSession?: RemittanceSession;

  start(input: {
    chatId: string;
    clientName: string;
    brokerName: string;
  }): RemittanceSession {
    this.activeSession = {
      id: randomUUID(),
      chatId: input.chatId,
      clientName: input.clientName,
      brokerName: input.brokerName,
      startedAt: new Date().toISOString(),
      additionalMessages: [],
      documentReadings: [],
    };

    return this.activeSession;
  }

  finish(chatId: string): RemittanceSession | undefined {
    if (!this.activeSession || this.activeSession.chatId !== chatId) {
      return undefined;
    }

    const finishedSession = this.activeSession;
    this.activeSession = undefined;

    return finishedSession;
  }

  getActive(chatId: string): RemittanceSession | undefined {
    if (this.activeSession?.chatId !== chatId) {
      return undefined;
    }

    return this.activeSession;
  }

  addAdditionalMessage(chatId: string, text: string): RemittanceSession | undefined {
    const activeSession = this.getActive(chatId);

    if (!activeSession) {
      return undefined;
    }

    activeSession.additionalMessages.push(text);

    return activeSession;
  }

  addDocumentReading(
    chatId: string,
    reading: RemittanceDocumentReading,
  ): RemittanceSession | undefined {
    const activeSession = this.getActive(chatId);

    if (!activeSession) {
      return undefined;
    }

    activeSession.documentReadings.push(reading);

    return activeSession;
  }
}
