export interface ProposalDocumentInput {
  filename: string;
  originalFilename: string;
  storageLocation: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface CreateProposalInput {
  brokerUserId: string;
  brokerName: string;
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
  clientName?: string;
  clientCpf?: string;
  clientEmail?: string;
  clientPhone?: string;
  propertyType?: string;
  propertyCity?: string;
  propertyState?: string;
  additionalInfo?: string;
  formData?: Record<string, unknown>;
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
  brokerName: string;
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
  create(input: CreateProposalInput): Promise<{ id: string; proposalCode: string }>;
  update(input: UpdateProposalInput): Promise<void>;
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
