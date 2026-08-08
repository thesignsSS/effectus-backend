import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  CreateEngineeringRequestInput,
  DeleteEngineeringRequestInput,
  DeleteEngineeringRequestResult,
  ENGINEERING_REQUEST_STATUS_OPTIONS,
  EngineeringRequestComment,
  EngineeringRequestDetail,
  EngineeringRequestDocumentItem,
  EngineeringRequestListItem,
  EngineeringRequestListResult,
  EngineeringRequestStatus,
  EngineeringRequestStatusInfo,
  EngineeringRequestStore,
  UpdateEngineeringRequestInput,
  formatEngineeringRequestCode,
} from '../../domain/interfaces/engineering-request-store.interface.js';
import type { UserRole } from '../../domain/interfaces/profile-store.interface.js';

export interface SupabaseEngineeringRequestStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type ResolvedAccess = {
  isAdmin: boolean;
  role: UserRole;
  fullName: string;
};

type ResolvedRequestAccess = {
  ownerBrokerUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
};

type EngineeringRequestDocumentRow = {
  id: string;
  document_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export class SupabaseEngineeringRequestStore implements EngineeringRequestStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseEngineeringRequestStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to save engineering requests',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async create(
    input: CreateEngineeringRequestInput,
  ): Promise<{ id: string; requestNumber: number }> {
    const { data: engineeringRequest, error: requestError } = await this.client
      .from('engineering_requests')
      .insert({
        broker_user_id: input.brokerUserId,
        property_kind: input.propertyKind,
        property_value: input.propertyValue,
        contact_phone: input.contactPhone,
        accompanying_name: input.accompanyingName,
        form_data: input.formData,
      })
      .select('id, request_number')
      .single();

    if (requestError || !engineeringRequest) {
      throw new Error(
        `Supabase engineering request create failed: ${requestError?.message ?? 'unknown error'}`,
      );
    }

    if (input.documents.length > 0) {
      const { error: documentsError } = await this.client
        .from('engineering_request_documents')
        .insert(
          input.documents.map((document) => ({
            request_id: engineeringRequest.id,
            document_key: document.documentKey,
            original_filename: document.originalFilename,
            storage_location: document.storageLocation,
            content_type: document.contentType,
            size_bytes: document.sizeBytes,
            uploaded_at: document.uploadedAt,
          })),
        );

      if (documentsError) {
        throw new Error(
          `Supabase engineering request documents create failed: ${documentsError.message}`,
        );
      }
    }

    return {
      id: engineeringRequest.id,
      requestNumber: engineeringRequest.request_number,
    };
  }

  async listByBroker(input: {
    brokerUserId: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<EngineeringRequestListResult> {
    const access = await this.resolveAccess(input.brokerUserId);

    let query = this.client
      .from('engineering_requests')
      .select(
        'id, request_number, broker_user_id, property_kind, property_value, accompanying_name, status, created_at',
        { count: 'exact' },
      );

    if (!access.isAdmin) {
      query = query.eq('broker_user_id', input.brokerUserId);
    }

    if (input.search) {
      query = query.ilike('accompanying_name', `%${input.search}%`);
    }

    const from = (input.page - 1) * input.pageSize;
    const to = from + input.pageSize - 1;

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Supabase engineering requests list failed: ${error.message}`);
    }

    const rows = data ?? [];
    const requestIds = rows.map((row) => row.id);
    const ownerIds = Array.from(new Set(rows.map((row) => row.broker_user_id)));

    const [ownerNames, documentCounts] = await Promise.all([
      this.getProfileNames(ownerIds),
      this.getDocumentCounts(requestIds),
    ]);

    const items: EngineeringRequestListItem[] = rows.map((row) => ({
      id: row.id,
      requestCode: formatEngineeringRequestCode(row.request_number),
      ...toStatusInfo(row.status),
      ownerBrokerUserId: row.broker_user_id,
      ownerName: ownerNames.get(row.broker_user_id) ?? 'Corretor',
      isOwnedByCurrentUser: row.broker_user_id === input.brokerUserId,
      accompanyingName: row.accompanying_name,
      propertyKind: row.property_kind,
      propertyValue: Number(row.property_value),
      createdAt: row.created_at,
      documentsCount: documentCounts.get(row.id) ?? 0,
    }));

    return {
      items,
      total: count ?? items.length,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async getById(input: {
    brokerUserId: string;
    requestId: string;
  }): Promise<EngineeringRequestDetail | null> {
    const requestAccess = await this.resolveRequestAccess(
      input.requestId,
      input.brokerUserId,
    );

    if (!requestAccess) {
      return null;
    }

    const { data, error } = await this.client
      .from('engineering_requests')
      .select(
        'id, request_number, broker_user_id, property_kind, property_value, contact_phone, accompanying_name, status, comments, created_at, engineering_request_documents ( id, document_key, original_filename, content_type, size_bytes, uploaded_at )',
      )
      .eq('id', input.requestId)
      .single();

    if (error || !data) {
      return null;
    }

    const ownerNames = await this.getProfileNames([data.broker_user_id]);
    const documents = (data.engineering_request_documents ??
      []) as EngineeringRequestDocumentRow[];

    return {
      id: data.id,
      requestCode: formatEngineeringRequestCode(data.request_number),
      ...toStatusInfo(data.status),
      ownerBrokerUserId: data.broker_user_id,
      ownerName: ownerNames.get(data.broker_user_id) ?? 'Corretor',
      isOwnedByCurrentUser: requestAccess.isOwner,
      canEdit: requestAccess.isAdmin || requestAccess.isOwner,
      canDelete: requestAccess.isAdmin || requestAccess.isOwner,
      propertyKind: data.property_kind,
      propertyValue: Number(data.property_value),
      contactPhone: data.contact_phone,
      accompanyingName: data.accompanying_name,
      createdAt: data.created_at,
      documents: documents.map((document) => toDocumentItem(document)),
      comments: normalizeEngineeringRequestComments(data.comments),
    };
  }

  async update(
    input: UpdateEngineeringRequestInput,
  ): Promise<EngineeringRequestStatusInfo | undefined> {
    const requestAccess = await this.resolveRequestAccess(
      input.requestId,
      input.brokerUserId,
    );

    if (!requestAccess) {
      throw new Error('Solicitação de engenharia não encontrada');
    }

    if (input.status !== undefined && !requestAccess.isAdmin) {
      throw new Error('Apenas admin pode alterar o status da solicitação');
    }

    const updates: Record<string, unknown> = {};

    if (input.propertyKind !== undefined) {
      updates.property_kind = input.propertyKind;
    }
    if (input.propertyValue !== undefined) {
      updates.property_value = input.propertyValue;
    }
    if (input.contactPhone !== undefined) {
      updates.contact_phone = input.contactPhone;
    }
    if (input.accompanyingName !== undefined) {
      updates.accompanying_name = input.accompanyingName;
    }
    if (input.status !== undefined) {
      updates.status = input.status;
    }

    if (Object.keys(updates).length > 0) {
      let updateQuery = this.client
        .from('engineering_requests')
        .update(updates)
        .eq('id', input.requestId);

      if (!requestAccess.isAdmin) {
        updateQuery = updateQuery.eq('broker_user_id', input.brokerUserId);
      }

      const { error } = await updateQuery;

      if (error) {
        throw new Error(`Supabase engineering request update failed: ${error.message}`);
      }
    }

    if (input.commentMessage && input.commentMessage.trim()) {
      const access = await this.resolveAccess(input.brokerUserId);
      await this.appendComment(input.requestId, input.brokerUserId, access, input.commentMessage.trim());
    }

    const { data, error: fetchError } = await this.client
      .from('engineering_requests')
      .select('status')
      .eq('id', input.requestId)
      .single();

    if (fetchError || !data) {
      return undefined;
    }

    return toStatusInfo(data.status);
  }

  async delete(
    input: DeleteEngineeringRequestInput,
  ): Promise<DeleteEngineeringRequestResult | null> {
    const requestAccess = await this.resolveRequestAccess(
      input.requestId,
      input.brokerUserId,
    );

    if (!requestAccess) {
      return null;
    }

    const { data, error } = await this.client
      .from('engineering_requests')
      .select('id, engineering_request_documents ( storage_location )')
      .eq('id', input.requestId)
      .single();

    if (error || !data) {
      return null;
    }

    const documentLocations = (
      (data.engineering_request_documents ?? []) as Array<{
        storage_location: string | null;
      }>
    )
      .map((document) => document.storage_location?.trim() ?? '')
      .filter(Boolean);

    let deleteQuery = this.client
      .from('engineering_requests')
      .delete()
      .eq('id', input.requestId);

    if (!requestAccess.isAdmin) {
      deleteQuery = deleteQuery.eq('broker_user_id', input.brokerUserId);
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      throw new Error(`Supabase engineering request delete failed: ${deleteError.message}`);
    }

    return { requestId: input.requestId, documentLocations };
  }

  private async appendComment(
    requestId: string,
    actorUserId: string,
    access: ResolvedAccess,
    message: string,
  ): Promise<void> {
    const { data, error } = await this.client
      .from('engineering_requests')
      .select('comments')
      .eq('id', requestId)
      .single();

    if (error || !data) {
      throw new Error('Solicitação de engenharia não encontrada');
    }

    const nextComments = normalizeEngineeringRequestComments(data.comments);
    nextComments.push({
      id: randomUUID(),
      authorName: access.fullName || (access.role === 'admin' ? 'Administrador' : 'Corretor'),
      authorUserId: actorUserId,
      authorRole: access.role,
      createdAt: new Date().toISOString(),
      message,
    });

    const { error: updateError } = await this.client
      .from('engineering_requests')
      .update({ comments: nextComments })
      .eq('id', requestId);

    if (updateError) {
      throw new Error(
        `Supabase engineering request comment append failed: ${updateError.message}`,
      );
    }
  }

  private async resolveAccess(userId: string): Promise<ResolvedAccess> {
    const { data, error } = await this.client
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return { isAdmin: false, role: 'broker', fullName: '' };
    }

    const role: UserRole = data.role === 'admin' ? 'admin' : 'broker';

    return { isAdmin: role === 'admin', role, fullName: data.full_name ?? '' };
  }

  private async resolveRequestAccess(
    requestId: string,
    userId: string,
  ): Promise<ResolvedRequestAccess | null> {
    const access = await this.resolveAccess(userId);

    const { data, error } = await this.client
      .from('engineering_requests')
      .select('broker_user_id')
      .eq('id', requestId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const isOwner = data.broker_user_id === userId;

    if (!access.isAdmin && !isOwner) {
      return null;
    }

    return { ownerBrokerUserId: data.broker_user_id, isOwner, isAdmin: access.isAdmin };
  }

  private async getProfileNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    if (error || !data) {
      return new Map();
    }

    return new Map(data.map((row) => [row.id, row.full_name ?? 'Corretor']));
  }

  private async getDocumentCounts(requestIds: string[]): Promise<Map<string, number>> {
    if (requestIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from('engineering_request_documents')
      .select('request_id')
      .in('request_id', requestIds);

    if (error || !data) {
      return new Map();
    }

    const counts = new Map<string, number>();

    for (const row of data) {
      counts.set(row.request_id, (counts.get(row.request_id) ?? 0) + 1);
    }

    return counts;
  }
}

function toDocumentItem(
  row: EngineeringRequestDocumentRow,
): EngineeringRequestDocumentItem {
  return {
    id: row.id,
    documentKey: row.document_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

function toStatusInfo(status: string | null | undefined): EngineeringRequestStatusInfo {
  const option = ENGINEERING_REQUEST_STATUS_OPTIONS.find(
    (candidate) => candidate.value === status,
  );

  if (!option) {
    return { status: 'solicitar_engenharia', statusLabel: 'Solicitar Engenharia' };
  }

  return { status: option.value as EngineeringRequestStatus, statusLabel: option.label };
}

function normalizeEngineeringRequestComments(value: unknown): EngineeringRequestComment[] {
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

    return [
      {
        id: record.id,
        authorName: record.authorName,
        authorUserId:
          typeof record.authorUserId === 'string' && record.authorUserId
            ? record.authorUserId
            : null,
        authorRole: record.authorRole,
        createdAt: record.createdAt,
        message: record.message,
      },
    ];
  });
}
