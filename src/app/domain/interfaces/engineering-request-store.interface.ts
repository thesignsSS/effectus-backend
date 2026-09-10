import type { UserRole } from './profile-store.interface.js';

export type EngineeringPropertyKind = 'Novo' | 'Usado' | 'Terreno';

export type EngineeringRequestStatus =
  | 'solicitar_engenharia'
  | 'pendencia'
  | 'boleto_enviado'
  | 'ordem_servico'
  | 'engenharia_concluida';

export interface EngineeringRequestStatusInfo {
  status: EngineeringRequestStatus;
  statusLabel: string;
}

export interface EngineeringRequestStatusOption {
  value: EngineeringRequestStatus;
  label: string;
}

export const ENGINEERING_REQUEST_STATUS_OPTIONS: EngineeringRequestStatusOption[] = [
  { value: 'solicitar_engenharia', label: 'Solicitar Engenharia' },
  { value: 'pendencia', label: 'Pendência' },
  { value: 'boleto_enviado', label: 'Boleto Enviado' },
  { value: 'ordem_servico', label: 'OS (Ordem de Serviço)' },
  { value: 'engenharia_concluida', label: 'Engenharia Concluída' },
];

export function formatEngineeringRequestCode(requestNumber: number): string {
  return `ENG-${String(requestNumber).padStart(3, '0')}`;
}

export interface EngineeringRequestComment {
  id: string;
  authorName: string;
  authorUserId: string | null;
  authorRole: UserRole;
  createdAt: string;
  message: string;
  scope?: string;
}

export interface EngineeringRequestDocumentInput {
  documentKey: string;
  originalFilename: string;
  storageLocation: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface EngineeringRequestDocumentItem {
  id: string;
  documentKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName?: string;
}

export interface EngineeringRequestStoredDocument extends EngineeringRequestDocumentItem {
  storageLocation: string;
}

export interface CreateEngineeringRequestInput {
  brokerUserId: string;
  propertyKind: EngineeringPropertyKind;
  propertyValue: number;
  contactPhone: string;
  accompanyingName: string;
  formData: Record<string, unknown>;
  documents: EngineeringRequestDocumentInput[];
}

export interface EngineeringRequestListItem {
  id: string;
  requestCode: string;
  status: EngineeringRequestStatus;
  statusLabel: string;
  ownerBrokerUserId: string;
  ownerName: string;
  isOwnedByCurrentUser: boolean;
  accompanyingName: string;
  propertyKind: EngineeringPropertyKind;
  propertyValue: number;
  createdAt: string;
  documentsCount: number;
}

export interface EngineeringRequestListResult {
  items: EngineeringRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EngineeringRequestDetail {
  id: string;
  requestCode: string;
  status: EngineeringRequestStatus;
  statusLabel: string;
  ownerBrokerUserId: string;
  ownerName: string;
  isOwnedByCurrentUser: boolean;
  canEdit: boolean;
  canDelete: boolean;
  propertyKind: EngineeringPropertyKind;
  propertyValue: number;
  contactPhone: string;
  accompanyingName: string;
  createdAt: string;
  documents: EngineeringRequestDocumentItem[];
  comments: EngineeringRequestComment[];
}

export interface UpdateEngineeringRequestInput {
  requestId: string;
  brokerUserId: string;
  propertyKind?: EngineeringPropertyKind;
  propertyValue?: number;
  contactPhone?: string;
  accompanyingName?: string;
  status?: EngineeringRequestStatus;
  commentMessage?: string;
  commentScope?: string;
}

export interface AddEngineeringRequestDocumentsInput {
  requestId: string;
  brokerUserId: string;
  documents: EngineeringRequestDocumentInput[];
}

export interface DeleteEngineeringRequestInput {
  requestId: string;
  brokerUserId: string;
}

export interface DeleteEngineeringRequestResult {
  requestId: string;
  documentLocations: string[];
}

export interface EngineeringRequestStore {
  create(
    input: CreateEngineeringRequestInput,
  ): Promise<{ id: string; requestNumber: number }>;
  listByBroker(input: {
    brokerUserId: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<EngineeringRequestListResult>;
  getById(input: {
    brokerUserId: string;
    requestId: string;
  }): Promise<EngineeringRequestDetail | null>;
  update(
    input: UpdateEngineeringRequestInput,
  ): Promise<EngineeringRequestStatusInfo | undefined>;
  addDocuments(input: AddEngineeringRequestDocumentsInput): Promise<void>;
  getDocument(input: {
    requestId: string;
    brokerUserId: string;
    documentId: string;
  }): Promise<EngineeringRequestStoredDocument | null>;
  renameDocument(input: {
    requestId: string;
    brokerUserId: string;
    documentId: string;
    originalFilename: string;
  }): Promise<void>;
  deleteDocument(input: {
    requestId: string;
    brokerUserId: string;
    documentId: string;
  }): Promise<EngineeringRequestStoredDocument | null>;
  delete(
    input: DeleteEngineeringRequestInput,
  ): Promise<DeleteEngineeringRequestResult | null>;
}
