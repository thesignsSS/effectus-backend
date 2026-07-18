import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  AcceptProposalShareLinkResult,
  CreateProposalInput,
  DeleteProposalInput,
  DeleteProposalResult,
  DeleteProposalDocumentInput,
  ProposalComment,
  ProposalCommentType,
  ProposalDetail,
  ProposalDocumentContext,
  ProposalDocumentLookup,
  ProposalDocumentScope,
  ProposalGuest,
  ProposalInvitation,
  ProposalInvitationStatus,
  ProposalListItem,
  ProposalListResult,
  ProposalShareLink,
  ProposalSharePreview,
  ProposalStore,
  ProposalStatus,
  ProposalStatusInfo,
  PROPOSAL_STATUS_OPTIONS,
  ProposalUpdateEffects,
  RenameProposalDocumentInput,
  UpdateProposalInput,
} from '../../domain/interfaces/proposal-store.interface.js';

export interface SupabaseProposalStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type UserRole = 'admin' | 'broker';

type ProposalRow = {
  id: string;
  proposal_number: number;
  broker_user_id: string;
  status: ProposalStatus | null;
  broker_name: string | null;
  broker_phone: string | null;
  client_name: string | null;
  client_cpf: string | null;
  client_email: string | null;
  client_phone: string | null;
  property_type: string | null;
  property_city: string | null;
  property_state: string | null;
  additional_info: string | null;
  pending_reason: string | null;
  proposal_comments: unknown;
  form_data: Record<string, unknown> | null;
  created_at: string;
};

type ProposalCollaboratorRow = {
  proposal_id: string;
  user_id: string;
  created_at: string;
};

type ProposalDocumentRow = {
  id: string;
  filename: string;
  original_filename: string;
  storage_location: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by_user_id: string | null;
  document_scope: ProposalDocumentScope | null;
};

type ProposalShareLinkRow = {
  proposal_id: string;
  token: string;
  created_by_user_id: string;
  created_at: string;
  revoked_at: string | null;
};

type ProposalInvitationRow = {
  id: string;
  proposal_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: ProposalInvitationStatus;
  created_at: string;
  responded_at: string | null;
};

type ResolvedProposalAccess = {
  proposalId: string;
  ownerBrokerUserId: string;
  ownerName: string;
  isAdmin: boolean;
  isOwner: boolean;
  isCollaborator: boolean;
};

type IncomeValidationData = {
  finalized?: boolean;
};

type ProposalUpdateContextRow = Pick<
  ProposalRow,
  | 'status'
  | 'proposal_comments'
  | 'broker_name'
  | 'broker_phone'
  | 'client_name'
  | 'client_cpf'
  | 'client_email'
  | 'client_phone'
  | 'property_type'
  | 'property_city'
  | 'property_state'
  | 'additional_info'
  | 'form_data'
> & {
  proposalCode: string;
  broker_user_id: string;
};

