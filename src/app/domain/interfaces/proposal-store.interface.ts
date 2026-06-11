export interface ProposalDocumentInput {
  filename: string;
  originalFilename: string;
  storageLocation: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export type ProposalStatus =
  | 'em_analise'
  | 'pendente'
  | 'condicionado'
  | 'reprovado'
  | 'aprovado';

export interface ProposalStatusInfo {
  status: ProposalStatus;
  statusLabel: string;
}

export interface ProposalStatusOption {
  value: ProposalStatus;
  label: string;
}

export const PROPOSAL_STATUS_OPTIONS: ProposalStatusOption[] = [
  { value: 'em_analise', label: 'Em análise' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'condicionado', label: 'Condicionado' },
  { value: 'reprovado', label: 'Reprovado' },
  { value: 'aprovado', label: 'Aprovado' },
];

export interface CreateProposalInput {
  brokerUserId: string;
  brokerName: string;
  brokerPhone?: string;
  clientName: string;
  clientCpf?: string;
  clientEmail?: string;
  clientPhone?: string;
  propertyType?: string;
  propertyCity?: string;
  propertyState?: string;
  additionalInfo?: string;
  formData: Record<string, unknown>;
  documents: ProposalDocumentInput[];
}

export interface ProposalListItem {
  id: string;
  proposalCode: string;
  status: ProposalStatus;
  statusLabel: string;
  clientName: string;
  brokerName: string;
  propertyType: string;
  createdAt: string;
  documentsCount: number;
}

export interface ProposalDocument {
  id: string;
  filename: string;
  originalFilename: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  storageLocation: string;
}

export interface UpdateProposalInput {
  proposalId: string;
  brokerUserId: string;
  brokerPhone?: string;
  clientName?: string;
  clientCpf?: string;
  clientEmail?: string;
  clientPhone?: string;
  propertyType?: string;
  propertyCity?: string;
  propertyState?: string;
  additionalInfo?: string;
  formData?: Record<string, unknown>;
  status?: ProposalStatus;
}

export interface ProposalDocumentContext {
  proposalId: string;
  brokerUserId: string;
  brokerName: string;
  clientName: string;
}

export interface RenameProposalDocumentInput {
  brokerUserId: string;
  proposalId: string;
  documentId: string;
  displayName: string;
}

export interface DeleteProposalDocumentInput {
  brokerUserId: string;
  proposalId: string;
  documentId: string;
}

export interface ProposalDocumentLookup {
  id: string;
  originalFilename: string;
  storageLocation: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface ProposalDetail {
  id: string;
  proposalCode: string;
  status: ProposalStatus;
  statusLabel: string;
  brokerName: string;
  brokerPhone: string;
  createdAt: string;
  client: {
    name: string;
    cpf: string;
    phone: string;
    email: string;
  };
  property: {
    type: string;
    city: string;
    state: string;
  };
  additionalInfo: string;
  formData: Record<string, unknown>;
  documents: ProposalDocument[];
}

export interface ProposalListResult {
  items: ProposalListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<{ id: string; proposalCode: string } & ProposalStatusInfo>;
  update(input: UpdateProposalInput): Promise<ProposalStatusInfo | undefined>;
  listByBroker(input: {
    brokerUserId: string;
    ownerBrokerUserId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<ProposalListResult>;
  getById(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDetail | null>;
  getDocument(input: {
    brokerUserId: string;
    proposalId: string;
    documentId: string;
  }): Promise<ProposalDocumentLookup | null>;
  renameDocument(input: RenameProposalDocumentInput): Promise<void>;
  deleteDocument(input: DeleteProposalDocumentInput): Promise<ProposalDocumentLookup | null>;
  addDocuments(input: {
    brokerUserId: string;
    proposalId: string;
    documents: ProposalDocumentInput[];
  }): Promise<void>;
  getProposalContext(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDocumentContext | null>;
}
