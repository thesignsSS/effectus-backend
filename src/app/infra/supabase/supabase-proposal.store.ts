import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  CreateProposalInput,
  DeleteProposalInput,
  DeleteProposalResult,
  DeleteProposalDocumentInput,
  ProposalComment,
  ProposalCommentType,
  ProposalDetail,
  ProposalDocumentContext,
  ProposalDocumentLookup,
  ProposalListItem,
  ProposalListResult,
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

type ProposalDocumentRow = {
  id: string;
  filename: string;
  original_filename: string;
  storage_location: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
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
    const currentProposal = await this.getProposalForUpdate(
      input.proposalId,
      access.isAdmin ? undefined : input.brokerUserId,
    );
    const payload: Record<string, unknown> = {};

    if (!currentProposal) {
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
    const nextStatus = input.status;
    const nextComments = normalizeProposalComments(currentProposal.proposal_comments);
    const trimmedPendingReason = input.pendingReason?.trim() ?? '';
    const trimmedCommentMessage = input.commentMessage?.trim() ?? '';
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

        if (!canResubmit) {
          throw new Error('Apenas admin pode alterar o status da proposta');
        }

        payload.pending_reason = null;
        nextComments.push(
          buildProposalComment({
            authorName: getAccessDisplayName(access),
            authorRole: access.role,
            message: trimmedCommentMessage || 'Proposta reenviada para análise.',
            type: 'resubmission',
          }),
        );
        resubmittedForAnalysis = true;
      }

      payload.status = nextStatus;
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
            authorRole: access.role,
            message: trimmedCommentMessage,
            type: 'comment',
          }),
        );
        commentAdded = true;
      }
    }

    if (nextComments.length > 0) {
      payload.proposal_comments = nextComments;
    }

    if (Object.keys(payload).length === 0) {
      return undefined;
    }

    let query = this.client.from('proposals').update(payload).eq('id', input.proposalId);

    if (!access.isAdmin) {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    const { data, error } = await query.select('status').single();

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
    page: number;
    pageSize: number;
  }): Promise<ProposalListResult> {
    const access = await this.resolveAccess(input.brokerUserId);
    const from = (input.page - 1) * input.pageSize;
    const to = from + input.pageSize - 1;
    let query = this.client
      .from('proposals')
      .select(
        'id, proposal_number, status, broker_name, client_name, property_type, created_at, proposal_documents(count)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (access.isAdmin) {
      if (input.ownerBrokerUserId) {
        query = query.eq('broker_user_id', input.ownerBrokerUserId);
      }
    } else {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    const normalizedSearch = input.search?.trim();
    if (normalizedSearch) {
      const escapedSearch = escapeLike(normalizedSearch);
      const proposalNumber = parseProposalNumber(normalizedSearch);
      const filters = [
        `client_name.ilike.%${escapedSearch}%`,
        `broker_name.ilike.%${escapedSearch}%`,
      ];

      if (proposalNumber) {
        filters.push(`proposal_number.eq.${proposalNumber}`);
      }

      query = query.or(
        filters.join(','),
      );
    }

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Supabase proposals list failed: ${error.message}`);
    }

    const items = ((data as Array<
      Pick<ProposalRow, 'id' | 'proposal_number' | 'status' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'> & {
        proposal_documents?: Array<{ count: number | null }>;
      }
    > | null) ?? []).map((item) => this.toProposalListItem(item));

    return {
      items,
      total: count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async countPendingByBroker(input: { brokerUserId: string }): Promise<number> {
    const { count, error } = await this.client
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('broker_user_id', input.brokerUserId)
      .eq('status', 'pendente');

    if (error) {
      throw new Error(`Supabase pending proposals count failed: ${error.message}`);
    }

    return count ?? 0;
  }

  async getById(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDetail | null> {
    const access = await this.resolveAccess(input.brokerUserId);
    let query = this.client
      .from('proposals')
      .select(`
        id,
        proposal_number,
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
          uploaded_at
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

      throw new Error(`Supabase proposal get failed: ${error.message}`);
    }

    return this.toProposalDetail(
      data as ProposalRow & { proposal_documents?: ProposalDocumentRow[] | null },
    );
  }

  async getDocument(input: {
    brokerUserId: string;
    proposalId: string;
    documentId: string;
  }): Promise<ProposalDocumentLookup | null> {
    const access = await this.resolveAccess(input.brokerUserId);
    let query = this.client
      .from('proposal_documents')
      .select(`
        id,
        filename,
        original_filename,
        storage_location,
        content_type,
        size_bytes,
        uploaded_at,
        proposals!inner (
          id,
          broker_user_id
        )
      `)
      .eq('id', input.documentId)
      .eq('proposal_id', input.proposalId);

    if (!access.isAdmin) {
      query = query.eq('proposals.broker_user_id', input.brokerUserId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal document get failed: ${error.message}`);
    }

    return this.toDocumentLookup(data as ProposalDocumentRow);
  }

  async renameDocument(input: RenameProposalDocumentInput): Promise<void> {
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
  }

  async deleteDocument(
    input: DeleteProposalDocumentInput,
  ): Promise<ProposalDocumentLookup | null> {
    const document = await this.getDocument(input);
    if (!document) {
      return null;
    }

    const { error } = await this.client
      .from('proposal_documents')
      .delete()
      .eq('id', input.documentId)
      .eq('proposal_id', input.proposalId);

    if (error) {
      throw new Error(`Supabase proposal document delete failed: ${error.message}`);
    }

    return document;
  }

  async delete(input: DeleteProposalInput): Promise<DeleteProposalResult | null> {
    const access = await this.resolveAccess(input.brokerUserId);
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
  }): Promise<void> {
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
      })),
    );

    if (error) {
      throw new Error(`Supabase proposal documents add failed: ${error.message}`);
    }
  }

  async getProposalContext(input: {
    brokerUserId: string;
    proposalId: string;
  }): Promise<ProposalDocumentContext | null> {
    const access = await this.resolveAccess(input.brokerUserId);
    let query = this.client
      .from('proposals')
      .select('id, broker_user_id, broker_name, client_name')
      .eq('id', input.proposalId);

    if (!access.isAdmin) {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    const { data, error } = await query.single();

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

  private toProposalListItem(
    row: Pick<ProposalRow, 'id' | 'proposal_number' | 'status' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'> & {
      proposal_documents?: Array<{ count: number | null }>;
    },
  ): ProposalListItem {
    const status = toStatusInfo(row.status);

    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
      ...status,
      clientName: row.client_name ?? '',
      brokerName: row.broker_name ?? '',
      propertyType: row.property_type ?? '',
      createdAt: row.created_at,
      documentsCount: row.proposal_documents?.[0]?.count ?? 0,
    };
  }

  private toProposalDetail(
    row: ProposalRow & { proposal_documents?: ProposalDocumentRow[] | null },
  ): ProposalDetail {
    const status = toStatusInfo(row.status);

    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
      ...status,
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
      comments: normalizeProposalComments(row.proposal_comments),
      documents: (row.proposal_documents ?? []).map((document) => ({
        id: document.id,
        filename: document.filename,
        originalFilename: document.original_filename,
        displayName: document.original_filename,
        contentType: document.content_type,
        sizeBytes: document.size_bytes,
        uploadedAt: document.uploaded_at,
        storageLocation: document.storage_location,
      })),
    };
  }

  private toDocumentLookup(row: ProposalDocumentRow): ProposalDocumentLookup {
    return {
      id: row.id,
      filename: row.filename,
      originalFilename: row.original_filename,
      storageLocation: row.storage_location,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      uploadedAt: row.uploaded_at,
    };
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

  private async getProposalForUpdate(
    proposalId: string,
    brokerUserId?: string,
  ): Promise<(Pick<ProposalRow, 'status' | 'proposal_comments' | 'broker_name' | 'broker_phone'> & {
    proposalCode: string;
    broker_user_id: string;
  }) | null> {
    let query = this.client
      .from('proposals')
      .select('status, proposal_comments, broker_name, broker_phone, broker_user_id, proposal_number')
      .eq('id', proposalId);

    if (brokerUserId) {
      query = query.eq('broker_user_id', brokerUserId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }

      throw new Error(`Supabase proposal update context failed: ${error.message}`);
    }

    const row = data as Pick<ProposalRow, 'status' | 'proposal_comments' | 'broker_name' | 'broker_phone'> & {
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

    return [{
      id: record.id,
      authorName: record.authorName,
      authorRole: record.authorRole,
      createdAt: record.createdAt,
      message: record.message,
      type,
    }];
  });
}

function normalizeCommentType(value: unknown): ProposalCommentType {
  if (value === 'pending_reason' || value === 'resubmission') {
    return value;
  }

  return 'comment';
}

function buildProposalComment(input: {
  authorName: string;
  authorRole: UserRole;
  message: string;
  type: ProposalCommentType;
}): ProposalComment {
  return {
    id: randomUUID(),
    authorName: input.authorName,
    authorRole: input.authorRole,
    createdAt: new Date().toISOString(),
    message: input.message,
    type: input.type,
  };
}

function getAccessDisplayName(access: { role: UserRole; fullName: string }): string {
  return access.fullName || (access.role === 'admin' ? 'Administrador' : 'Corretor');
}

function escapeLike(value: string): string {
  return value.replace(/[,%]/g, '');
}

function parseProposalNumber(value: string): number | null {
  const digits = value.replace(/^(RB|PROP)-/i, '').replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  return Number(digits);
}