export class SupabaseProposalStore implements ProposalStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseProposalStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to save proposals',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async create(input: CreateProposalInput): Promise<{ id: string; proposalCode: string } & ProposalStatusInfo> {
    const { data: proposal, error: proposalError } = await this.client
      .from('proposals')
      .insert({
        broker_user_id: input.brokerUserId,
        status: 'em_analise',
        broker_name: input.brokerName,
        broker_phone: input.brokerPhone ?? null,
        client_name: input.clientName,
        client_cpf: input.clientCpf ?? null,
        client_email: input.clientEmail ?? null,
        client_phone: input.clientPhone ?? null,
        property_type: input.propertyType ?? null,
        property_city: input.propertyCity ?? null,
        property_state: input.propertyState ?? null,
        additional_info: input.additionalInfo ?? null,
        form_data: input.formData,
      })
      .select('id, proposal_number, status')
      .single();

    if (proposalError || !proposal) {
      throw new Error(`Supabase proposal create failed: ${proposalError?.message ?? 'unknown error'}`);
    }

    if (input.documents.length > 0) {
      const { error: documentsError } = await this.client.from('proposal_documents').insert(
        input.documents.map((document) => ({
          proposal_id: proposal.id,
          filename: document.filename,
          original_filename: document.originalFilename,
          storage_location: document.storageLocation,
          content_type: document.contentType,
          size_bytes: document.sizeBytes,
          uploaded_at: document.uploadedAt,
          uploaded_by_user_id: document.uploadedByUserId ?? input.brokerUserId,
          document_scope: document.documentScope ?? 'proposal',
        })),
      );

      if (documentsError) {
        throw new Error(`Supabase proposal documents create failed: ${documentsError.message}`);
      }
    }

    return {
      id: proposal.id,
      proposalCode: formatProposalCode(proposal.proposal_number),
      ...toStatusInfo(proposal.status),
    };
  }

  async update(input: UpdateProposalInput): Promise<(ProposalStatusInfo & { effects?: ProposalUpdateEffects }) | undefined> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);
    const currentProposal = await this.getProposalForUpdate(input.proposalId);
    const payload: Record<string, unknown> = {};

    if (!proposalAccess || !currentProposal) {
      throw new Error('Proposta não encontrada');
    }

    if (input.clientName !== undefined) payload.client_name = input.clientName;
    if (input.brokerPhone !== undefined) payload.broker_phone = input.brokerPhone;
    if (input.clientCpf !== undefined) payload.client_cpf = input.clientCpf;
    if (input.clientEmail !== undefined) payload.client_email = input.clientEmail;
    if (input.clientPhone !== undefined) payload.client_phone = input.clientPhone;
    if (input.propertyType !== undefined) payload.property_type = input.propertyType;
    if (input.propertyCity !== undefined) payload.property_city = input.propertyCity;
    if (input.propertyState !== undefined) payload.property_state = input.propertyState;
    if (input.additionalInfo !== undefined) payload.additional_info = input.additionalInfo;
    if (input.formData !== undefined) payload.form_data = input.formData;
    if (input.pendingReason !== undefined && !access.isAdmin) {
      throw new Error('Apenas admin pode registrar o motivo da pendência');
    }

    const currentStatus = toStatusInfo(currentProposal.status).status;
    this.assertBrokerCanModifyProposal(access, currentStatus, currentProposal, input);
    const nextStatus = input.status;
    const nextComments = normalizeProposalComments(currentProposal.proposal_comments);
    const trimmedPendingReason = input.pendingReason?.trim() ?? '';
    const trimmedCommentMessage = input.commentMessage?.trim() ?? '';
    const updatedFieldChanges = collectUpdatedFieldChanges(currentProposal, input);
    const incomeValidationAuditMessage = resolveIncomeValidationAuditMessage(
      currentProposal.form_data,
      input.formData,
    );
    let commentAdded = false;
    let resubmittedForAnalysis = false;

    if (nextStatus !== undefined) {
      if (access.isAdmin) {
        if (nextStatus === 'pendente') {
          const pendingReason = trimmedPendingReason;

          if (!pendingReason) {
            throw new Error('Informe o motivo da pendência');
          }

          payload.pending_reason = pendingReason;
          nextComments.push(
            buildProposalComment({
              authorName: getAccessDisplayName(access),
              authorUserId: input.brokerUserId,
              authorRole: access.role,
              message: pendingReason,
              type: 'pending_reason',
            }),
          );
        } else if (currentStatus === 'pendente') {
          payload.pending_reason = null;
        }
      } else {
        const canResubmit = currentStatus === 'pendente' && nextStatus === 'em_analise';
        const canAdvanceToIncomeValidation =
          currentStatus === 'aprovado' && nextStatus === 'validacao_renda';

        if (!canResubmit && !canAdvanceToIncomeValidation) {
          throw new Error('Apenas admin pode alterar o status da proposta');
        }

        if (canResubmit) {
          payload.pending_reason = null;
          nextComments.push(
            buildProposalComment({
              authorName: getAccessDisplayName(access),
              authorUserId: input.brokerUserId,
              authorRole: access.role,
              message: trimmedCommentMessage || 'Proposta reenviada para análise.',
              type: 'resubmission',
            }),
          );
          resubmittedForAnalysis = true;
        }
      }

      payload.status = nextStatus;

      if (nextStatus !== currentStatus) {
        nextComments.push(
          buildProposalComment({
            authorName: getAccessDisplayName(access),
            authorUserId: input.brokerUserId,
            authorRole: access.role,
            message: `Etapa da proposta alterada: de "${toStatusInfo(currentStatus).statusLabel}" para "${toStatusInfo(nextStatus).statusLabel}".`,
            type: 'audit',
          }),
        );
      }
    }

    if (trimmedCommentMessage) {
      const shouldAppendStandaloneComment = !(
        !access.isAdmin &&
        currentStatus === 'pendente' &&
        nextStatus === 'em_analise'
      );

      if (shouldAppendStandaloneComment) {
        nextComments.push(
          buildProposalComment({
            authorName: getAccessDisplayName(access),
            authorUserId: input.brokerUserId,
            authorRole: access.role,
            message: trimmedCommentMessage,
            type: 'comment',
            scope: input.commentScope ?? 'proposal',
          }),
        );
        commentAdded = true;
      }
    }

    if (updatedFieldChanges.length > 0) {
      nextComments.push(
        buildProposalComment({
          authorName: getAccessDisplayName(access),
          authorUserId: input.brokerUserId,
          authorRole: access.role,
          message: buildProposalAuditMessage(updatedFieldChanges),
          type: 'audit',
        }),
      );
    }

    if (incomeValidationAuditMessage) {
      nextComments.push(
        buildProposalComment({
          authorName: getAccessDisplayName(access),
          authorUserId: input.brokerUserId,
          authorRole: access.role,
          message: incomeValidationAuditMessage,
          type: 'audit',
          scope: 'income_validation',
        }),
      );
    }

    if (nextComments.length > 0) {
      payload.proposal_comments = nextComments;
    }

    if (Object.keys(payload).length === 0) {
      return undefined;
    }

    const { data, error } = await this.client
      .from('proposals')
      .update(payload)
      .eq('id', input.proposalId)
      .select('status')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Proposta não encontrada');
      }

      throw new Error(`Supabase proposal update failed: ${error.message}`);
    }

    const statusInfo =
      input.status !== undefined
        ? toStatusInfo(data.status)
        : toStatusInfo(currentProposal.status);

    return {
      ...statusInfo,
      effects: {
        proposalId: input.proposalId,
        proposalCode: currentProposal.proposalCode,
        brokerUserId: currentProposal.broker_user_id,
        brokerName: currentProposal.broker_name ?? 'Corretor',
        brokerPhone: input.brokerPhone ?? currentProposal.broker_phone ?? '',
        pendingReason: nextStatus === 'pendente' ? trimmedPendingReason : '',
        adminComment: access.isAdmin ? trimmedCommentMessage : '',
        actorUserId: input.brokerUserId,
        actorRole: access.role,
        actorName: getAccessDisplayName(access),
        statusChangedTo: nextStatus,
        commentAdded,
        resubmittedForAnalysis,
      },
    };
  }

  async listByBroker(input: {
    brokerUserId: string;
    ownerBrokerUserId?: string;
    search?: string;
    clientName?: string;
    brokerName?: string;
    proposalCode?: string;
    page: number;
    pageSize: number;
  }): Promise<ProposalListResult> {
    const access = await this.resolveAccess(input.brokerUserId);
    const sharedProposalIds = access.isAdmin
      ? []
      : await this.listSharedProposalIds(input.brokerUserId);
    const accessibleProposalIds = access.isAdmin
      ? []
      : await this.listAccessibleProposalIds(input.brokerUserId);
    const from = (input.page - 1) * input.pageSize;
    const to = from + input.pageSize - 1;
    let query = this.client
      .from('proposals')
      .select(
        'id, proposal_number, broker_user_id, status, broker_name, client_name, property_type, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (access.isAdmin) {
      if (input.ownerBrokerUserId) {
        query = query.eq('broker_user_id', input.ownerBrokerUserId);
      }
    } else {
      if (accessibleProposalIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: input.page,
          pageSize: input.pageSize,
        };
      }

      query = query.in('id', accessibleProposalIds);

      if (input.ownerBrokerUserId) {
        query = query.eq('broker_user_id', input.ownerBrokerUserId);
      }
    }

    const normalizedSearch = input.search?.trim();
    if (normalizedSearch) {
      const escapedSearch = escapeLike(normalizeSearchText(normalizedSearch));
      const proposalNumber = parseProposalNumber(normalizedSearch);
      const filters = [
        `client_name_search.ilike.%${escapedSearch}%`,
        `broker_name_search.ilike.%${escapedSearch}%`,
      ];

      if (proposalNumber) {
        filters.push(`proposal_number.eq.${proposalNumber}`);
      }

      query = query.or(
        filters.join(','),
      );
    }

    const normalizedClientName = input.clientName?.trim();
    if (normalizedClientName) {
      query = query.ilike(
        'client_name_search',
        `%${escapeLike(normalizeSearchText(normalizedClientName))}%`,
      );
    }

    const normalizedBrokerName = input.brokerName?.trim();
    if (normalizedBrokerName) {
      query = query.ilike(
        'broker_name_search',
        `%${escapeLike(normalizeSearchText(normalizedBrokerName))}%`,
      );
    }

    const normalizedProposalCode = input.proposalCode?.trim();
    if (normalizedProposalCode) {
      const proposalNumber = parseProposalNumber(normalizedProposalCode);

      if (proposalNumber !== null) {
        query = query.eq('proposal_number', proposalNumber);
      } else {
        query = query.eq('proposal_number', -1);
      }
    }

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Supabase proposals list failed: ${error.message}`);
    }

    const rows = ((data as Array<
      Pick<ProposalRow, 'id' | 'proposal_number' | 'broker_user_id' | 'status' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'>
    > | null) ?? []);
    const proposalDocumentsCountByProposalId = await this.getProposalDocumentCountsByProposalIds(
      rows.map((item) => item.id),
      'proposal',
    );
    const ownerAvatarPaths = await this.getProfileAvatarPathsByIds(
      rows.map((item) => item.broker_user_id),
    );
    const sharedProposalIdsSet = new Set(sharedProposalIds);
    const items = rows.map((item) =>
      this.toProposalListItem(
        item,
        proposalDocumentsCountByProposalId.get(item.id) ?? 0,
        input.brokerUserId,
        sharedProposalIdsSet,
        ownerAvatarPaths.get(item.broker_user_id) ?? null,
      ),
    );

    return {
      items,
      total: count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async countPendingByBroker(input: { brokerUserId: string }): Promise<number> {
    const access = await this.resolveAccess(input.brokerUserId);
    const accessibleProposalIds = access.isAdmin
      ? []
      : await this.listAccessibleProposalIds(input.brokerUserId);
    let query = this.client
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente');

    if (!access.isAdmin) {
      if (accessibleProposalIds.length === 0) {
        return 0;
      }

      query = query.in('id', accessibleProposalIds);
    }

    const { count, error } = await query;

    if (error) {
      throw new Error(`Supabase pending proposals count failed: ${error.message}`);
    }

    return count ?? 0;
  }

  async getById(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDetail | null> {
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);

    if (!proposalAccess) {
      return null;
    }

    const { data, error } = await this.client
      .from('proposals')
      .select(`
        id,
        proposal_number,
        broker_user_id,
        status,
        broker_name,
        broker_phone,
        client_name,
        client_cpf,
        client_email,
        client_phone,
        property_type,
        property_city,
        property_state,
        additional_info,
        pending_reason,
        proposal_comments,
        form_data,
        created_at,
        proposal_documents (
          id,
          filename,
          original_filename,
          storage_location,
          content_type,
          size_bytes,
          uploaded_at,
          uploaded_by_user_id,
          document_scope
        )
      `)
      .eq('id', input.proposalId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal get failed: ${error.message}`);
    }

    return this.toProposalDetail(
      data as ProposalRow & { proposal_documents?: ProposalDocumentRow[] | null },
      proposalAccess,
    );
  }

  async getDocument(input: {
    brokerUserId: string;
    proposalId: string;
    documentId: string;
  }): Promise<ProposalDocumentLookup | null> {
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);

    if (!proposalAccess) {
      return null;
    }

    const { data, error } = await this.client
      .from('proposal_documents')
      .select(`
        id,
        filename,
        original_filename,
        storage_location,
        content_type,
        size_bytes,
        uploaded_at,
        uploaded_by_user_id,
        document_scope,
        proposals!inner (
          id,
          broker_user_id
        )
      `)
      .eq('id', input.documentId)
      .eq('proposal_id', input.proposalId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal document get failed: ${error.message}`);
    }

    return this.toDocumentLookup(data as ProposalDocumentRow);
  }

  async renameDocument(input: RenameProposalDocumentInput): Promise<void> {
    const access = await this.resolveAccess(input.brokerUserId);
    const document = await this.getDocument(input);
    if (!document) {
      throw new Error('Documento da proposta não encontrado');
    }

    const { error } = await this.client
      .from('proposal_documents')
      .update({
        original_filename: input.displayName,
      })
      .eq('id', input.documentId)
      .eq('proposal_id', input.proposalId);

    if (error) {
      throw new Error(`Supabase proposal document rename failed: ${error.message}`);
    }

    await this.appendProposalAuditComment(
      input.proposalId,
      input.brokerUserId,
      access,
      `Documento renomeado: "${document.originalFilename}" -> "${input.displayName}".`,
      document.documentScope,
    );
  }

  async deleteDocument(
    input: DeleteProposalDocumentInput,
  ): Promise<ProposalDocumentLookup | null> {
    const access = await this.resolveAccess(input.brokerUserId);
    const document = await this.getDocument(input);
    const proposal = await this.getProposalForUpdate(input.proposalId);
    if (!document) {
      return null;
    }
    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    const uploadedByUserId = document.uploadedByUserId ?? proposal.broker_user_id;

    if (!access.isAdmin && uploadedByUserId !== input.brokerUserId) {
      throw new Error('Sem permissão para excluir documentos enviados por outro usuário.');
    }

    const { error } = await this.client
      .from('proposal_documents')
      .delete()
      .eq('id', input.documentId)
      .eq('proposal_id', input.proposalId);

    if (error) {
      throw new Error(`Supabase proposal document delete failed: ${error.message}`);
    }

    await this.appendProposalAuditComment(
      input.proposalId,
      input.brokerUserId,
      access,
      `Documento excluído: "${document.originalFilename}".`,
      document.documentScope,
    );

    return document;
  }

  async delete(input: DeleteProposalInput): Promise<DeleteProposalResult | null> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);
    const proposalForUpdate = await this.getProposalForUpdate(input.proposalId);

    if (!proposalAccess || (!access.isAdmin && !proposalAccess.isOwner)) {
      return null;
    }
    if (!proposalForUpdate) {
      return null;
    }

    this.assertBrokerCanModifyProposal(
      access,
      toStatusInfo(proposalForUpdate.status).status,
      proposalForUpdate,
      {
        proposalId: input.proposalId,
        brokerUserId: input.brokerUserId,
        formData: undefined,
      },
      true,
    );

    let query = this.client
      .from('proposals')
      .select(`
        id,
        broker_user_id,
        proposal_documents (
          storage_location
        )
      `)
      .eq('id', input.proposalId);

    if (!access.isAdmin) {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal delete lookup failed: ${error.message}`);
    }

    const documentLocations =
      ((data.proposal_documents as Array<{ storage_location: string | null }> | null) ?? [])
        .map((item) => item.storage_location?.trim() ?? '')
        .filter(Boolean);

    let deleteQuery = this.client.from('proposals').delete().eq('id', input.proposalId);

    if (!access.isAdmin) {
      deleteQuery = deleteQuery.eq('broker_user_id', input.brokerUserId);
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      throw new Error(`Supabase proposal delete failed: ${deleteError.message}`);
    }

    return {
      proposalId: input.proposalId,
      documentLocations,
    };
  }

  async addDocuments(input: {
    brokerUserId: string;
    proposalId: string;
    documents: CreateProposalInput['documents'];
    documentScope?: ProposalDocumentScope;
  }): Promise<void> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposal = await this.getProposalContext({
      brokerUserId: input.brokerUserId,
      proposalId: input.proposalId,
    });

    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    const { error } = await this.client.from('proposal_documents').insert(
      input.documents.map((document) => ({
        proposal_id: input.proposalId,
        filename: document.filename,
        original_filename: document.originalFilename,
        storage_location: document.storageLocation,
        content_type: document.contentType,
        size_bytes: document.sizeBytes,
        uploaded_at: document.uploadedAt,
        uploaded_by_user_id: document.uploadedByUserId ?? input.brokerUserId,
        document_scope: input.documentScope ?? document.documentScope ?? 'proposal',
      })),
    );

    if (error) {
      throw new Error(`Supabase proposal documents add failed: ${error.message}`);
    }

    const uploadedNames = input.documents
      .map((document) => document.originalFilename.trim())
      .filter(Boolean);

    await this.appendProposalAuditComment(
      input.proposalId,
      input.brokerUserId,
      access,
      uploadedNames.length === 1
        ? `Documento enviado${this.getDocumentScopeAuditSuffix(input.documentScope)}: "${uploadedNames[0]}".`
        : `Documentos enviados${this.getDocumentScopeAuditSuffix(input.documentScope)} (${uploadedNames.length}): ${uploadedNames.map((name) => `"${name}"`).join(', ')}.`,
      input.documentScope ?? 'proposal',
    );
  }

  async getProposalContext(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDocumentContext | null> {
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);

    if (!proposalAccess) {
      return null;
    }

    const { data, error } = await this.client
      .from('proposals')
      .select('id, broker_user_id, broker_name, client_name')
      .eq('id', input.proposalId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal context get failed: ${error.message}`);
    }

    return {
      proposalId: data.id,
      brokerUserId: data.broker_user_id,
      brokerName: data.broker_name ?? '',
      clientName: data.client_name ?? '',
    };
  }

  async createShareLink(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalShareLink> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);
    const proposal = await this.getProposalForUpdate(input.proposalId);

    if (!proposalAccess || (!access.isAdmin && !proposalAccess.isOwner)) {
      throw new Error('Proposta não encontrada');
    }
    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    this.assertBrokerCanModifyProposal(
      access,
      toStatusInfo(proposal.status).status,
      proposal,
      {
        proposalId: input.proposalId,
        brokerUserId: input.brokerUserId,
        formData: undefined,
      },
      true,
    );

    const existingShareLink = await this.getShareLinkByProposalId(input.proposalId);

    if (existingShareLink) {
      return {
        token: existingShareLink.token,
        createdAt: existingShareLink.created_at,
      };
    }

    const token = randomUUID();
    const { data, error } = await this.client
      .from('proposal_share_links')
      .upsert(
        {
          proposal_id: input.proposalId,
          token,
          created_by_user_id: input.brokerUserId,
          revoked_at: null,
        },
        { onConflict: 'proposal_id' },
      )
      .select('token, created_at')
      .single();

    if (error || !data) {
      throw new Error(`Supabase proposal share link create failed: ${error?.message ?? 'unknown error'}`);
    }

    return {
      token: data.token,
      createdAt: data.created_at,
    };
  }

  async createInvitation(input: {
    brokerUserId: string;
    proposalId: string;
    inviteeUserId: string;
  }): Promise<ProposalInvitation> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);
    const proposal = await this.getProposalForUpdate(input.proposalId);

    if (!proposalAccess || (!access.isAdmin && !proposalAccess.isOwner)) {
      throw new Error('Proposta não encontrada');
    }
    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    this.assertBrokerCanModifyProposal(
      access,
      toStatusInfo(proposal.status).status,
      proposal,
      {
        proposalId: input.proposalId,
        brokerUserId: input.brokerUserId,
        formData: undefined,
      },
    );

    if (proposalAccess.ownerBrokerUserId === input.inviteeUserId) {
      throw new Error('O dono da proposta não pode ser convidado');
    }

    if (await this.hasProposalCollaborator(input.proposalId, input.inviteeUserId)) {
      throw new Error('Este usuário já está vinculado à proposta');
    }

    const inviteeProfile = await this.resolveAccess(input.inviteeUserId);
    if (!inviteeProfile.fullName && !inviteeProfile.isAdmin && inviteeProfile.role === 'broker') {
      throw new Error('Usuário convidado não encontrado');
    }

    const { data, error } = await this.client
      .from('proposal_invitations')
      .upsert(
        {
          proposal_id: input.proposalId,
          inviter_user_id: input.brokerUserId,
          invitee_user_id: input.inviteeUserId,
          status: 'pending',
          responded_at: null,
        },
        { onConflict: 'proposal_id,invitee_user_id' },
      )
      .select('id, proposal_id, inviter_user_id, invitee_user_id, status, created_at, responded_at')
      .single();

    if (error || !data) {
      throw new Error(`Supabase proposal invitation create failed: ${error?.message ?? 'unknown error'}`);
    }

    return this.toProposalInvitation(data as ProposalInvitationRow);
  }

  async listInvitationsByInvitee(input: {
    brokerUserId: string;
  }): Promise<ProposalInvitation[]> {
    const { data, error } = await this.client
      .from('proposal_invitations')
      .select('id, proposal_id, inviter_user_id, invitee_user_id, status, created_at, responded_at')
      .eq('invitee_user_id', input.brokerUserId)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Supabase proposal invitations list failed: ${error.message}`);
    }

    return this.toProposalInvitations((data as ProposalInvitationRow[] | null) ?? []);
  }

  async countPendingInvitations(input: {
    brokerUserId: string;
  }): Promise<number> {
    const { count, error } = await this.client
      .from('proposal_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('invitee_user_id', input.brokerUserId)
      .eq('status', 'pending');

    if (error) {
      throw new Error(`Supabase proposal invitations pending count failed: ${error.message}`);
    }

    return count ?? 0;
  }

  async respondToInvitation(input: {
    brokerUserId: string;
    invitationId: string;
    action: 'accept' | 'reject';
  }): Promise<ProposalInvitation | null> {
    const { data, error } = await this.client
      .from('proposal_invitations')
      .select('id, proposal_id, inviter_user_id, invitee_user_id, status, created_at, responded_at')
      .eq('id', input.invitationId)
      .eq('invitee_user_id', input.brokerUserId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal invitation get failed: ${error.message}`);
    }

    const invitation = data as ProposalInvitationRow;

    if (invitation.status !== 'pending') {
      return this.toProposalInvitation(invitation);
    }

    const nextStatus: ProposalInvitationStatus =
      input.action === 'accept' ? 'accepted' : 'rejected';

    const { data: updatedInvitation, error: updateError } = await this.client
      .from('proposal_invitations')
      .update({
        status: nextStatus,
        responded_at: new Date().toISOString(),
      })
      .eq('id', input.invitationId)
      .eq('invitee_user_id', input.brokerUserId)
      .select('id, proposal_id, inviter_user_id, invitee_user_id, status, created_at, responded_at')
      .single();

    if (updateError || !updatedInvitation) {
      throw new Error(`Supabase proposal invitation update failed: ${updateError?.message ?? 'unknown error'}`);
    }

    if (input.action === 'accept') {
      const { error: collaboratorError } = await this.client
        .from('proposal_collaborators')
        .upsert(
          {
            proposal_id: invitation.proposal_id,
            user_id: input.brokerUserId,
          },
          { onConflict: 'proposal_id,user_id', ignoreDuplicates: true },
        );

      if (collaboratorError) {
        throw new Error(`Supabase invitation collaborator create failed: ${collaboratorError.message}`);
      }
    }

    return this.toProposalInvitation(updatedInvitation as ProposalInvitationRow);
  }

  async getShareLinkPreview(input: {
    brokerUserId: string;
    token: string;
  }): Promise<ProposalSharePreview | null> {
    const shareLink = await this.getShareLinkByToken(input.token);

    if (!shareLink) {
      return null;
    }

    const { data, error } = await this.client
      .from('proposals')
      .select('id, proposal_number, broker_user_id, broker_name, client_name')
      .eq('id', shareLink.proposal_id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal share preview failed: ${error.message}`);
    }

    const ownerBrokerUserId = data.broker_user_id;
    const isOwnedByCurrentUser = ownerBrokerUserId === input.brokerUserId;
    const isAlreadyAttached = isOwnedByCurrentUser
      ? true
      : await this.hasProposalCollaborator(shareLink.proposal_id, input.brokerUserId);

    return {
      proposalId: data.id,
      proposalCode: formatProposalCode(data.proposal_number),
      clientName: data.client_name ?? '',
      ownerBrokerUserId,
      ownerName: data.broker_name ?? 'Corretor',
      isOwnedByCurrentUser,
      isAlreadyAttached,
    };
  }

  async acceptShareLink(input: {
    brokerUserId: string;
    token: string;
  }): Promise<AcceptProposalShareLinkResult> {
    const access = await this.resolveAccess(input.brokerUserId);
    const preview = await this.getShareLinkPreview(input);

    if (!preview) {
      throw new Error('Link de compartilhamento inválido ou expirado');
    }

    if (preview.isOwnedByCurrentUser) {
      throw new Error('Você já é o dono desta proposta');
    }

    const { error } = await this.client
      .from('proposal_collaborators')
      .upsert(
        {
          proposal_id: preview.proposalId,
          user_id: input.brokerUserId,
        },
        { onConflict: 'proposal_id,user_id', ignoreDuplicates: true },
      );

    if (error) {
      throw new Error(`Supabase proposal collaborator create failed: ${error.message}`);
    }

    return {
      proposalId: preview.proposalId,
      proposalCode: preview.proposalCode,
      ownerBrokerUserId: preview.ownerBrokerUserId,
      ownerName: preview.ownerName,
      guestName: getAccessDisplayName(access),
      alreadyAttached: preview.isAlreadyAttached,
    };
  }

  async removeGuest(input: {
    brokerUserId: string;
    proposalId: string;
    guestUserId: string;
  }): Promise<boolean> {
    const access = await this.resolveAccess(input.brokerUserId);
    const proposalAccess = await this.resolveProposalAccess(input.proposalId, input.brokerUserId);
    const proposal = await this.getProposalForUpdate(input.proposalId);

    if (!proposalAccess || (!access.isAdmin && !proposalAccess.isOwner)) {
      throw new Error('Proposta não encontrada');
    }
    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    this.assertBrokerCanModifyProposal(
      access,
      toStatusInfo(proposal.status).status,
      proposal,
      {
        proposalId: input.proposalId,
        brokerUserId: input.brokerUserId,
        formData: undefined,
      },
    );

    if (proposalAccess.ownerBrokerUserId === input.guestUserId) {
      throw new Error('Não é possível remover o dono da proposta');
    }

    const { error, count } = await this.client
      .from('proposal_collaborators')
      .delete({ count: 'exact' })
      .eq('proposal_id', input.proposalId)
      .eq('user_id', input.guestUserId);

    if (error) {
      throw new Error(`Supabase proposal collaborator delete failed: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  private toProposalListItem(
    row: Pick<ProposalRow, 'id' | 'proposal_number' | 'broker_user_id' | 'status' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'>,
    documentsCount: number,
    currentUserId: string,
    sharedProposalIds: Set<string>,
    ownerAvatarPath: string | null,
  ): ProposalListItem {
    const status = toStatusInfo(row.status);
    const isOwnedByCurrentUser = row.broker_user_id === currentUserId;
    const isSharedWithCurrentUser =
      !isOwnedByCurrentUser && sharedProposalIds.has(row.id);

    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
      ...status,
      ownerBrokerUserId: row.broker_user_id,
      ownerName: row.broker_name ?? '',
      ownerAvatarPath,
      isOwnedByCurrentUser,
      isSharedWithCurrentUser,
      clientName: row.client_name ?? '',
      brokerName: row.broker_name ?? '',
      propertyType: row.property_type ?? '',
      createdAt: row.created_at,
      documentsCount,
    };
  }

  private async toProposalDetail(
    row: ProposalRow & { proposal_documents?: ProposalDocumentRow[] | null },
    proposalAccess: ResolvedProposalAccess,
  ): Promise<ProposalDetail> {
    const status = toStatusInfo(row.status);
    const allDocuments = row.proposal_documents ?? [];
    const normalizedComments = normalizeProposalComments(row.proposal_comments);
    const uploaderUserIds = Array.from(
      new Set(
        allDocuments.map((document) => document.uploaded_by_user_id ?? row.broker_user_id),
      ),
    );
    const authorUserIds = [
      row.broker_user_id,
      ...normalizedComments.map((comment) => comment.authorUserId ?? '').filter(Boolean),
    ];
    const [uploaderNames, authorAvatarPaths, guests, shareLink, pendingInvitations] =
      await Promise.all([
        this.getProfileNamesByIds(uploaderUserIds),
        this.getProfileAvatarPathsByIds(authorUserIds),
        proposalAccess.isOwner || proposalAccess.isAdmin
          ? this.listProposalGuests(row.id)
          : Promise.resolve([]),
        proposalAccess.isOwner || proposalAccess.isAdmin
          ? this.getShareLinkByProposalId(row.id)
          : Promise.resolve(null),
        proposalAccess.isOwner || proposalAccess.isAdmin
          ? this.listProposalInvitationsByProposal(row.id, 'pending')
          : Promise.resolve([]),
      ]);

    const mapDocument = (document: ProposalDocumentRow) => {
      const uploadedByUserId = document.uploaded_by_user_id ?? row.broker_user_id;
      const isUploadedByProposalOwner = uploadedByUserId === row.broker_user_id;
      const uploadedByName =
        uploaderNames.get(uploadedByUserId)?.trim() ||
        (isUploadedByProposalOwner ? row.broker_name ?? 'Corretor' : 'Usuário');

      return {
        id: document.id,
        filename: document.filename,
        originalFilename: document.original_filename,
        displayName: document.original_filename,
        contentType: document.content_type,
        sizeBytes: document.size_bytes,
        uploadedAt: document.uploaded_at,
        uploadedByUserId,
        uploadedByName,
        isUploadedByProposalOwner,
        storageLocation: document.storage_location,
        documentScope: document.document_scope ?? 'proposal',
      };
    };
    const documents = allDocuments
      .filter((document) => (document.document_scope ?? 'proposal') === 'proposal')
      .map(mapDocument);
    const incomeValidationDocuments = allDocuments
      .filter(
        (document) => (document.document_scope ?? 'proposal') === 'income_validation',
      )
      .map(mapDocument);
    const sellerDocuments = allDocuments
      .filter((document) => (document.document_scope ?? 'proposal') === 'seller')
      .map(mapDocument);
    const propertyDocuments = allDocuments
      .filter((document) => (document.document_scope ?? 'proposal') === 'property')
      .map(mapDocument);

    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
      ...status,
      ownerBrokerUserId: row.broker_user_id,
      ownerName: row.broker_name ?? '',
      ownerAvatarPath: authorAvatarPaths.get(row.broker_user_id) ?? null,
      isOwnedByCurrentUser: proposalAccess.isOwner,
      isSharedWithCurrentUser: proposalAccess.isCollaborator,
      canDeleteProposal:
        proposalAccess.isAdmin ||
        (proposalAccess.isOwner && !this.isBrokerReadOnlyStatus(status.status)),
      brokerName: row.broker_name ?? '',
      brokerPhone: row.broker_phone ?? '',
      createdAt: row.created_at,
      pendingReason: row.pending_reason ?? '',
      client: {
        name: row.client_name ?? '',
        cpf: row.client_cpf ?? '',
        phone: row.client_phone ?? '',
        email: row.client_email ?? '',
      },
      property: {
        type: row.property_type ?? '',
        city: row.property_city ?? '',
        state: row.property_state ?? '',
      },
      additionalInfo: row.additional_info ?? '',
      formData: row.form_data ?? {},
      comments: normalizedComments.map((comment) => ({
        ...comment,
        authorAvatarPath: comment.authorUserId
          ? (authorAvatarPaths.get(comment.authorUserId) ?? null)
          : null,
      })),
      documents,
      incomeValidationDocuments,
      sellerDocuments,
      propertyDocuments,
      guests,
      shareLinkToken: shareLink?.token ?? null,
      pendingInvitations,
    };
  }

  private async getProposalDocumentCountsByProposalIds(
    proposalIds: string[],
    documentScope: ProposalDocumentScope,
  ): Promise<Map<string, number>> {
    if (proposalIds.length === 0) {
      return new Map();
    }

    const counts = new Map<string, number>();
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const baseQuery = this.client
        .from('proposal_documents')
        .select('proposal_id')
        .in('proposal_id', proposalIds);
      const scopedQuery = documentScope === 'proposal'
        ? baseQuery.or('document_scope.eq.proposal,document_scope.is.null')
        : baseQuery.eq('document_scope', documentScope);
      const { data, error } = await scopedQuery.range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Supabase proposal documents count failed: ${error.message}`);
      }

      const documents = (data as Array<{ proposal_id: string }> | null) ?? [];

      documents.forEach((document) => {
        counts.set(
          document.proposal_id,
          (counts.get(document.proposal_id) ?? 0) + 1,
        );
      });

      if (documents.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return counts;
  }

  private getDocumentScopeAuditSuffix(
    scope: ProposalDocumentScope | undefined,
  ): string {
    if (scope === 'income_validation') {
      return ' para validação de renda';
    }

    if (scope === 'seller') {
      return ' na pasta de vendedor';
    }

    if (scope === 'property') {
      return ' na pasta de imóvel';
    }

    return '';
  }

  private toDocumentLookup(row: ProposalDocumentRow): ProposalDocumentLookup {
    return {
      id: row.id,
      filename: row.filename,
      originalFilename: row.original_filename,
      uploadedByUserId: row.uploaded_by_user_id,
      documentScope: row.document_scope ?? 'proposal',
      storageLocation: row.storage_location,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      uploadedAt: row.uploaded_at,
    };
  }

  private async getProfileNamesByIds(userIds: string[]): Promise<Map<string, string>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueUserIds);

    if (error) {
      throw new Error(`Supabase uploader profiles get failed: ${error.message}`);
    }

    return new Map(
      ((data as Array<{ id: string; full_name: string | null }> | null) ?? []).map(
        (profile) => [profile.id, profile.full_name ?? ''],
      ),
    );
  }

  private isBrokerReadOnlyStatus(status: ProposalStatus): boolean {
    return (
      status === 'aprovado' ||
      status === 'validacao_renda' ||
      status === 'renda_validada' ||
      status === 'renda_nao_validada' ||
      status === 'engenharia' ||
      status === 'formularios' ||
      status === 'aguardando_reserva' ||
      status === 'conformidade' ||
      status === 'agendamento_agencia' ||
      status === 'itbi' ||
      status === 'assinatura_contrato' ||
      status === 'registro' ||
      status === 'finalizado'
    );
  }

  private extractIncomeValidationData(
    formData: Record<string, unknown> | null | undefined,
  ): IncomeValidationData | null {
    const rawValue = formData?.validacao_renda;

    if (!rawValue || typeof rawValue !== 'object') {
      return null;
    }

    return rawValue as IncomeValidationData;
  }

  private isIncomeValidationFinalized(
    formData: Record<string, unknown> | null | undefined,
  ): boolean {
    return this.extractIncomeValidationData(formData)?.finalized === true;
  }

  private isIncomeValidationOnlyUpdate(
    currentProposal: ProposalUpdateContextRow,
    input: UpdateProposalInput,
  ): boolean {
    if (!input.formData) {
      return false;
    }

    if (
      input.status !== undefined ||
      input.pendingReason !== undefined ||
      input.commentMessage !== undefined
    ) {
      return false;
    }

    const unchangedScalarFields =
      (input.brokerPhone === undefined || input.brokerPhone === (currentProposal.broker_phone ?? '')) &&
      (input.clientName === undefined || input.clientName === (currentProposal.client_name ?? '')) &&
      (input.clientCpf === undefined || input.clientCpf === (currentProposal.client_cpf ?? '')) &&
      (input.clientEmail === undefined || input.clientEmail === (currentProposal.client_email ?? '')) &&
      (input.clientPhone === undefined || input.clientPhone === (currentProposal.client_phone ?? '')) &&
      (input.propertyType === undefined || input.propertyType === (currentProposal.property_type ?? '')) &&
      (input.propertyCity === undefined || input.propertyCity === (currentProposal.property_city ?? '')) &&
      (input.propertyState === undefined || input.propertyState === (currentProposal.property_state ?? '')) &&
      (input.additionalInfo === undefined || input.additionalInfo === (currentProposal.additional_info ?? ''));

    if (!unchangedScalarFields) {
      return false;
    }

    const currentFormData = currentProposal.form_data ?? {};
    const nextFormData = input.formData ?? {};

    const currentWithoutIncomeValidation = { ...currentFormData };
    const nextWithoutIncomeValidation = { ...nextFormData };

    delete currentWithoutIncomeValidation.validacao_renda;
    delete nextWithoutIncomeValidation.validacao_renda;

    return JSON.stringify(currentWithoutIncomeValidation) === JSON.stringify(nextWithoutIncomeValidation);
  }

  private isApprovalToIncomeValidationTransitionOnly(
    status: ProposalStatus,
    input: Pick<
      UpdateProposalInput,
      | 'brokerPhone'
      | 'clientName'
      | 'clientCpf'
      | 'clientEmail'
      | 'clientPhone'
      | 'propertyType'
      | 'propertyCity'
      | 'propertyState'
      | 'additionalInfo'
      | 'formData'
      | 'status'
      | 'pendingReason'
      | 'commentMessage'
      | 'commentScope'
    >,
  ): boolean {
    if (status !== 'aprovado' || input.status !== 'validacao_renda') {
      return false;
    }

    return (
      input.brokerPhone === undefined &&
      input.clientName === undefined &&
      input.clientCpf === undefined &&
      input.clientEmail === undefined &&
      input.clientPhone === undefined &&
      input.propertyType === undefined &&
      input.propertyCity === undefined &&
      input.propertyState === undefined &&
      input.additionalInfo === undefined &&
      input.formData === undefined &&
      input.pendingReason === undefined &&
      input.commentMessage === undefined &&
      input.commentScope === undefined
    );
  }

  private isCommentOnlyUpdate(
    input: Pick<
      UpdateProposalInput,
      | 'brokerPhone'
      | 'clientName'
      | 'clientCpf'
      | 'clientEmail'
      | 'clientPhone'
      | 'propertyType'
      | 'propertyCity'
      | 'propertyState'
      | 'additionalInfo'
      | 'formData'
      | 'status'
      | 'pendingReason'
      | 'commentMessage'
      | 'commentScope'
    >,
  ): boolean {
    return (
      typeof input.commentMessage === 'string' &&
      input.commentMessage.trim().length > 0 &&
      input.brokerPhone === undefined &&
      input.clientName === undefined &&
      input.clientCpf === undefined &&
      input.clientEmail === undefined &&
      input.clientPhone === undefined &&
      input.propertyType === undefined &&
      input.propertyCity === undefined &&
      input.propertyState === undefined &&
      input.additionalInfo === undefined &&
      input.formData === undefined &&
      input.status === undefined &&
      input.pendingReason === undefined
    );
  }

  private assertBrokerCanModifyProposal(
    access: { isAdmin: boolean },
    status: ProposalStatus,
    currentProposal: ProposalUpdateContextRow,
    input: Pick<
      UpdateProposalInput,
      | 'proposalId'
      | 'brokerUserId'
      | 'brokerPhone'
      | 'clientName'
      | 'clientCpf'
      | 'clientEmail'
      | 'clientPhone'
      | 'propertyType'
      | 'propertyCity'
      | 'propertyState'
      | 'additionalInfo'
      | 'formData'
      | 'status'
      | 'pendingReason'
      | 'commentMessage'
    >,
    allowIncomeValidationDocuments = false,
  ): void {
    if (access.isAdmin || !this.isBrokerReadOnlyStatus(status)) {
      return;
    }

    if (this.isApprovalToIncomeValidationTransitionOnly(status, input)) {
      return;
    }

    if (this.isCommentOnlyUpdate(input)) {
      return;
    }

    const isIncomeValidationEditable =
      !this.isIncomeValidationFinalized(currentProposal.form_data) &&
      (allowIncomeValidationDocuments ||
        this.isIncomeValidationOnlyUpdate(currentProposal, input));

    if (!isIncomeValidationEditable) {
      throw new Error('Após aprovação, apenas administradores podem alterar a proposta.');
    }
  }

  private async getProfileAvatarPathsByIds(userIds: string[]): Promise<Map<string, string | null>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('profiles')
      .select('id, avatar_path')
      .in('id', uniqueUserIds);

    if (error) {
      throw new Error(`Supabase uploader avatars get failed: ${error.message}`);
    }

    return new Map(
      ((data as Array<{ id: string; avatar_path: string | null }> | null) ?? []).map(
        (profile) => [profile.id, profile.avatar_path ?? null],
      ),
    );
  }

  private async appendProposalAuditComment(
    proposalId: string,
    actorUserId: string,
    access: { role: UserRole; fullName: string },
    message: string,
    scope: ProposalComment['scope'] = 'proposal',
  ): Promise<void> {
    const currentProposal = await this.getProposalForUpdate(proposalId);

    if (!currentProposal) {
      throw new Error('Proposta não encontrada');
    }

    const nextComments = normalizeProposalComments(currentProposal.proposal_comments);
    nextComments.push(
      buildProposalComment({
        authorName: getAccessDisplayName(access),
        authorUserId: actorUserId,
        authorRole: access.role,
        message,
        type: 'audit',
        scope,
      }),
    );

    const { error } = await this.client
      .from('proposals')
      .update({
        proposal_comments: nextComments,
      })
      .eq('id', proposalId);

    if (error) {
      throw new Error(`Supabase proposal audit append failed: ${error.message}`);
    }
  }

  async appendAuditComment(input: {
    proposalId: string;
    actorUserId: string;
    actorRole: UserRole;
    actorName: string;
    message: string;
    scope?: ProposalComment['scope'];
  }): Promise<void> {
    await this.appendProposalAuditComment(
      input.proposalId,
      input.actorUserId,
      {
        role: input.actorRole,
        fullName: input.actorName,
      },
      input.message,
      input.scope,
    );
  }

  private async toProposalInvitations(
    rows: ProposalInvitationRow[],
  ): Promise<ProposalInvitation[]> {
    if (rows.length === 0) {
      return [];
    }

    const proposalIds = Array.from(new Set(rows.map((row) => row.proposal_id)));
    const userIds = Array.from(
      new Set(rows.flatMap((row) => [row.inviter_user_id, row.invitee_user_id])),
    );
    const [proposals, names] = await Promise.all([
      this.getProposalSummariesByIds(proposalIds),
      this.getProfileNamesByIds(userIds),
    ]);

    return rows.flatMap((row) => {
      const proposal = proposals.get(row.proposal_id);

      if (!proposal) {
        return [];
      }

      return [this.mapProposalInvitation(row, proposal, names)];
    });
  }

  private async toProposalInvitation(
    row: ProposalInvitationRow,
  ): Promise<ProposalInvitation> {
    const [proposalMap, names] = await Promise.all([
      this.getProposalSummariesByIds([row.proposal_id]),
      this.getProfileNamesByIds([row.inviter_user_id, row.invitee_user_id]),
    ]);
    const proposal = proposalMap.get(row.proposal_id);

    if (!proposal) {
      throw new Error('Proposta não encontrada');
    }

    return this.mapProposalInvitation(row, proposal, names);
  }

  private mapProposalInvitation(
    row: ProposalInvitationRow,
    proposal: {
      id: string;
      proposal_number: number;
      broker_user_id: string;
      broker_name: string | null;
      client_name: string | null;
    },
    names: Map<string, string>,
  ): ProposalInvitation {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      proposalCode: formatProposalCode(proposal.proposal_number),
      clientName: proposal.client_name ?? '',
      inviterUserId: row.inviter_user_id,
      inviterName: names.get(row.inviter_user_id)?.trim() || 'Usuário',
      ownerBrokerUserId: proposal.broker_user_id,
      ownerName: proposal.broker_name ?? 'Corretor',
      inviteeUserId: row.invitee_user_id,
      inviteeName: names.get(row.invitee_user_id)?.trim() || 'Usuário',
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
    };
  }

  private async getProposalSummariesByIds(proposalIds: string[]) {
    if (proposalIds.length === 0) {
      return new Map<string, {
        id: string;
        proposal_number: number;
        broker_user_id: string;
        broker_name: string | null;
        client_name: string | null;
      }>();
    }

    const { data, error } = await this.client
      .from('proposals')
      .select('id, proposal_number, broker_user_id, broker_name, client_name')
      .in('id', proposalIds);

    if (error) {
      throw new Error(`Supabase proposal summaries get failed: ${error.message}`);
    }

    return new Map(
      ((data as Array<{
        id: string;
        proposal_number: number;
        broker_user_id: string;
        broker_name: string | null;
        client_name: string | null;
      }> | null) ?? []).map((proposal) => [proposal.id, proposal]),
    );
  }

  private async listProposalGuests(proposalId: string): Promise<ProposalGuest[]> {
    const { data, error } = await this.client
      .from('proposal_collaborators')
      .select('proposal_id, user_id, created_at')
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Supabase proposal collaborators list failed: ${error.message}`);
    }

    const collaborators = (data as ProposalCollaboratorRow[] | null) ?? [];
    const names = await this.getProfileNamesByIds(collaborators.map((item) => item.user_id));

    return collaborators.map((collaborator) => ({
      userId: collaborator.user_id,
      name: names.get(collaborator.user_id)?.trim() || 'Usuário',
      joinedAt: collaborator.created_at,
    }));
  }

  private async listProposalInvitationsByProposal(
    proposalId: string,
    status?: ProposalInvitationStatus,
  ): Promise<ProposalInvitation[]> {
    let query = this.client
      .from('proposal_invitations')
      .select('id, proposal_id, inviter_user_id, invitee_user_id, status, created_at, responded_at')
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Supabase proposal invitations by proposal failed: ${error.message}`);
    }

    return this.toProposalInvitations((data as ProposalInvitationRow[] | null) ?? []);
  }

  private async listSharedProposalIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('proposal_collaborators')
      .select('proposal_id')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Supabase shared proposals list failed: ${error.message}`);
    }

    return ((data as Array<{ proposal_id: string }> | null) ?? []).map(
      (item) => item.proposal_id,
    );
  }

  private async listAccessibleProposalIds(userId: string): Promise<string[]> {
    const [sharedProposalIds, ownedProposalIds] = await Promise.all([
      this.listSharedProposalIds(userId),
      this.listOwnedProposalIds(userId),
    ]);

    return Array.from(new Set([...ownedProposalIds, ...sharedProposalIds]));
  }

  private async listOwnedProposalIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('proposals')
      .select('id')
      .eq('broker_user_id', userId);

    if (error) {
      throw new Error(`Supabase owned proposals list failed: ${error.message}`);
    }

    return ((data as Array<{ id: string }> | null) ?? []).map((item) => item.id);
  }

  private async hasProposalCollaborator(proposalId: string, userId: string): Promise<boolean> {
    const { count, error } = await this.client
      .from('proposal_collaborators')
      .select('proposal_id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Supabase proposal collaborator lookup failed: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  private async getShareLinkByToken(token: string): Promise<ProposalShareLinkRow | null> {
    const { data, error } = await this.client
      .from('proposal_share_links')
      .select('proposal_id, token, created_by_user_id, created_at, revoked_at')
      .eq('token', token)
      .is('revoked_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal share link get failed: ${error.message}`);
    }

    return data as ProposalShareLinkRow;
  }

  private async getShareLinkByProposalId(
    proposalId: string,
  ): Promise<ProposalShareLinkRow | null> {
    const { data, error } = await this.client
      .from('proposal_share_links')
      .select('proposal_id, token, created_by_user_id, created_at, revoked_at')
      .eq('proposal_id', proposalId)
      .is('revoked_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal share link by proposal get failed: ${error.message}`);
    }

    return data as ProposalShareLinkRow;
  }

  private async resolveAccess(userId: string): Promise<{ isAdmin: boolean; role: UserRole; fullName: string }> {
    const { data, error } = await this.client
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { isAdmin: false, role: 'broker', fullName: '' };
      }

      throw new Error(`Supabase profile role get failed: ${error.message}`);
    }

    const role = (data.role === 'admin' ? 'admin' : 'broker') as UserRole;
    return {
      isAdmin: role === 'admin',
      role,
      fullName: data.full_name ?? '',
    };
  }

  private async resolveProposalAccess(
    proposalId: string,
    userId: string,
  ): Promise<ResolvedProposalAccess | null> {
    const [access, proposalResult] = await Promise.all([
      this.resolveAccess(userId),
      this.client
        .from('proposals')
        .select('id, broker_user_id, broker_name')
        .eq('id', proposalId)
        .single(),
    ]);
    const { data, error } = proposalResult;

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal access get failed: ${error.message}`);
    }

    const isOwner = data.broker_user_id === userId;
    const isCollaborator = isOwner || access.isAdmin
      ? false
      : await this.hasProposalCollaborator(proposalId, userId);

    if (!access.isAdmin && !isOwner && !isCollaborator) {
      return null;
    }

    return {
      proposalId: data.id,
      ownerBrokerUserId: data.broker_user_id,
      ownerName: data.broker_name ?? 'Corretor',
      isAdmin: access.isAdmin,
      isOwner,
      isCollaborator,
    };
  }

  private async getProposalForUpdate(
    proposalId: string,
  ): Promise<ProposalUpdateContextRow | null> {
    const query = this.client
      .from('proposals')
      .select('status, proposal_comments, broker_name, broker_phone, broker_user_id, proposal_number, client_name, client_cpf, client_email, client_phone, property_type, property_city, property_state, additional_info, form_data')
      .eq('id', proposalId);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal update context failed: ${error.message}`);
    }

    const row = data as Pick<
      ProposalRow,
      | 'status'
      | 'proposal_comments'
      | 'broker_name'
      | 'broker_phone'
      | 'client_name'
      | 'client_cpf'
      | 'client_email'
      | 'client_phone'
      | 'property_type'
      | 'property_city'
      | 'property_state'
      | 'additional_info'
      | 'form_data'
    > & {
      broker_user_id: string;
      proposal_number: number;
    };

    return {
      ...row,
      proposalCode: formatProposalCode(row.proposal_number),
    };
  }
}

