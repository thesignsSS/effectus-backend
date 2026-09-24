import http, { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { ProfileStore } from '../../domain/interfaces/profile-store.interface.js';
import { TeamStore } from '../../domain/interfaces/team-store.interface.js';
import {
  PROPOSAL_STATUS_OPTIONS,
  ProposalStatus,
  ProposalStore,
  ProposalUpdateEffects,
} from '../../domain/interfaces/proposal-store.interface.js';
import { OneDriveService } from '../../services/onedrive.service.js';
import { ChatService } from '../../services/chat.service.js';
import { NotificationService } from '../../services/notification.service.js';
import {
  AssistantChatMessage,
  EffectusAssistantService,
} from '../../services/effectus-assistant.service.js';
import { GmailSmtpEmailService } from '../../services/gmail-smtp-email.service.js';
import { ProposalEmailReplySyncService } from '../../services/proposal-email-reply-sync.service.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { ChatRealtimeGateway } from './chat-realtime.gateway.js';
import { WebQrCodePresenter } from '../qrcode/web-qr-code.presenter.js';
import {
  FormSubmissionDocument,
  FormSubmissionInput,
  ProcessFormSubmissionUseCase,
} from '../../use-cases/process-form-submission.usecase.js';
import {
  EngineeringRequestDocument,
  ProcessEngineeringRequestInput,
  ProcessEngineeringRequestUseCase,
} from '../../use-cases/process-engineering-request.usecase.js';
import {
  ENGINEERING_REQUEST_STATUS_OPTIONS,
  EngineeringPropertyKind,
  EngineeringRequestStatus,
  EngineeringRequestStore,
  formatEngineeringRequestCode,
} from '../../domain/interfaces/engineering-request-store.interface.js';
import {
  generateDocumentFileName,
  getContentTypeByFilename,
  getFileExtension,
  isValidExtension,
} from '../../utils/file-validator.js';

export interface FormSubmissionHttpServerConfig {
  port: number;
  maxBodyBytes: number;
  apiKey?: string;
  effectusAppBaseUrl?: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type EmailAttachmentInput =
  | {
      type: 'proposal_document';
      documentId: string;
      filename?: string;
    }
  | {
      type: 'uploaded_file';
      filename: string;
      contentType?: string;
      base64Content: string;
    };

export class FormSubmissionHttpServer {
  private server?: http.Server;

  constructor(
    private readonly config: FormSubmissionHttpServerConfig,
    private readonly processFormSubmission: ProcessFormSubmissionUseCase,
    private readonly processEngineeringRequest: ProcessEngineeringRequestUseCase,
    private readonly engineeringRequestStore: EngineeringRequestStore,
    private readonly profileStore: ProfileStore,
    private readonly teamStore: TeamStore,
    private readonly proposalStore: ProposalStore,
    private readonly storageService: OneDriveService,
    private readonly chatService: ChatService,
    private readonly notificationService: NotificationService,
    private readonly effectusAssistantService: EffectusAssistantService,
    private readonly chatRealtimeGateway: ChatRealtimeGateway,
    private readonly whatsAppService: WhatsAppService,
    private readonly webQrCodePresenter: WebQrCodePresenter,
    private readonly gmailSmtpEmailService: GmailSmtpEmailService,
    private readonly proposalEmailReplySyncService: ProposalEmailReplySyncService,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    this.chatRealtimeGateway.attach(this.server);

    this.server.listen(this.config.port, () => {
      this.logger.info('Servidor HTTP de cadastro iniciado', {
        port: this.config.port,
        endpoint: '/api/form-submissions',
      });
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET' && requestUrl.pathname === '/api/elias') {
      this.sendJson(response, 200, { message: 'Elias Lindo' });
      return;
    }

    if (!this.isAuthorized(request)) {
      this.sendJson(response, 401, { ok: false, error: 'Não autorizado' });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/me') {
      await this.handleGetCurrentProfile(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/profiles/search') {
      await this.handleSearchProfiles(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname === '/api/profiles/preferences-insights'
    ) {
      await this.handlePreferenceInsights(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/team') {
      await this.handleListTeam(requestUrl, response);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/team/invite') {
      await this.handleInviteTeamMember(request, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/team\/[^/]+\/reset-password$/)
    ) {
      await this.handleResetTeamMemberPassword(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/team\/[^/]+$/)
    ) {
      await this.handleDeleteTeamMember(request, requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/notifications') {
      await this.handleListNotifications(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/invitations') {
      await this.handleListInvitations(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/invitations/pending-summary') {
      await this.handlePendingInvitationsSummary(requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/invitations\/[^/]+$/)
    ) {
      await this.handleRespondInvitation(request, requestUrl, response);
      return;
    }

    if (request.method === 'PATCH' && requestUrl.pathname === '/api/notifications/read-all') {
      await this.handleMarkAllNotificationsAsRead(request, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/notifications\/[^/]+\/read$/)
    ) {
      await this.handleMarkNotificationAsRead(request, requestUrl, response);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/assistant/chat') {
      await this.handleAssistantChat(request, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/admin/whatsapp/state') {
      await this.handleAdminWhatsAppState(requestUrl, response);
      return;
    }

    if (request.method === 'DELETE' && requestUrl.pathname === '/api/admin/whatsapp/session') {
      await this.handleAdminWhatsAppSessionReset(request, requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/chat/users') {
      await this.handleListChatUsers(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/chat/conversations') {
      await this.handleListChatConversations(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/chat/conversations/direct'
    ) {
      await this.handleOpenDirectChatConversation(request, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/chat\/conversations\/[^/]+\/messages$/)
    ) {
      await this.handleListChatMessages(requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/chat\/conversations\/[^/]+\/read$/)
    ) {
      await this.handleMarkChatConversationAsRead(request, requestUrl, response);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/chat/messages') {
      await this.handleSendChatMessage(request, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/proposals/statuses') {
      this.sendJson(response, 200, {
        items: PROPOSAL_STATUS_OPTIONS,
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/proposals/pending-summary') {
      await this.handlePendingProposalsSummary(requestUrl, response);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/proposals') {
      await this.handleListProposals(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/proposal-share-links\/[^/]+$/)
    ) {
      await this.handleGetProposalSharePreview(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposal-share-links\/[^/]+\/accept$/)
    ) {
      await this.handleAcceptProposalShareLink(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/download$/)
    ) {
      await this.handleDownloadProposal(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/share-link$/)
    ) {
      await this.handleCreateProposalShareLink(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/invitations$/)
    ) {
      await this.handleCreateProposalInvitation(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/guests\/[^/]+$/)
    ) {
      await this.handleRemoveProposalGuest(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/documents\/[^/]+\/download$/)
    ) {
      await this.handleDownloadProposalDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/documents\/[^/]+\/view$/)
    ) {
      await this.handleViewProposalDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/documents$/)
    ) {
      await this.handleAddProposalDocuments(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/documents\/[^/]+$/)
    ) {
      await this.handleRenameProposalDocument(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/documents\/[^/]+$/)
    ) {
      await this.handleDeleteProposalDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/income-validation-test-email$/)
    ) {
      await this.handleSendIncomeValidationTestEmail(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/send-email$/)
    ) {
      await this.handleSendProposalEmail(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+$/)
    ) {
      await this.handleDeleteProposal(requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+$/)
    ) {
      await this.handleUpdateProposal(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+$/)
    ) {
      await this.handleGetProposal(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname === '/api/engineering-requests'
    ) {
      await this.handleCreateEngineeringRequest(request, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname === '/api/engineering-requests'
    ) {
      await this.handleListEngineeringRequests(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+$/)
    ) {
      await this.handleGetEngineeringRequest(requestUrl, response);
      return;
    }

    if (
      request.method === 'POST' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+\/documents$/)
    ) {
      await this.handleAddEngineeringRequestDocuments(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+\/documents\/[^/]+$/)
    ) {
      await this.handleRenameEngineeringRequestDocument(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+\/documents\/[^/]+$/)
    ) {
      await this.handleDeleteEngineeringRequestDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+\/documents\/[^/]+\/view$/)
    ) {
      await this.handleViewEngineeringRequestDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'GET' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+\/documents\/[^/]+\/download$/)
    ) {
      await this.handleDownloadEngineeringRequestDocument(requestUrl, response);
      return;
    }

    if (
      request.method === 'PATCH' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+$/)
    ) {
      await this.handleUpdateEngineeringRequest(request, requestUrl, response);
      return;
    }

    if (
      request.method === 'DELETE' &&
      requestUrl.pathname.match(/^\/api\/engineering-requests\/[^/]+$/)
    ) {
      await this.handleDeleteEngineeringRequest(requestUrl, response);
      return;
    }

    if (request.method !== 'POST' || requestUrl.pathname !== '/api/form-submissions') {
      this.sendJson(response, 404, { error: 'Endpoint não encontrado' });
      return;
    }

    try {
      const payload = await this.readJsonBody(request);
      const input = this.toFormSubmissionInput(payload);
      const result = await this.processFormSubmission.execute(input);

      if (result.proposalId && result.proposalCode) {
        await this.notificationService.notifyAdminsAboutSubmittedProposal({
          proposalId: result.proposalId,
          proposalCode: result.proposalCode,
          brokerName: input.brokerName,
        });
      }

      this.sendJson(response, 201, {
        ok: true,
        proposalId: result.proposalId ?? null,
        proposalCode: result.proposalCode ?? null,
        status: result.proposalStatus ?? null,
        statusLabel: result.proposalStatusLabel ?? null,
        savedClient: result.savedClient,
        uploadedFiles: result.uploadedLocations.length,
        locations: result.uploadedLocations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error('Falha ao processar endpoint de cadastro', {
        error: message,
      });

      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleCreateEngineeringRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const input = this.toEngineeringRequestInput(payload);
      const result = await this.processEngineeringRequest.execute(input);

      this.sendJson(response, 201, {
        ok: true,
        requestId: result.requestId,
        requestCode: formatEngineeringRequestCode(result.requestNumber),
        uploadedFiles: result.uploadedLocations.length,
        locations: result.uploadedLocations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error('Falha ao processar solicitação de engenharia', {
        error: message,
      });

      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private toEngineeringRequestInput(payload: JsonObject): ProcessEngineeringRequestInput {
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const brokerName = readRequiredString(payload, 'brokerName', 'corretor');
    const propertyKind = readRequiredPropertyKind(payload);
    const propertyValue = readRequiredNumber(payload, 'propertyValue', 'valorImovel');
    const contactPhone = readRequiredString(payload, 'contactPhone', 'contato');
    const accompanyingName = readRequiredString(
      payload,
      'accompanyingName',
      'nomeAcompanhante',
    );
    const documents = readEngineeringDocuments(payload.documents);

    return {
      brokerUserId,
      brokerName,
      propertyKind,
      propertyValue,
      contactPhone,
      accompanyingName,
      documents,
    };
  }

  private async handleListEngineeringRequests(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    const page = Math.max(1, Number(requestUrl.searchParams.get('page') ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(requestUrl.searchParams.get('pageSize') ?? 20)),
    );
    const search = requestUrl.searchParams.get('search')?.trim() ?? undefined;

    try {
      const result = await this.engineeringRequestStore.listByBroker({
        brokerUserId,
        search,
        page,
        pageSize,
      });

      this.sendJson(response, 200, {
        items: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar solicitações de engenharia', {
        error: message,
        brokerUserId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleGetEngineeringRequest(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    const requestId = getRequiredPathSegment(requestUrl.pathname, 2, 'requestId');

    try {
      const engineeringRequest = await this.engineeringRequestStore.getById({
        brokerUserId,
        requestId,
      });

      if (!engineeringRequest) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Solicitação de engenharia não encontrada',
        });
        return;
      }

      this.sendJson(response, 200, engineeringRequest as unknown as JsonObject);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao buscar solicitação de engenharia', {
        error: message,
        brokerUserId,
        requestId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleUpdateEngineeringRequest(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    let requestId: string | undefined;
    let brokerUserId: string | undefined;

    try {
      const payload = await this.readJsonBody(request);
      brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
      requestId = getRequiredPathSegment(requestUrl.pathname, 2, 'requestId');

      const result = await this.engineeringRequestStore.update({
        requestId,
        brokerUserId,
        propertyKind: readOptionalPropertyKind(payload),
        propertyValue: readOptionalNumber(payload, 'propertyValue', 'valorImovel'),
        contactPhone: readOptionalString(payload, 'contactPhone', 'contato'),
        accompanyingName: readOptionalString(
          payload,
          'accompanyingName',
          'nomeAcompanhante',
        ),
        status: readOptionalEngineeringStatus(payload),
        commentMessage: readOptionalString(payload, 'commentMessage', 'comentario'),
        commentScope: readOptionalString(payload, 'commentScope', 'escopoComentario'),
      });

      this.sendJson(response, 200, {
        ok: true,
        requestId,
        ...(result ? { status: result.status, statusLabel: result.statusLabel } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao atualizar solicitação de engenharia', {
        error: message,
        requestId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleDeleteEngineeringRequest(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    const requestId = getRequiredPathSegment(requestUrl.pathname, 2, 'requestId');

    try {
      const result = await this.engineeringRequestStore.delete({ requestId, brokerUserId });

      if (!result) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Solicitação de engenharia não encontrada',
        });
        return;
      }

      await Promise.all(
        result.documentLocations.map((location) =>
          this.storageService.delete(location).catch(() => undefined),
        ),
      );

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao excluir solicitação de engenharia', {
        error: message,
        requestId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleAddEngineeringRequestDocuments(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = getRequiredPathSegment(requestUrl.pathname, 2, 'requestId');

    try {
      const payload = await this.readJsonBody(request);
      const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
      const documents = readEngineeringDocuments(payload.documents);
      const engineeringRequest = await this.engineeringRequestStore.getById({
        requestId,
        brokerUserId,
      });

      if (!engineeringRequest?.canEdit) {
        this.sendJson(response, 403, { ok: false, error: 'Sem permissão para alterar esta solicitação' });
        return;
      }
      const uploadedAt = new Date().toISOString();
      const uploadedDocuments = [];

      for (const [index, document] of documents.entries()) {
        const extension = getFileExtension(document.filename);
        if (!isValidExtension(extension)) {
          throw new Error(`Extensão inválida no documento: ${document.filename}`);
        }

        const buffer = Buffer.from(document.contentBase64, 'base64');
        if (!buffer.length || buffer.toString('base64') !== normalizeBase64(document.contentBase64)) {
          throw new Error(`Base64 inválido no documento: ${document.filename}`);
        }

        const filename = `engineering-${requestId}-${Date.now()}-${index + 1}-${sanitizeFileName(document.filename)}`;
        const storageLocation = await this.storageService.upload(buffer, filename);
        uploadedDocuments.push({
          documentKey: document.documentKey,
          originalFilename: document.filename,
          storageLocation,
          contentType: getContentTypeByFilename(filename),
          sizeBytes: buffer.length,
          uploadedAt,
        });
      }

      await this.engineeringRequestStore.addDocuments({
        requestId,
        brokerUserId,
        documents: uploadedDocuments,
      });
      this.sendJson(response, 201, { ok: true, uploadedFiles: uploadedDocuments.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao adicionar documentos na solicitação de engenharia', {
        error: message,
        requestId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleRenameEngineeringRequestDocument(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      await this.engineeringRequestStore.renameDocument({
        requestId: getRequiredPathSegment(requestUrl.pathname, 2, 'requestId'),
        documentId: getRequiredPathSegment(requestUrl.pathname, 4, 'documentId'),
        brokerUserId: readRequiredString(payload, 'brokerUserId', 'corretorUserId'),
        originalFilename: readRequiredString(payload, 'originalFilename', 'filename'),
      });
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleDeleteEngineeringRequestDocument(requestUrl: URL, response: ServerResponse): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    try {
      const document = await this.engineeringRequestStore.deleteDocument({
        requestId: getRequiredPathSegment(requestUrl.pathname, 2, 'requestId'),
        documentId: getRequiredPathSegment(requestUrl.pathname, 4, 'documentId'),
        brokerUserId,
      });
      if (!document) {
        this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
        return;
      }
      await this.storageService.delete(document.storageLocation);
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleViewEngineeringRequestDocument(requestUrl: URL, response: ServerResponse): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const document = await this.engineeringRequestStore.getDocument({
      requestId: getRequiredPathSegment(requestUrl.pathname, 2, 'requestId'),
      documentId: getRequiredPathSegment(requestUrl.pathname, 4, 'documentId'),
      brokerUserId,
    });
    if (!document) {
      this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
      return;
    }
    const url = await this.storageService.createSignedUrl(document.storageLocation, 3600);
    this.sendJson(response, 200, { ok: true, url, filename: document.originalFilename });
  }

  private async handleDownloadEngineeringRequestDocument(requestUrl: URL, response: ServerResponse): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const document = await this.engineeringRequestStore.getDocument({
      requestId: getRequiredPathSegment(requestUrl.pathname, 2, 'requestId'),
      documentId: getRequiredPathSegment(requestUrl.pathname, 4, 'documentId'),
      brokerUserId,
    });
    if (!document) {
      this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
      return;
    }
    const buffer = await this.storageService.download(document.storageLocation);
    response.writeHead(200, {
      'Content-Type': document.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${sanitizeFileName(document.originalFilename)}"`,
    });
    response.end(buffer);
  }

  private async handleGetCurrentProfile(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId =
      requestUrl.searchParams.get('userId')?.trim() ??
      requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!userId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: userId',
      });
      return;
    }

    try {
      const profile = await this.profileStore.getById(userId);

      if (!profile) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Perfil não encontrado',
        });
        return;
      }

      this.sendJson(response, 200, {
        id: profile.id,
        fullName: profile.fullName,
        role: profile.role,
        isAdmin: profile.isAdmin,
        isActive: profile.isActive,
        appearsInChat: profile.appearsInChat,
        avatarPath: profile.avatarPath,
        canViewPreferencesInsights: profile.canViewPreferencesInsights,
        updatedAt: profile.updatedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao buscar perfil atual', {
        error: message,
        userId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleSearchProfiles(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = requestUrl.searchParams.get('userId')?.trim();
    const query = requestUrl.searchParams.get('query')?.trim() ?? '';

    if (!userId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: userId',
      });
      return;
    }

    if (query.length < 5) {
      this.sendJson(response, 200, { items: [] });
      return;
    }

    try {
      const profiles = await this.profileStore.searchByName({
        query,
        excludeUserId: userId,
        limit: 10,
      });

      this.sendJson(response, 200, {
        items: profiles.map((profile) => ({
          id: profile.id,
          fullName: profile.fullName,
          role: profile.role,
          isAdmin: profile.isAdmin,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao buscar perfis por nome', {
        error: message,
        userId,
        query,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleListTeam(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const requesterId = readRequiredSearchParam(requestUrl, 'userId');
      const result = await this.teamStore.list({ requesterId });
      this.sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar usuários da empresa', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleInviteTeamMember(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const requesterId = readRequiredString(payload, 'userId', 'usuarioId');
      const email = readRequiredString(payload, 'email', 'email');
      const fullName = readRequiredString(payload, 'fullName', 'nomeCompleto');
      const role = payload.role === 'admin' ? 'admin' : 'broker';

      const result = await this.teamStore.invite({
        requesterId,
        email,
        fullName,
        role,
      });

      this.sendJson(response, 201, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao convidar usuário', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleResetTeamMemberPassword(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const targetUserId = requestUrl.pathname
        .replace('/api/team/', '')
        .replace('/reset-password', '')
        .trim();
      const payload = await this.readJsonBody(request);
      const requesterId = readRequiredString(payload, 'userId', 'usuarioId');

      const result = await this.teamStore.resetPassword({
        requesterId,
        targetUserId,
      });

      this.sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao redefinir senha do usuário', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleDeleteTeamMember(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const targetUserId = requestUrl.pathname.replace('/api/team/', '').trim();
      const requesterId = readRequiredSearchParam(requestUrl, 'userId');

      await this.teamStore.remove({ requesterId, targetUserId });

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao excluir usuário', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handlePreferenceInsights(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = requestUrl.searchParams.get('userId')?.trim();

    if (!userId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: userId',
      });
      return;
    }

    try {
      const requesterProfile = await this.profileStore.getById(userId);

      if (!requesterProfile) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Perfil não encontrado',
        });
        return;
      }

      if (!requesterProfile.canViewPreferencesInsights) {
        this.sendJson(response, 403, {
          ok: false,
          error: 'Sem permissão para visualizar preferências dos usuários',
        });
        return;
      }

      const profiles = await this.profileStore.listPreferenceInsights(userId);
      const themeUsageMap = new Map<string, number>();

      let usersWithSavedPreferences = 0;
      let usersWithAvatar = 0;
      let usersUsingBrazilTheme = 0;

      for (const profile of profiles) {
        const theme = profile.preferencesSnapshot?.theme?.trim() ?? '';

        if (profile.preferencesSnapshot) {
          usersWithSavedPreferences += 1;
        }

        if (profile.avatarPath) {
          usersWithAvatar += 1;
        }

        if (theme) {
          themeUsageMap.set(theme, (themeUsageMap.get(theme) ?? 0) + 1);

          if (theme === 'brazuca' || theme === 'brazuca-dark') {
            usersUsingBrazilTheme += 1;
          }
        }
      }

      const themeUsage = Array.from(themeUsageMap.entries())
        .map(([theme, count]) => ({ theme, count }))
        .sort((leftItem, rightItem) => rightItem.count - leftItem.count);

      this.sendJson(response, 200, {
        summary: {
          totalUsers: profiles.length,
          usersWithSavedPreferences,
          usersWithAvatar,
          usersUsingBrazilTheme,
          mostUsedTheme: themeUsage[0]?.theme ?? null,
          themeUsage,
        },
        items: profiles.map((profile) => ({
          id: profile.id,
          fullName: profile.fullName,
          role: profile.role,
          isAdmin: profile.isAdmin,
          isActive: profile.isActive,
          avatarPath: profile.avatarPath,
          hasAvatar: profile.avatarPath !== null,
          canViewPreferencesInsights: profile.canViewPreferencesInsights,
          theme: profile.preferencesSnapshot?.theme ?? null,
          fontSize: profile.preferencesSnapshot?.fontSize ?? null,
          density: profile.preferencesSnapshot?.density ?? null,
          proposalsLayout: profile.preferencesSnapshot?.proposalsLayout ?? null,
          chatWallpaper: profile.preferencesSnapshot?.chatWallpaper ?? null,
          enterBehavior: profile.preferencesSnapshot?.enterBehavior ?? null,
          notificationsSound:
            typeof profile.preferencesSnapshot?.notifications?.sound === 'boolean'
              ? profile.preferencesSnapshot.notifications.sound
              : null,
          isBrazilTheme:
            profile.preferencesSnapshot?.theme === 'brazuca' ||
            profile.preferencesSnapshot?.theme === 'brazuca-dark',
          preferencesUpdatedAt: profile.preferencesUpdatedAt,
          updatedAt: profile.updatedAt,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao buscar insights de preferências', {
        error: message,
        userId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleAdminWhatsAppState(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = requestUrl.searchParams.get('userId')?.trim();

    if (!userId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: userId',
      });
      return;
    }

    try {
      await this.requireAdminUser(userId);
      const state = this.webQrCodePresenter.getConnectionStateSnapshot();

      this.sendJson(response, 200, {
        ok: true,
        connectionStatus: state.connectionStatus,
        qrCode: state.qrCode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao consultar estado do WhatsApp admin', {
        error: message,
        userId,
      });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleAdminWhatsAppSessionReset(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId =
      requestUrl.searchParams.get('userId')?.trim() ??
      (await this.readJsonBody(request).catch(() => ({} as JsonObject))).userId;

    if (typeof userId !== 'string' || !userId.trim()) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: userId',
      });
      return;
    }

    try {
      await this.requireAdminUser(userId.trim());
      await this.whatsAppService.terminateSession();
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao encerrar sessão do WhatsApp admin', {
        error: message,
        userId,
      });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handlePendingProposalsSummary(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId =
      requestUrl.searchParams.get('brokerUserId')?.trim() ??
      requestUrl.searchParams.get('userId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    try {
      const pendingCount = await this.proposalStore.countPendingByBroker({
        brokerUserId,
      });

      this.sendJson(response, 200, {
        pendingCount,
        hasPending: pendingCount > 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao consultar resumo de pendências', {
        error: message,
        brokerUserId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async requireAdminUser(userId: string) {
    const profile = await this.profileStore.getById(userId);

    if (!profile) {
      throw new Error('Perfil não encontrado');
    }

    if (!profile.isActive) {
      throw new Error('Perfil inativo');
    }

    if (!profile.isAdmin) {
      throw new Error('Apenas admin pode acessar este recurso');
    }

    return profile;
  }

  private async handleAssistantChat(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const message = readRequiredString(payload, 'message', 'pergunta');
      const routePath = readOptionalString(payload, 'routePath', 'route');
      const routeLabel = readOptionalString(payload, 'routeLabel', 'screen');
      const userName = readOptionalString(payload, 'userName', 'nomeUsuario');
      const history = readAssistantHistory(payload.history);
      const proposalContext = readAssistantProposalContext(payload.proposalContext);
      const result = await this.effectusAssistantService.answer({
        message,
        routePath,
        routeLabel,
        userName,
        history,
        proposalContext,
      });

      this.sendJson(response, 200, {
        ok: true,
        blocked: result.blocked,
        answer: result.answer,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error('Falha ao processar mensagem do assistente', {
        error: message,
      });

      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleListNotifications(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = readRequiredSearchParam(requestUrl, 'userId');

    try {
      const notifications = await this.notificationService.listByUser(userId);
      this.sendJson(response, 200, { items: notifications });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar notificações', { error: message, userId });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleListInvitations(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = readRequiredSearchParam(requestUrl, 'userId');

    try {
      const items = await this.proposalStore.listInvitationsByInvitee({
        brokerUserId,
      });
      this.sendJson(response, 200, { items });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar convites de proposta', {
        error: message,
        brokerUserId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handlePendingInvitationsSummary(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId =
      requestUrl.searchParams.get('brokerUserId')?.trim() ??
      requestUrl.searchParams.get('userId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    try {
      const pendingCount = await this.proposalStore.countPendingInvitations({
        brokerUserId,
      });

      this.sendJson(response, 200, {
        pendingCount,
        hasPending: pendingCount > 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao consultar resumo de convites pendentes', {
        error: message,
        brokerUserId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleRespondInvitation(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'userId', 'brokerUserId');
    const invitationId = getRequiredPathSegment(requestUrl.pathname, 2, 'invitationId');
    const actionValue = readRequiredString(payload, 'action', 'acao');

    if (actionValue !== 'accept' && actionValue !== 'reject') {
      this.sendJson(response, 400, { ok: false, error: 'Ação de convite inválida' });
      return;
    }

    try {
      const invitation = await this.proposalStore.respondToInvitation({
        brokerUserId,
        invitationId,
        action: actionValue,
      });

      if (!invitation) {
        this.sendJson(response, 404, { ok: false, error: 'Convite não encontrado' });
        return;
      }

      this.sendJson(response, 200, { ok: true, item: invitation });

      if (actionValue === 'accept') {
        const inviteeProfile = await this.profileStore.getById(brokerUserId);
        void this.notificationService.notifyProposalOwnerAboutNewCollaborator({
          ownerUserId: invitation.ownerBrokerUserId,
          proposalId: invitation.proposalId,
          proposalCode: invitation.proposalCode,
          guestName: inviteeProfile?.fullName?.trim() || 'Usuário convidado',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao responder convite de proposta', {
        error: message,
        brokerUserId,
        invitationId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleMarkNotificationAsRead(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const userId = readRequiredString(payload, 'userId', 'usuarioId');
    const notificationId = getRequiredPathSegment(requestUrl.pathname, 2, 'notificationId');

    try {
      await this.notificationService.markAsRead(userId, notificationId);
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao marcar notificação como lida', {
        error: message,
        userId,
        notificationId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleMarkAllNotificationsAsRead(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const userId = readRequiredString(payload, 'userId', 'usuarioId');

    try {
      await this.notificationService.markAllAsRead(userId);
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao marcar todas notificações como lidas', {
        error: message,
        userId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleListChatUsers(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = readRequiredSearchParam(requestUrl, 'userId');

    try {
      const users = await this.chatService.listDirectoryUsers(userId);
      this.sendJson(response, 200, { items: users });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar usuários do chat', { error: message, userId });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleListChatConversations(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = readRequiredSearchParam(requestUrl, 'userId');

    try {
      const conversations = await this.chatService.listConversations(userId);
      this.sendJson(response, 200, { items: conversations });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar conversas do chat', { error: message, userId });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleOpenDirectChatConversation(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const userId = readRequiredString(payload, 'userId', 'usuarioId');
      const targetUserId = readRequiredString(payload, 'targetUserId', 'destinatarioId');
      const conversation = await this.chatService.openDirectConversation(
        userId,
        targetUserId,
      );

      this.sendJson(response, 200, { item: conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao abrir conversa direta do chat', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleListChatMessages(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const userId = readRequiredSearchParam(requestUrl, 'userId');
    const conversationId = getRequiredPathSegment(requestUrl.pathname, 3, 'conversationId');

    try {
      const conversation = await this.chatService.getConversationById(userId, conversationId);

      if (!conversation) {
        this.sendJson(response, 404, { ok: false, error: 'Conversa não encontrada' });
        return;
      }

      const messages = await this.chatService.listMessages(userId, conversationId);
      this.sendJson(response, 200, {
        conversation,
        items: messages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar mensagens do chat', {
        error: message,
        userId,
        conversationId,
      });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleMarkChatConversationAsRead(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const userId = readRequiredString(payload, 'userId', 'usuarioId');
      const conversationId = getRequiredPathSegment(requestUrl.pathname, 3, 'conversationId');

      await this.chatService.markConversationAsRead(userId, conversationId);
      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao marcar conversa do chat como lida', {
        error: message,
      });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private async handleSendChatMessage(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const payload = await this.readJsonBody(request);
      const userId = readRequiredString(payload, 'userId', 'usuarioId');
      const recipientUserId = readRequiredString(
        payload,
        'recipientUserId',
        'destinatarioId',
      );
      const content = readRequiredString(payload, 'content', 'mensagem');
      const result = await this.chatService.sendMessage({
        senderUserId: userId,
        recipientUserId,
        content,
      });
      const recipientConversation = await this.chatService.getConversationById(
        result.recipient.id,
        result.conversation.id,
      );

      this.chatRealtimeGateway.emitChatMessage([userId], {
        conversation: result.conversation,
        message: result.message,
      });

      if (recipientConversation) {
        this.chatRealtimeGateway.emitChatMessage([result.recipient.id], {
          conversation: recipientConversation,
          message: result.message,
        });
      }

      if (result.notification) {
        this.chatRealtimeGateway.emitNotification(result.recipient.id, result.notification);
      }

      this.sendJson(response, 201, {
        conversation: result.conversation,
        message: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao enviar mensagem do chat', { error: message });
      this.sendJson(response, this.statusFromError(message), {
        ok: false,
        error: message,
      });
    }
  }

  private readJsonBody(request: IncomingMessage): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;

        if (totalBytes > this.config.maxBodyBytes) {
          request.destroy();
          reject(new Error('Payload excede o limite permitido'));
          return;
        }

        chunks.push(chunk);
      });

      request.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(body) as unknown;

          if (!isJsonObject(parsed)) {
            reject(new Error('Payload precisa ser um objeto JSON'));
            return;
          }

          resolve(parsed);
        } catch {
          reject(new Error('JSON inválido'));
        }
      });

      request.on('error', reject);
    });
  }

  private toFormSubmissionInput(payload: JsonObject): FormSubmissionInput {
    const brokerUserId = readOptionalString(
      payload,
      'brokerUserId',
      'corretorUserId',
    );
    const brokerName = readRequiredString(payload, 'brokerName', 'corretor');
    const brokerPhone =
      readOptionalString(payload, 'brokerPhone', 'corretorWpp') ??
      readOptionalString(payload, 'whatsappCorretor', 'wppCorretor');
    const clientName = readRequiredString(payload, 'clientName', 'cliente');
    const documents = readDocuments(payload.documents);
    const formData = readFormData(payload);

    return {
      brokerUserId,
      brokerName,
      brokerPhone,
      clientName,
      formData,
      documents,
    };
  }

  private setCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key',
    );
  }

  private async handleListProposals(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    const page = Math.max(1, Number(requestUrl.searchParams.get('page') ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(requestUrl.searchParams.get('pageSize') ?? 10)),
    );
    const ownerBrokerUserId =
      requestUrl.searchParams.get('ownerBrokerUserId')?.trim() ?? undefined;
    const search = requestUrl.searchParams.get('search')?.trim() ?? undefined;
    const clientName = requestUrl.searchParams.get('clientName')?.trim() ?? undefined;
    const brokerName = requestUrl.searchParams.get('brokerName')?.trim() ?? undefined;
    const proposalCode = requestUrl.searchParams.get('proposalCode')?.trim() ?? undefined;

    try {
      const result = await this.proposalStore.listByBroker({
        brokerUserId,
        ownerBrokerUserId,
        search,
        clientName,
        brokerName,
        proposalCode,
        page,
        pageSize,
      });

      this.sendJson(response, 200, {
        items: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao listar propostas', { error: message, brokerUserId });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleGetProposalSharePreview(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    const token = getRequiredPathSegment(requestUrl.pathname, 2, 'shareToken');

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    try {
      const preview = await this.proposalStore.getShareLinkPreview({
        brokerUserId,
        token,
      });

      if (!preview) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Link de compartilhamento inválido ou expirado',
        });
        return;
      }

      this.sendJson(response, 200, preview as unknown as JsonObject);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao consultar preview do link de compartilhamento', {
        error: message,
        brokerUserId,
        token,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleAcceptProposalShareLink(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const token = getRequiredPathSegment(requestUrl.pathname, 2, 'shareToken');

    try {
      const result = await this.proposalStore.acceptShareLink({
        brokerUserId,
        token,
      });

      this.sendJson(response, 200, {
        ok: true,
        proposalId: result.proposalId,
        proposalCode: result.proposalCode,
        ownerBrokerUserId: result.ownerBrokerUserId,
        ownerName: result.ownerName,
        alreadyAttached: result.alreadyAttached,
      });

      if (!result.alreadyAttached) {
        void this.notificationService.notifyProposalOwnerAboutNewCollaborator({
          ownerUserId: result.ownerBrokerUserId,
          proposalId: result.proposalId,
          proposalCode: result.proposalCode,
          guestName: result.guestName,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao aceitar link de compartilhamento da proposta', {
        error: message,
        brokerUserId,
        token,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleGetProposal(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();

    if (!brokerUserId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: brokerUserId',
      });
      return;
    }

    const proposalId = requestUrl.pathname.replace('/api/proposals/', '').trim();
    if (!proposalId) {
      this.sendJson(response, 400, {
        ok: false,
        error: 'Campo obrigatório ausente: proposalId',
      });
      return;
    }

    try {
      this.logger.info('Iniciando busca de proposta por id', {
        brokerUserId,
        proposalId,
      });

      const proposal = await withTimeout(
        this.proposalStore.getById({
          brokerUserId,
          proposalId,
        }),
        15000,
        'Tempo limite excedido ao buscar proposta',
      );

      if (!proposal) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Proposta não encontrada',
        });
        return;
      }

      this.logger.info('Busca de proposta finalizada com sucesso', {
        brokerUserId,
        proposalId,
      });
      this.sendJson(response, 200, proposal as unknown as JsonObject);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao buscar proposta', {
        error: message,
        brokerUserId,
        proposalId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleCreateProposalShareLink(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');

    try {
      const shareLink = await this.proposalStore.createShareLink({
        brokerUserId,
        proposalId,
      });

      this.sendJson(response, 200, {
        ok: true,
        token: shareLink.token,
        createdAt: shareLink.createdAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao criar link de compartilhamento da proposta', {
        error: message,
        brokerUserId,
        proposalId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleCreateProposalInvitation(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const inviteeUserId = readRequiredString(payload, 'inviteeUserId', 'convidadoUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');

    try {
      const invitation = await this.proposalStore.createInvitation({
        brokerUserId,
        proposalId,
        inviteeUserId,
      });

      this.sendJson(response, 201, { ok: true, item: invitation });

      void this.notificationService.notifyUserAboutProposalInvitation({
        userId: invitation.inviteeUserId,
        proposalId: invitation.proposalId,
        proposalCode: invitation.proposalCode,
        inviterName: invitation.inviterName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao criar convite de proposta', {
        error: message,
        brokerUserId,
        inviteeUserId,
        proposalId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleUpdateProposal(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    let brokerUserId: string | undefined;
    let proposalId: string | undefined;

    try {
      const payload = await this.readJsonBody(request);
      brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
      proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
      const status = readOptionalProposalStatus(payload);
      const commentScope = readOptionalProposalCommentScope(payload);

      const result = await this.proposalStore.update({
        proposalId,
        brokerUserId,
        brokerPhone:
          readOptionalString(payload, 'brokerPhone', 'corretorWpp') ??
          readOptionalString(payload, 'whatsappCorretor', 'wppCorretor'),
        clientName: readOptionalString(payload, 'clientName', 'cliente'),
        clientCpf: readOptionalString(payload, 'clientCpf', 'cpfCliente'),
        clientEmail: readOptionalString(payload, 'clientEmail', 'emailCliente'),
        clientPhone: readOptionalString(payload, 'clientPhone', 'telefoneCliente'),
        propertyType: readOptionalString(payload, 'propertyType', 'tipoImovel'),
        propertyCity: readOptionalString(payload, 'propertyCity', 'municipioImovel'),
        propertyState: readOptionalString(payload, 'propertyState', 'ufImovel'),
        additionalInfo: readOptionalString(payload, 'additionalInfo', 'informacoesAdicionais'),
        pendingReason: readOptionalString(payload, 'pendingReason', 'motivoPendencia'),
        commentMessage: readOptionalString(payload, 'commentMessage', 'comentario'),
        commentScope,
        formData: readOptionalObject(payload, 'formData', 'data'),
        status,
      });

      const effects = result?.effects;

      this.sendJson(response, 200, {
        ok: true,
        proposalId,
        ...(result
          ? {
              status: result.status,
              statusLabel: result.statusLabel,
            }
          : {}),
      });

      if (effects) {
        void this.runProposalUpdateEffects(effects, result?.statusLabel);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao atualizar proposta', {
        error: message,
        proposalId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleSendIncomeValidationTestEmail(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    let brokerUserId: string | undefined;
    let proposalId: string | undefined;

    try {
      const payload = await this.readJsonBody(request);
      brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
      proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
      const to = readRequiredEmailRecipients(payload.to ?? payload.destinatario);
      const subject = readRequiredString(payload, 'subject', 'assunto');
      const text = readRequiredString(payload, 'text', 'mensagem');
      const html = readOptionalString(payload, 'html', 'corpoHtml');
      const attachments = readEmailAttachments(payload.attachments);

      const profile = await this.profileStore.getById(brokerUserId);

      if (!profile) {
        this.sendJson(response, 404, { ok: false, error: 'Usuário não encontrado' });
        return;
      }

      if (!profile.isAdmin) {
        this.sendJson(response, 403, {
          ok: false,
          error: 'Apenas administradores podem enviar este e-mail.',
        });
        return;
      }

      const proposal = await this.proposalStore.getById({
        brokerUserId,
        proposalId,
      });

      if (!proposal) {
        this.sendJson(response, 404, { ok: false, error: 'Proposta não encontrada' });
        return;
      }

      const resolvedAttachments = [];

      for (const attachment of attachments) {
        if (attachment.type === 'proposal_document') {
          const document = await this.proposalStore.getDocument({
            brokerUserId,
            proposalId,
            documentId: attachment.documentId,
          });

          if (!document) {
            throw new Error(`Documento da proposta não encontrado: ${attachment.documentId}`);
          }

          const content = await this.storageService.download(document.storageLocation);
          resolvedAttachments.push({
            filename: attachment.filename?.trim() || document.originalFilename,
            content,
            contentType: document.contentType,
          });
          continue;
        }

        resolvedAttachments.push({
          filename: attachment.filename,
          content: Buffer.from(attachment.base64Content, 'base64'),
          contentType: attachment.contentType,
        });
      }

      this.logger.info('Iniciando envio de e-mail da validação de renda', {
        proposalId,
        brokerUserId,
        recipients: to,
        subject,
        attachmentsCount: resolvedAttachments.length,
      });

      const messageIds = await this.gmailSmtpEmailService.send({
        to,
        subject,
        text,
        html,
        attachments: resolvedAttachments,
      });
      await this.proposalEmailReplySyncService.trackSent({ proposalId, brokerUserId, recipients: to, subject, messageIds });

      await this.proposalStore.appendAuditComment({
        proposalId,
        actorUserId: brokerUserId,
        actorRole: profile.role,
        actorName: profile.fullName,
        message: `E-mail da validação de renda enviado para ${to.map((recipient) => `"${recipient}"`).join(', ')} com assunto "${subject}".`,
        scope: 'income_validation',
      });

      this.logger.info('E-mail da validação de renda enviado com sucesso', {
        proposalId,
        brokerUserId,
        recipients: to,
        subject,
      });

      this.sendJson(response, 200, { ok: true, sentTo: to });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao enviar e-mail teste da validação de renda', {
        error: message,
        proposalId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleSendProposalEmail(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    let brokerUserId: string | undefined;
    let proposalId: string | undefined;

    try {
      const payload = await this.readJsonBody(request);
      brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
      proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
      const to = readRequiredEmailRecipients(payload.to ?? payload.destinatario);
      const subject = readRequiredString(payload, 'subject', 'assunto');
      const text = readRequiredString(payload, 'text', 'mensagem');
      const attachments = readEmailAttachments(payload.attachments);

      const profile = await this.profileStore.getById(brokerUserId);

      if (!profile) {
        this.sendJson(response, 404, { ok: false, error: 'Usuário não encontrado' });
        return;
      }

      if (!profile.isAdmin) {
        this.sendJson(response, 403, {
          ok: false,
          error: 'Apenas administradores podem enviar este e-mail.',
        });
        return;
      }

      const proposal = await this.proposalStore.getById({
        brokerUserId,
        proposalId,
      });

      if (!proposal) {
        this.sendJson(response, 404, { ok: false, error: 'Proposta não encontrada' });
        return;
      }

      const resolvedAttachments = [];
      const attachmentRefs: { id: string; filename: string }[] = [];

      for (const attachment of attachments) {
        if (attachment.type === 'proposal_document') {
          const document = await this.proposalStore.getDocument({
            brokerUserId,
            proposalId,
            documentId: attachment.documentId,
          });

          if (!document) {
            throw new Error(`Documento não encontrado: ${attachment.documentId}`);
          }

          const content = await this.storageService.download(document.storageLocation);
          const filename = attachment.filename?.trim() || document.originalFilename;
          resolvedAttachments.push({
            filename,
            content,
            contentType: document.contentType,
          });
          attachmentRefs.push({ id: attachment.documentId, filename });
          continue;
        }

        resolvedAttachments.push({
          filename: attachment.filename,
          content: Buffer.from(attachment.base64Content, 'base64'),
          contentType: attachment.contentType,
        });
      }

      this.logger.info('Iniciando envio de e-mail da proposta', {
        proposalId,
        brokerUserId,
        recipients: to,
        subject,
        attachmentsCount: resolvedAttachments.length,
      });

      const messageIds = await this.gmailSmtpEmailService.send({
        to,
        subject,
        text,
        attachments: resolvedAttachments,
      });
      await this.proposalEmailReplySyncService.trackSent({ proposalId, brokerUserId, recipients: to, subject, messageIds });

      const attachmentsSuffix =
        attachmentRefs.length > 0
          ? ` Anexos: ${attachmentRefs.map((ref) => `"${ref.filename}"`).join(', ')}.`
          : '';

      await this.proposalStore.appendAuditComment({
        proposalId,
        actorUserId: brokerUserId,
        actorRole: profile.role,
        actorName: profile.fullName,
        message: `E-mail "${subject}" enviado para ${to.map((recipient) => `"${recipient}"`).join(', ')}.${attachmentsSuffix}`,
        scope: 'email',
        attachments: attachmentRefs,
      });

      this.logger.info('E-mail da proposta enviado com sucesso', {
        proposalId,
        brokerUserId,
        recipients: to,
        subject,
      });

      this.sendJson(response, 200, { ok: true, sentTo: to });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao enviar e-mail da proposta', {
        error: message,
        proposalId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async runProposalUpdateEffects(
    effects: ProposalUpdateEffects,
    statusLabel?: string,
  ): Promise<void> {
    try {
      if (effects.statusChangedTo && effects.actorRole === 'admin') {
        await this.notificationService.notifyBrokerAboutStatusChanged({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          brokerUserId: effects.brokerUserId,
          nextStatus: effects.statusChangedTo,
        });

        if (effects.brokerPhone) {
          try {
            this.logger.info('Iniciando envio de aviso de status da proposta ao corretor pelo WhatsApp', {
              proposalId: effects.proposalId,
              proposalCode: effects.proposalCode,
              brokerUserId: effects.brokerUserId,
              brokerPhone: effects.brokerPhone,
              nextStatus: effects.statusChangedTo,
            });

            const proposalCommentsUrl = this.buildProposalCommentsUrl(effects.proposalId);
            await this.whatsAppService.sendTextToPhone(
              effects.brokerPhone,
              effects.statusChangedTo === 'pendente'
                ? this.buildPendingStatusWhatsAppMessage({
                    adminName: effects.actorName,
                    proposalCode: effects.proposalCode,
                    pendingReason: effects.pendingReason,
                    comment: effects.adminComment,
                    proposalCommentsUrl,
                  })
                : this.buildStatusChangedWhatsAppMessage({
                    proposalCode: effects.proposalCode,
                    statusLabel: statusLabel ?? effects.statusChangedTo,
                  }),
            );

            this.logger.info('Aviso de status da proposta enviado ao corretor pelo WhatsApp', {
              proposalId: effects.proposalId,
              proposalCode: effects.proposalCode,
              brokerUserId: effects.brokerUserId,
              brokerPhone: effects.brokerPhone,
              nextStatus: effects.statusChangedTo,
            });
          } catch (error) {
            this.logger.warn('Aviso de status da proposta não enviado ao corretor pelo WhatsApp', {
              proposalId: effects.proposalId,
              proposalCode: effects.proposalCode,
              brokerUserId: effects.brokerUserId,
              brokerPhone: effects.brokerPhone,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const shouldSendAdminCommentWhatsApp =
        effects.commentAdded &&
        effects.actorRole === 'admin' &&
        Boolean(effects.adminComment.trim()) &&
        effects.statusChangedTo !== 'pendente';

      if (shouldSendAdminCommentWhatsApp && effects.brokerPhone) {
        try {
          await this.whatsAppService.sendTextToPhone(
            effects.brokerPhone,
            this.buildAdminCommentWhatsAppMessage({
              adminName: effects.actorName,
              proposalCode: effects.proposalCode,
              comment: effects.adminComment,
              proposalCommentsUrl: this.buildProposalCommentsUrl(effects.proposalId),
            }),
          );
        } catch (error) {
          this.logger.warn('Comentário do admin não enviado ao corretor pelo WhatsApp', {
            proposalId: effects.proposalId,
            proposalCode: effects.proposalCode,
            brokerUserId: effects.brokerUserId,
            brokerPhone: effects.brokerPhone,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (effects.commentAdded) {
        await this.notificationService.notifyAdminsAboutComment({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          authorName: effects.actorName,
          excludeUserId: effects.actorUserId,
        });
      }

      if (effects.resubmittedForAnalysis) {
        await this.notificationService.notifyAdminsAboutResubmission({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          brokerName: effects.brokerName,
          excludeUserId: effects.actorUserId,
        });
      }
    } catch (error) {
      this.logger.error('Falha ao executar efeitos pós-atualização da proposta', {
        proposalId: effects.proposalId,
        proposalCode: effects.proposalCode,
        brokerUserId: effects.brokerUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildStatusChangedWhatsAppMessage(input: {
    proposalCode: string;
    statusLabel: string;
  }): string {
    return [
      'Sua proposta teve o status atualizado.',
      `Proposta: ${input.proposalCode}`,
      `Novo status: ${input.statusLabel}`,
    ].join('\n');
  }

  private buildPendingStatusWhatsAppMessage(input: {
    adminName: string;
    proposalCode: string;
    pendingReason: string;
    comment: string;
    proposalCommentsUrl?: string;
  }): string {
    return [
      'Sua proposta mudou de status para Pendente.',
      `Proposta: ${input.proposalCode}`,
      `Administrador responsável: ${input.adminName}`,
      input.pendingReason ? `Motivo da pendência: ${input.pendingReason}` : undefined,
      input.comment ? `Comentário: "${input.comment}"` : undefined,
      input.proposalCommentsUrl
        ? `Responder comentário: ${input.proposalCommentsUrl}`
        : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  }

  private buildAdminCommentWhatsAppMessage(input: {
    adminName: string;
    proposalCode: string;
    comment: string;
    proposalCommentsUrl?: string;
  }): string {
    return [
      `${input.adminName} fez um comentário na proposta ${input.proposalCode}.`,
      `"${input.comment}"`,
      input.proposalCommentsUrl
        ? `Responder comentário: ${input.proposalCommentsUrl}`
        : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  }

  private buildProposalCommentsUrl(proposalId: string): string | undefined {
    const baseUrl = this.config.effectusAppBaseUrl?.trim();

    if (!baseUrl) {
      return undefined;
    }

    try {
      const url = new URL(`/propostas/${proposalId}`, ensureTrailingSlash(baseUrl));
      url.searchParams.set('tab', 'comentarios');
      return url.toString();
    } catch {
      return undefined;
    }
  }

  private async handleAddProposalDocuments(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documents = readDocuments(payload.documents);
    const rawDocumentScope = readOptionalString(payload, 'documentScope', 'documentScope');
    const documentScope =
      rawDocumentScope === 'income_validation'
        ? 'income_validation'
        : rawDocumentScope === 'seller'
          ? 'seller'
          : rawDocumentScope === 'property'
            ? 'property'
            : rawDocumentScope === 'email'
              ? 'email'
              : 'proposal';

    try {
      const proposal = await this.proposalStore.getProposalContext({
        brokerUserId,
        proposalId,
      });

      if (!proposal) {
        this.sendJson(response, 404, { ok: false, error: 'Proposta não encontrada' });
        return;
      }

      const createdAt = new Date();
      const uploadedDocuments = [];
      const locations: string[] = [];

      for (const [index, document] of documents.entries()) {
        const extension = getFileExtension(document.filename);
        if (!isValidExtension(extension)) {
          throw new Error(`Extensão inválida no documento: ${document.filename}`);
        }

        const buffer = Buffer.from(document.contentBase64, 'base64');
        if (!buffer.length || buffer.toString('base64') !== normalizeBase64(document.contentBase64)) {
          throw new Error(`Base64 inválido no documento: ${document.filename}`);
        }

        const filename = generateDocumentFileName({
          createdAt,
          sender: 'endpoint',
          originalName: document.filename,
          messageId: `${proposalId}-${index + 1}`,
          clientName: proposal.clientName,
          brokerName: proposal.brokerName,
        });
        const location = await this.storageService.upload(buffer, filename, {
          brokerName: proposal.brokerName,
          clientName: proposal.clientName,
        });

        locations.push(location);
        uploadedDocuments.push({
          filename,
          originalFilename: document.filename,
          storageLocation: location,
          contentType: getContentTypeByFilename(filename),
          sizeBytes: buffer.length,
          uploadedAt: createdAt.toISOString(),
          uploadedByUserId: brokerUserId,
        });
      }

      await this.proposalStore.addDocuments({
        brokerUserId,
        proposalId,
        documents: uploadedDocuments,
        documentScope,
      });

      this.sendJson(response, 201, {
        ok: true,
        uploadedFiles: uploadedDocuments.length,
        locations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao adicionar documentos na proposta', {
        error: message,
        proposalId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleRenameProposalDocument(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documentId = getRequiredPathSegment(requestUrl.pathname, 4, 'documentId');
    const displayName = readRequiredString(payload, 'displayName', 'filename');

    try {
      await this.proposalStore.renameDocument({
        brokerUserId,
        proposalId,
        documentId,
        displayName,
      });

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao renomear documento da proposta', {
        error: message,
        proposalId,
        documentId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleDeleteProposalDocument(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documentId = getRequiredPathSegment(requestUrl.pathname, 4, 'documentId');

    try {
      const document = await this.proposalStore.deleteDocument({
        brokerUserId,
        proposalId,
        documentId,
      });

      if (!document) {
        this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
        return;
      }

      await this.storageService.delete(document.storageLocation);

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao excluir documento da proposta', {
        error: message,
        proposalId,
        documentId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleDeleteProposal(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');

    try {
      const result = await this.proposalStore.delete({
        brokerUserId,
        proposalId,
      });

      if (!result) {
        this.sendJson(response, 404, { ok: false, error: 'Proposta não encontrada' });
        return;
      }

      await Promise.all(
        result.documentLocations.map((location) =>
          this.storageService.delete(location).catch(() => undefined),
        ),
      );

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao excluir proposta', {
        error: message,
        proposalId,
        brokerUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleRemoveProposalGuest(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const guestUserId = getRequiredPathSegment(requestUrl.pathname, 4, 'guestUserId');

    try {
      const removed = await this.proposalStore.removeGuest({
        brokerUserId,
        proposalId,
        guestUserId,
      });

      if (!removed) {
        this.sendJson(response, 404, { ok: false, error: 'Convidado não encontrado' });
        return;
      }

      this.sendJson(response, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao remover convidado da proposta', {
        error: message,
        brokerUserId,
        proposalId,
        guestUserId,
      });
      this.sendJson(response, this.statusFromError(message), { ok: false, error: message });
    }
  }

  private async handleViewProposalDocument(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documentId = getRequiredPathSegment(requestUrl.pathname, 4, 'documentId');

    try {
      const document = await this.proposalStore.getDocument({
        brokerUserId,
        proposalId,
        documentId,
      });

      if (!document) {
        this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
        return;
      }

      const url = await this.storageService.createSignedUrl(document.storageLocation, 3600);
      this.sendJson(response, 200, {
        ok: true,
        url,
        filename: document.originalFilename,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao gerar visualização do documento', {
        error: message,
        proposalId,
        documentId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleDownloadProposalDocument(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documentId = getRequiredPathSegment(requestUrl.pathname, 4, 'documentId');

    try {
      const document = await this.proposalStore.getDocument({
        brokerUserId,
        proposalId,
        documentId,
      });

      if (!document) {
        this.sendJson(response, 404, { ok: false, error: 'Documento não encontrado' });
        return;
      }

      const buffer = await this.storageService.download(document.storageLocation);
      const filename = sanitizeFileName(
        document.originalFilename || document.filename,
      );

      response.writeHead(200, {
        'Content-Type': document.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      response.end(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao baixar documento da proposta', {
        error: message,
        proposalId,
        documentId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private async handleDownloadProposal(
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const brokerUserId = requestUrl.searchParams.get('brokerUserId')?.trim();
    if (!brokerUserId) {
      this.sendJson(response, 400, { ok: false, error: 'Campo obrigatório ausente: brokerUserId' });
      return;
    }

    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');

    try {
      const proposal = await this.proposalStore.getById({
        brokerUserId,
        proposalId,
      });

      if (!proposal) {
        this.sendJson(response, 404, { ok: false, error: 'Proposta não encontrada' });
        return;
      }

      const tempRoot = await fs.mkdtemp(path.join(tmpdir(), `proposal-${proposalId}-`));
      const filesDir = path.join(tempRoot, 'files');
      const zipPath = path.join(tempRoot, `${proposal.proposalCode}.zip`);
      await fs.mkdir(filesDir, { recursive: true });

      const allDocuments = [
        ...proposal.documents,
        ...proposal.sellerDocuments,
        ...proposal.propertyDocuments,
        ...proposal.incomeValidationDocuments,
      ];

      for (const document of allDocuments) {
        const buffer = await this.storageService.download(document.storageLocation);
        const outputPath = path.join(filesDir, sanitizeFileName(document.displayName));
        await fs.writeFile(outputPath, buffer);
      }

      await runZip(filesDir, zipPath);
      const zipBuffer = await fs.readFile(zipPath);

      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${proposal.proposalCode}.zip"`,
      });
      response.end(zipBuffer);

      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Falha ao gerar ZIP da proposta', {
        error: message,
        proposalId,
      });
      this.sendJson(response, 500, { ok: false, error: message });
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    if (!this.config.apiKey) {
      this.logger.error('FORM_SUBMISSION_API_KEY não configurada');
      return false;
    }

    const authorization = request.headers.authorization;
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const apiKeyHeader = request.headers['x-api-key'];
    const receivedApiKey = Array.isArray(apiKeyHeader)
      ? apiKeyHeader[0]
      : apiKeyHeader;
    const token = bearerToken ?? receivedApiKey;

    if (!token) {
      return false;
    }

    return safeCompare(token, this.config.apiKey);
  }

  private sendJson(
    response: ServerResponse,
    statusCode: number,
    payload: unknown,
  ): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
  }

  private statusFromError(message: string): number {
    if (
      message.includes('Apenas admin') ||
      message.includes('Sem permissão') ||
      message.includes('Perfil inativo')
    ) {
      return 403;
    }

    if (
      message.includes('não encontrada') ||
      message.includes('não encontrado') ||
      message.includes('expirado')
    ) {
      return 404;
    }

    if (
      message.includes('inválido') ||
      message.includes('obrigatório') ||
      message.includes('precisa') ||
      message.includes('limite')
    ) {
      return 400;
    }

    return 500;
  }
}

function readRequiredString(
  payload: JsonObject,
  primaryKey: string,
  fallbackKey: string,
): string {
  const value = payload[primaryKey] ?? payload[fallbackKey];

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo obrigatório ausente: ${primaryKey}`);
  }

  return value.trim();
}

function readRequiredSearchParam(requestUrl: URL, key: string): string {
  const value = requestUrl.searchParams.get(key)?.trim();

  if (!value) {
    throw new Error(`Campo obrigatório ausente: ${key}`);
  }

  return value;
}

function readOptionalString(
  payload: JsonObject,
  primaryKey: string,
  fallbackKey: string,
): string | undefined {
  const value = payload[primaryKey] ?? payload[fallbackKey];

  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  return value.trim();
}

function readEmailAttachments(value: JsonValue | undefined): EmailAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: EmailAttachmentInput[] = [];

  value.forEach((item) => {
    if (!isJsonObject(item) || typeof item.type !== 'string') {
      return;
    }

    if (item.type === 'proposal_document' && typeof item.documentId === 'string') {
      attachments.push({
        type: 'proposal_document',
        documentId: item.documentId.trim(),
        filename: typeof item.filename === 'string' ? item.filename.trim() : undefined,
      });
      return;
    }

    if (
      item.type === 'uploaded_file' &&
      typeof item.filename === 'string' &&
      typeof item.base64Content === 'string'
    ) {
      attachments.push({
        type: 'uploaded_file',
        filename: item.filename.trim(),
        contentType:
          typeof item.contentType === 'string' ? item.contentType.trim() : undefined,
        base64Content: item.base64Content.trim(),
      });
    }
  });

  return attachments;
}

function readRequiredEmailRecipients(value: JsonValue | undefined): string[] {
  const recipients = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof value === 'string' && value.trim()
    ? [value.trim()]
    : [];

  if (recipients.length === 0) {
    throw new Error('Informe ao menos um destinatário válido.');
  }

  recipients.forEach((recipient) => {
    if (!isValidEmail(recipient)) {
      throw new Error(`Destinatário inválido: ${recipient}`);
    }
  });

  return recipients;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readOptionalObject(
  payload: JsonObject,
  primaryKey: string,
  fallbackKey: string,
): Record<string, unknown> | undefined {
  const value = payload[primaryKey] ?? payload[fallbackKey];

  if (!isJsonObject(value)) {
    return undefined;
  }

  return value;
}

function readAssistantHistory(value: JsonValue | undefined): AssistantChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isJsonObject(item)) {
      return [];
    }

    const role = item.role;
    const content = item.content;

    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      !content.trim()
    ) {
      return [];
    }

    return [
      {
        role,
        content: content.trim(),
      },
    ];
  });
}

function readAssistantProposalContext(value: JsonValue | undefined) {
  if (!isJsonObject(value)) {
    return null;
  }

  const proposalId = typeof value.proposalId === 'string' ? value.proposalId.trim() : '';
  const proposalCode = typeof value.proposalCode === 'string' ? value.proposalCode.trim() : '';

  if (!proposalId || !proposalCode) {
    return null;
  }

  const tasks = Array.isArray(value.tasks)
    ? value.tasks.flatMap((task) => {
        if (!isJsonObject(task) || typeof task.title !== 'string' || !task.title.trim()) {
          return [];
        }

        return [
          {
            title: task.title.trim(),
            detail: typeof task.detail === 'string' ? task.detail.trim() : '',
            status: typeof task.status === 'string' ? task.status.trim() : 'pendente',
          },
        ];
      })
    : [];

  const latestComment = isJsonObject(value.latestComment)
    ? {
        authorName:
          typeof value.latestComment.authorName === 'string'
            ? value.latestComment.authorName.trim()
            : '',
        authorRole:
          typeof value.latestComment.authorRole === 'string'
            ? value.latestComment.authorRole.trim()
            : '',
        message:
          typeof value.latestComment.message === 'string'
            ? value.latestComment.message.trim()
            : '',
        createdAt:
          typeof value.latestComment.createdAt === 'string'
            ? value.latestComment.createdAt.trim()
            : '',
        type:
          typeof value.latestComment.type === 'string'
            ? value.latestComment.type.trim()
            : '',
      }
    : null;

  return {
    proposalId,
    proposalCode,
    status: typeof value.status === 'string' ? value.status.trim() : '',
    statusLabel: typeof value.statusLabel === 'string' ? value.statusLabel.trim() : '',
    brokerName: typeof value.brokerName === 'string' ? value.brokerName.trim() : '',
    clientName: typeof value.clientName === 'string' ? value.clientName.trim() : '',
    propertyCity: typeof value.propertyCity === 'string' ? value.propertyCity.trim() : '',
    pendingReason:
      typeof value.pendingReason === 'string' ? value.pendingReason.trim() : '',
    nextStepLabel:
      typeof value.nextStepLabel === 'string' ? value.nextStepLabel.trim() : '',
    tasks,
    latestComment,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function readOptionalProposalStatus(payload: JsonObject): ProposalStatus | undefined {
  const value = payload.status ?? payload.situacao;

  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const rawStatus = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compactStatus = rawStatus.replace(/\s+/g, '');

  if (
    rawStatus === 'em analise' ||
    rawStatus === 'em_analise' ||
    compactStatus === 'emanalise'
  ) {
    return 'em_analise';
  }

  if (rawStatus === 'pendente') {
    return 'pendente';
  }

  if (rawStatus === 'condicionado') {
    return 'condicionado';
  }

  if (rawStatus === 'reprovado') {
    return 'reprovado';
  }

  if (rawStatus === 'aprovado') {
    return 'aprovado';
  }

  if (
    rawStatus === 'validacao_renda' ||
    rawStatus === 'validacao de renda' ||
    rawStatus === 'validação de renda' ||
    compactStatus === 'validacaorenda'
  ) {
    return 'validacao_renda';
  }

  if (
    rawStatus === 'renda_validada' ||
    rawStatus === 'renda validada' ||
    compactStatus === 'rendavalidada'
  ) {
    return 'renda_validada';
  }

  if (
    rawStatus === 'renda_nao_validada' ||
    rawStatus === 'renda nao validada' ||
    rawStatus === 'renda não validada' ||
    compactStatus === 'rendanaovalidada'
  ) {
    return 'renda_nao_validada';
  }

  if (rawStatus === 'engenharia') {
    return 'engenharia';
  }

  if (
    rawStatus === 'formularios' ||
    rawStatus === 'formulários' ||
    rawStatus === 'formulario' ||
    rawStatus === 'formulário'
  ) {
    return 'formularios';
  }

  if (rawStatus === 'aguardando reserva' || compactStatus === 'aguardandoreserva') {
    return 'aguardando_reserva';
  }

  if (rawStatus === 'conformidade') {
    return 'conformidade';
  }

  if (
    rawStatus === 'agendamento na agencia' ||
    rawStatus === 'agendamento agencia' ||
    compactStatus === 'agendamentonaagencia' ||
    compactStatus === 'agendamentoagencia'
  ) {
    return 'agendamento_agencia';
  }

  if (rawStatus === 'itbi') {
    return 'itbi';
  }

  if (
    rawStatus === 'assinatura de contrato' ||
    rawStatus === 'assinatura contrato' ||
    compactStatus === 'assinaturadecontrato' ||
    compactStatus === 'assinaturacontrato'
  ) {
    return 'assinatura_contrato';
  }

  if (rawStatus === 'registro') {
    return 'registro';
  }

  if (rawStatus === 'finalizado' || rawStatus === 'finalizada') {
    return 'finalizado';
  }

  if (rawStatus === 'in progress') {
    return 'em_analise';
  }

  if (rawStatus === 'approved' || rawStatus === 'aprovada') {
    return 'aprovado';
  }

  if (rawStatus === 'rejected' || rawStatus === 'rejeitada') {
    return 'reprovado';
  }

  throw new Error(
    'Status inválido. Use em_analise, pendente, condicionado, reprovado, aprovado, validacao_renda, renda_validada, renda_nao_validada, engenharia, formularios, aguardando_reserva, conformidade, agendamento_agencia, itbi, assinatura_contrato, registro ou finalizado',
  );
}

function readOptionalProposalCommentScope(
  payload: JsonObject,
): 'proposal' | 'income_validation' | 'seller' | 'property' | undefined {
  const value = payload.commentScope ?? payload.escopoComentario;

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (
    value === 'proposal' ||
    value === 'income_validation' ||
    value === 'seller' ||
    value === 'property'
  ) {
    return value;
  }

  throw new Error(
    'Escopo de comentário inválido. Use proposal, income_validation, seller ou property',
  );
}

function readDocuments(value: JsonValue | undefined): FormSubmissionDocument[] {
  if (!Array.isArray(value)) {
    throw new Error('Campo obrigatório ausente: documents');
  }

  return value.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`Documento inválido na posição ${index}`);
    }

    const filename = item.filename ?? item.name;
    const contentBase64 = item.contentBase64 ?? item.base64;

    if (typeof filename !== 'string' || !filename.trim()) {
      throw new Error(`Nome do documento ausente na posição ${index}`);
    }

    if (typeof contentBase64 !== 'string' || !contentBase64.trim()) {
      throw new Error(`Base64 do documento ausente na posição ${index}`);
    }

    return {
      filename: filename.trim(),
      contentBase64,
    };
  });
}

function readRequiredNumber(
  payload: JsonObject,
  primaryKey: string,
  fallbackKey: string,
): number {
  const rawValue = payload[primaryKey] ?? payload[fallbackKey];
  const value =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
      ? Number(rawValue.replace(/\./g, '').replace(',', '.'))
      : NaN;

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Campo obrigatório ausente: ${primaryKey}`);
  }

  return value;
}

const ENGINEERING_PROPERTY_KINDS: EngineeringPropertyKind[] = ['Novo', 'Usado', 'Terreno'];
const ENGINEERING_REQUEST_STATUS_VALUES: EngineeringRequestStatus[] =
  ENGINEERING_REQUEST_STATUS_OPTIONS.map((option) => option.value);

function readRequiredPropertyKind(payload: JsonObject): EngineeringPropertyKind {
  const value = readRequiredString(payload, 'propertyKind', 'tipoImovel');

  if (!ENGINEERING_PROPERTY_KINDS.includes(value as EngineeringPropertyKind)) {
    throw new Error(
      `Tipo de imóvel inválido: ${value}. Use um dos seguintes: ${ENGINEERING_PROPERTY_KINDS.join(', ')}`,
    );
  }

  return value as EngineeringPropertyKind;
}

function readOptionalPropertyKind(
  payload: JsonObject,
): EngineeringPropertyKind | undefined {
  const value = readOptionalString(payload, 'propertyKind', 'tipoImovel');

  if (value === undefined) {
    return undefined;
  }

  if (!ENGINEERING_PROPERTY_KINDS.includes(value as EngineeringPropertyKind)) {
    throw new Error(
      `Tipo de imóvel inválido: ${value}. Use um dos seguintes: ${ENGINEERING_PROPERTY_KINDS.join(', ')}`,
    );
  }

  return value as EngineeringPropertyKind;
}

function readOptionalEngineeringStatus(
  payload: JsonObject,
): EngineeringRequestStatus | undefined {
  const value = readOptionalString(payload, 'status', 'situacao');

  if (value === undefined) {
    return undefined;
  }

  if (!ENGINEERING_REQUEST_STATUS_VALUES.includes(value as EngineeringRequestStatus)) {
    throw new Error(
      `Status inválido: ${value}. Use um dos seguintes: ${ENGINEERING_REQUEST_STATUS_VALUES.join(', ')}`,
    );
  }

  return value as EngineeringRequestStatus;
}

function readOptionalNumber(
  payload: JsonObject,
  primaryKey: string,
  fallbackKey: string,
): number | undefined {
  const rawValue = payload[primaryKey] ?? payload[fallbackKey];

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }

  const value =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
      ? Number(rawValue.replace(/\./g, '').replace(',', '.'))
      : NaN;

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Campo inválido: ${primaryKey}`);
  }

  return value;
}

function readEngineeringDocuments(
  value: JsonValue | undefined,
): EngineeringRequestDocument[] {
  if (!Array.isArray(value)) {
    throw new Error('Campo obrigatório ausente: documents');
  }

  return value.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`Documento inválido na posição ${index}`);
    }

    const documentKey = item.documentKey ?? item.chaveDocumento;
    const filename = item.filename ?? item.name;
    const contentBase64 = item.contentBase64 ?? item.base64;

    if (typeof documentKey !== 'string' || !documentKey.trim()) {
      throw new Error(`Chave do documento ausente na posição ${index}`);
    }

    if (typeof filename !== 'string' || !filename.trim()) {
      throw new Error(`Nome do documento ausente na posição ${index}`);
    }

    if (typeof contentBase64 !== 'string' || !contentBase64.trim()) {
      throw new Error(`Base64 do documento ausente na posição ${index}`);
    }

    return {
      documentKey: documentKey.trim(),
      filename: filename.trim(),
      contentBase64,
    };
  });
}

function readFormData(payload: JsonObject): Record<string, unknown> {
  const explicitFormData = payload.formData ?? payload.data ?? payload.fields;

  if (isJsonObject(explicitFormData)) {
    return explicitFormData;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) =>
        ![
          'brokerName',
          'corretor',
          'clientName',
          'cliente',
          'documents',
          'formData',
          'data',
          'fields',
        ].includes(key),
    ),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getRequiredPathSegment(
  pathname: string,
  index: number,
  fieldName: string,
): string {
  const parts = pathname.split('/').filter(Boolean);
  const value = parts[index];

  if (!value) {
    throw new Error(`Campo obrigatório ausente: ${fieldName}`);
  }

  return value;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'arquivo';
}

function normalizeBase64(value: string): string {
  return value.replace(/\s+/g, '');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function runZip(filesDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', zipPath, '.'], {
      cwd: filesDir,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ZIP command failed: ${stderr || code}`));
    });
  });
}
