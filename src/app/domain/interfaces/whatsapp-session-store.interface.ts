export interface WhatsAppSessionStore {
  load(): Promise<Buffer | null>;
  save(snapshot: Buffer): Promise<void>;
  clear(): Promise<void>;
}
