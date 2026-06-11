import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CreateProposalInput,
  DeleteProposalDocumentInput,
  ProposalDetail,
  ProposalDocumentContext,
  ProposalDocumentLookup,
  ProposalListItem,
  ProposalListResult,
  ProposalStore,
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
  broker_name: string | null;
  client_name: string | null;
  client_cpf: string | null;
  client_email: string | null;
  client_phone: string | null;
  property_type: string | null;
  property_city: string | null;
  property_state: string | null;
  additional_info: string | null;
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

  async create(input: CreateProposalInput): Promise<{ id: string; proposalCode: string }> {
    const { data: proposal, error: proposalError } = await this.client
      .from('proposals')
      .insert({
        broker_user_id: input.brokerUserId,
        broker_name: input.brokerName,
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
      .select('id, proposal_number')
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
    };
  }

  async update(input: UpdateProposalInput): Promise<void> {
    const access = await this.resolveAccess(input.brokerUserId);
    const payload: Record<string, unknown> = {};

    if (input.clientName !== undefined) payload.client_name = input.clientName;
    if (input.clientCpf !== undefined) payload.client_cpf = input.clientCpf;
    if (input.clientEmail !== undefined) payload.client_email = input.clientEmail;
    if (input.clientPhone !== undefined) payload.client_phone = input.clientPhone;
    if (input.propertyType !== undefined) payload.property_type = input.propertyType;
    if (input.propertyCity !== undefined) payload.property_city = input.propertyCity;
    if (input.propertyState !== undefined) payload.property_state = input.propertyState;
    if (input.additionalInfo !== undefined) payload.additional_info = input.additionalInfo;
    if (input.formData !== undefined) payload.form_data = input.formData;

    if (Object.keys(payload).length === 0) {
      return;
    }

    let query = this.client
      .from('proposals')
      .update(payload)
      .eq('id', input.proposalId);

    if (!access.isAdmin) {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Supabase proposal update failed: ${error.message}`);
    }
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
        'id, proposal_number, broker_name, client_name, property_type, created_at, proposal_documents(count)',
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
      Pick<ProposalRow, 'id' | 'proposal_number' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'> & {
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
        broker_name,
        client_name,
        client_cpf,
        client_email,
        client_phone,
        property_type,
        property_city,
        property_state,
        additional_info,
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
    row: Pick<ProposalRow, 'id' | 'proposal_number' | 'broker_name' | 'client_name' | 'property_type' | 'created_at'> & {
      proposal_documents?: Array<{ count: number | null }>;
    },
  ): ProposalListItem {
    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
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
    return {
      id: row.id,
      proposalCode: formatProposalCode(row.proposal_number),
      brokerName: row.broker_name ?? '',
      createdAt: row.created_at,
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

  private async resolveAccess(userId: string): Promise<{ isAdmin: boolean; role: UserRole }> {
    const { data, error } = await this.client
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { isAdmin: false, role: 'broker' };
      }

      throw new Error(`Supabase profile role get failed: ${error.message}`);
    }

    const role = (data.role === 'admin' ? 'admin' : 'broker') as UserRole;
    return {
      isAdmin: role === 'admin',
      role,
    };
  }
}

function formatProposalCode(proposalNumber: number): string {
  return `RB-${String(proposalNumber).padStart(4, '0')}`;
}

function escapeLike(value: string): string {
  return value.replace(/[,%]/g, '');
}

function parseProposalNumber(value: string): number | null {
  const digits = value.replace(/^RB-/i, '').replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  return Number(digits);
}