function formatProposalCode(proposalNumber: number): string {
  return `PROP-${String(proposalNumber).padStart(3, '0')}`;
}

function toStatusInfo(status: string | null | undefined): ProposalStatusInfo {
  const normalized = isProposalStatus(status) ? status : 'em_analise';

  return {
    status: normalized,
    statusLabel: proposalStatusLabels.get(normalized) ?? 'Em análise',
  };
}

function isProposalStatus(status: string | null | undefined): status is ProposalStatus {
  return proposalStatusLabels.has(status as ProposalStatus);
}

const proposalStatusLabels = new Map(
  PROPOSAL_STATUS_OPTIONS.map((status) => [status.value, status.label]),
);

function normalizeProposalComments(value: unknown): ProposalComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (
      typeof record.id !== 'string' ||
      typeof record.authorName !== 'string' ||
      (record.authorRole !== 'admin' && record.authorRole !== 'broker') ||
      typeof record.createdAt !== 'string' ||
      typeof record.message !== 'string'
    ) {
      return [];
    }

    const type = normalizeCommentType(record.type);
    const scope = normalizeCommentScope(record.scope);

    return [{
      id: record.id,
      authorName: record.authorName,
      authorUserId:
        typeof record.authorUserId === 'string' && record.authorUserId
          ? record.authorUserId
          : null,
      authorRole: record.authorRole,
      createdAt: record.createdAt,
      message: record.message,
      type,
      scope,
    }];
  });
}

