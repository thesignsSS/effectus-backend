export type WhatsAppConnectionStatus =
  | 'waiting_qr'
  | 'connected'
  | 'disconnected';

export interface DashboardDocument {
  id: string;
  originalName: string;
  filename: string;
  extension: string;
  sender: string;
  location: string;
  receivedAt: string;
}

export interface DashboardPresenter {
  updateConnectionStatus(status: WhatsAppConnectionStatus): void;
  addDocument(document: DashboardDocument): void;
}
