import type { UserRole } from './profile-store.interface.js';

export interface ProposalDocumentInput {
  filename: string;
  originalFilename: string;
  storageLocation: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByUserId?: string;
  documentScope?: ProposalDocumentScope;
}

export type ProposalDocumentScope =
  | 'proposal'
  | 'income_validation'
  | 'seller'
  | 'property';

export type ProposalCommentScope = ProposalDocumentScope | 'email';

export type ProposalCommentType =
  | 'comment'
  | 'pending_reason'
  | 'resubmission'
  | 'audit';

export interface ProposalComment {
  id: string;
  authorName: string;
  authorUserId?: string | null;
  authorAvatarPath?: string | null;
  authorRole: 'admin' | 'broker';
  createdAt: string;
  message: string;
  type: ProposalCommentType;
  scope: ProposalCommentScope;
}

export type ProposalStatus =
  | 'em_analise'
  | 'pendente'
  | 'condicionado'
  | 'reprovado'
  | 'aprovado'
  | 'validacao_renda'
  | 'renda_validada'
  | 'renda_nao_validada'
  | 'engenharia'
  | 'formularios'
  | 'aguardando_reserva'
  | 'conformidade'
  | 'agendamento_agencia'
  | 'itbi'
  | 'assinatura_contrato'
  | 'registro'
  | 'finalizado';

export interface ProposalStatusInfo {
  status: ProposalStatus;
  statusLabel: string;
}

export interface ProposalUpdateEffects {
  proposalId: string;
  proposalCode: string;
  brokerUserId: string;
  brokerName: string;
  brokerPhone: string;
  pendingReason: string;
  adminComment: string;
  actorUserId: string;
  actorRole: 'admin' | 'broker';
  actorName: string;
  statusChangedTo?: ProposalStatus;
  commentAdded: boolean;
  resubmittedForAnalysis: boolean;
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
  { value: 'validacao_renda', label: 'Validação de Renda' },
  { value: 'renda_validada', label: 'Renda Validada' },
  { value: 'renda_nao_validada', label: 'Renda Não Validada' },
  { value: 'engenharia', label: 'Engenharia' },
  { value: 'formularios', label: 'Formulários' },
  { value: 'aguardando_reserva', label: 'Aguardando Reserva' },
  { value: 'conformidade', label: 'Conformidade' },
  { value: 'agendamento_agencia', label: 'Agendamento na Agência' },
  { value: 'itbi', label: 'ITBI' },
  { value: 'assinatura_contrato', label: 'Assinatura de Contrato' },
  { value: 'registro', label: 'Registro' },
  { value: 'finalizado', label: 'Finalizado' },
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
  ownerBrokerUserId: string;
  ownerName: string;
  ownerAvatarPath: string | null;
  isOwnedByCurrentUser: boolean;
  isSharedWithCurrentUser: boolean;
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
  uploadedByUserId: string | null;
  uploadedByName: string;
  isUploadedByProposalOwner: boolean;
  storageLocation: string;
  documentScope: ProposalDocumentScope;
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
  pendingReason?: string;
  commentMessage?: string;
  commentScope?: ProposalCommentScope;
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
  uploadedByUserId: string | null;
  documentScope: ProposalDocumentScope;
  storageLocation: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DeleteProposalInput {
  brokerUserId: string;
  proposalId: string;
}

export interface DeleteProposalResult {
  proposalId: string;
  documentLocations: string[];
}

export interface ProposalGuest {
  userId: string;
  name: string;
  joinedAt: string;
}

export type ProposalInvitationStatus = 'pending' | 'accepted' | 'rejected';

export interface ProposalInvitation {
  id: string;
  proposalId: string;
  proposalCode: string;
  clientName: string;
  inviterUserId: string;
  inviterName: string;
  ownerBrokerUserId: string;
  ownerName: string;
  inviteeUserId: string;
  inviteeName: string;
  status: ProposalInvitationStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface ProposalShareLink {
  token: string;
  createdAt: string;
}

export interface ProposalSharePreview {
  proposalId: string;
  proposalCode: string;
  clientName: string;
  ownerBrokerUserId: string;
  ownerName: string;
  isOwnedByCurrentUser: boolean;
  isAlreadyAttached: boolean;
}

export interface AcceptProposalShareLinkResult {
  proposalId: string;
  proposalCode: string;
  ownerBrokerUserId: string;
  ownerName: string;
  guestName: string;
  alreadyAttached: boolean;
}

export interface ProposalDetail {
  id: string;
  proposalCode: string;
  status: ProposalStatus;
  statusLabel: string;
  ownerBrokerUserId: string;
  ownerName: string;
  ownerAvatarPath: string | null;
  isOwnedByCurrentUser: boolean;
  isSharedWithCurrentUser: boolean;
  canDeleteProposal: boolean;
  brokerName: string;
  brokerPhone: string;
  createdAt: string;
  pendingReason: string;
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
  comments: ProposalComment[];
  documents: ProposalDocument[];
  incomeValidationDocuments: ProposalDocument[];
  sellerDocuments: ProposalDocument[];
  propertyDocuments: ProposalDocument[];
  guests: ProposalGuest[];
  shareLinkToken: string | null;
  pendingInvitations: ProposalInvitation[];
}

export interface ProposalListResult {
  items: ProposalListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<{ id: string; proposalCode: string } & ProposalStatusInfo>;
  update(input: UpdateProposalInput): Promise<(ProposalStatusInfo & { effects?: ProposalUpdateEffects }) | undefined>;
  appendAuditComment(input: {
    proposalId: string;
    actorUserId: string;
    actorRole: UserRole;
    actorName: string;
    message: string;
    scope?: ProposalCommentScope;
  }): Promise<void>;
  countPendingByBroker(input: {
    brokerUserId: string;
  }): Promise<number>;
  listByBroker(input: {
    brokerUserId: string;
    ownerBrokerUserId?: string;
    search?: string;
    clientName?: string;
    brokerName?: string;
    proposalCode?: string;
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
  delete(input: DeleteProposalInput): Promise<DeleteProposalResult | null>;
  renameDocument(input: RenameProposalDocumentInput): Promise<void>;
  deleteDocument(input: DeleteProposalDocumentInput): Promise<ProposalDocumentLookup | null>;
  addDocuments(input: {
    brokerUserId: string;
    proposalId: string;
    documents: ProposalDocumentInput[];
    documentScope?: ProposalDocumentScope;
  }): Promise<void>;
  getProposalContext(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDocumentContext | null>;
  createShareLink(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalShareLink>;
  createInvitation(input: {
    brokerUserId: string;
    proposalId: string;
    inviteeUserId: string;
  }): Promise<ProposalInvitation>;
  listInvitationsByInvitee(input: {
    brokerUserId: string;
  }): Promise<ProposalInvitation[]>;
  countPendingInvitations(input: {
    brokerUserId: string;
  }): Promise<number>;
  respondToInvitation(input: {
    brokerUserId: string;
    invitationId: string;
    action: 'accept' | 'reject';
  }): Promise<ProposalInvitation | null>;
  getShareLinkPreview(input: {
    brokerUserId: string;
    token: string;
  }): Promise<ProposalSharePreview | null>;
  acceptShareLink(input: {
    brokerUserId: string;
    token: string;
  }): Promise<AcceptProposalShareLinkResult>;
  removeGuest(input: {
    brokerUserId: string;
    proposalId: string;
    guestUserId: string;
  }): Promise<boolean>;
}