function normalizeCommentType(value: unknown): ProposalCommentType {
  if (
    value === 'pending_reason' ||
    value === 'resubmission' ||
    value === 'audit'
  ) {
    return value;
  }

  return 'comment';
}

function normalizeCommentScope(value: unknown): ProposalComment['scope'] {
  if (
    value === 'income_validation' ||
    value === 'seller' ||
    value === 'property'
  ) {
    return value;
  }

  return 'proposal';
}

function buildProposalComment(input: {
  authorName: string;
  authorUserId: string;
  authorRole: UserRole;
  message: string;
  type: ProposalCommentType;
  scope?: ProposalComment['scope'];
}): ProposalComment {
  return {
    id: randomUUID(),
    authorName: input.authorName,
    authorUserId: input.authorUserId,
    authorRole: input.authorRole,
    createdAt: new Date().toISOString(),
    message: input.message,
    type: input.type,
    scope: input.scope ?? 'proposal',
  };
}

function getAccessDisplayName(access: { role: UserRole; fullName: string }): string {
  return access.fullName || (access.role === 'admin' ? 'Administrador' : 'Corretor');
}

function escapeLike(value: string): string {
  return value.replace(/[,%]/g, '');
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function parseProposalNumber(value: string): number | null {
  const digits = value.replace(/^(RB|PROP)-/i, '').replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  return Number(digits);
}

type ProposalFieldChange = {
  label: string;
  previousValue: string;
  nextValue: string;
};

function collectUpdatedFieldChanges(
  currentProposal: Pick<
    ProposalRow,
    | 'broker_phone'
    | 'client_name'
    | 'client_cpf'
    | 'client_email'
    | 'client_phone'
    | 'property_type'
    | 'property_city'
    | 'property_state'
    | 'additional_info'
    | 'form_data'
  >,
  input: UpdateProposalInput,
): ProposalFieldChange[] {
  const changes: ProposalFieldChange[] = [];

  appendFieldChange(changes, 'telefone do corretor', currentProposal.broker_phone, input.brokerPhone);
  appendFieldChange(changes, 'nome do cliente', currentProposal.client_name, input.clientName);
  appendFieldChange(changes, 'CPF do cliente', currentProposal.client_cpf, input.clientCpf);
  appendFieldChange(changes, 'e-mail do cliente', currentProposal.client_email, input.clientEmail);
  appendFieldChange(changes, 'telefone do cliente', currentProposal.client_phone, input.clientPhone);
  appendFieldChange(changes, 'tipo do imóvel', currentProposal.property_type, input.propertyType);
  appendFieldChange(changes, 'cidade do imóvel', currentProposal.property_city, input.propertyCity);
  appendFieldChange(changes, 'UF do imóvel', currentProposal.property_state, input.propertyState);
  appendFieldChange(changes, 'informações adicionais', currentProposal.additional_info, input.additionalInfo);

  return changes;
}

function buildProposalAuditMessage(updatedFieldChanges: ProposalFieldChange[]): string {
  return updatedFieldChanges
    .map(
      (change) =>
        `${capitalize(change.label)}: de "${change.previousValue}" para "${change.nextValue}".`,
    )
    .join('\n');
}

function resolveIncomeValidationAuditMessage(
  currentFormData: Record<string, unknown> | null | undefined,
  nextFormData: Record<string, unknown> | undefined,
): string | null {
  if (!nextFormData) {
    return null;
  }

  const currentIncomeValidationData = normalizeIncomeValidationAuditValue(
    currentFormData?.validacao_renda,
  );
  const nextIncomeValidationData = normalizeIncomeValidationAuditValue(
    nextFormData.validacao_renda,
  );

  if (nextIncomeValidationData === null) {
    return null;
  }

  if (
    currentIncomeValidationData !== null &&
    JSON.stringify(currentIncomeValidationData) === JSON.stringify(nextIncomeValidationData)
  ) {
    return null;
  }

  const wasFinalized = currentIncomeValidationData?.finalized === true;
  const isFinalized = nextIncomeValidationData?.finalized === true;

  if (!wasFinalized && isFinalized) {
    return 'Validação de renda finalizada.';
  }

  return 'Validação de renda atualizada.';
}

function normalizeIncomeValidationAuditValue(
  value: unknown,
): { finalized?: boolean } & Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as { finalized?: boolean } & Record<string, unknown>;
}

function appendFieldChange(
  changes: ProposalFieldChange[],
  label: string,
  previousValue: unknown,
  nextValue: unknown,
) {
  if (nextValue === undefined) {
    return;
  }

  const normalizedPreviousValue = displayAuditValue(previousValue);
  const normalizedNextValue = displayAuditValue(nextValue);

  if (normalizedPreviousValue === normalizedNextValue) {
    return;
  }

  changes.push({
    label,
    previousValue: normalizedPreviousValue,
    nextValue: normalizedNextValue,
  });
}

function displayAuditValue(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || 'vazio';
  }

  return 'vazio';
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
