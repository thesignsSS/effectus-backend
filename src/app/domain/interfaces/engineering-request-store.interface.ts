import type { UserRole } from './profile-store.interface.js';

export type EngineeringPropertyKind = 'Novo' | 'Usado' | 'Terreno';

export type EngineeringRequestStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface EngineeringRequestStatusInfo {
  status: EngineeringRequestStatus;
  statusLabel: string;
}

export interface EngineeringRequestStatusOption {
  value: EngineeringRequestStatus;
  label: string;
}

export const ENGINEERING_REQUEST_STATUS_OPTIONS: EngineeringRequestStatusOption[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em Andamento' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
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
  delete(
    input: DeleteEngineeringRequestInput,
  ): Promise<DeleteEngineeringRequestResult | null>;
}
