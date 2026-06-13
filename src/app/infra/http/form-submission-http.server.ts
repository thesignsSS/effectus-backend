import http, { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import { ProfileStore } from '../../domain/interfaces/profile-store.interface.js';
import {
  PROPOSAL_STATUS_OPTIONS,
  ProposalStatus,
  ProposalStore,
} from '../../domain/interfaces/proposal-store.interface.js';
import { OneDriveService } from '../../services/onedrive.service.js';
import { ChatService } from '../../services/chat.service.js';
import { NotificationService } from '../../services/notification.service.js';
import {
  AssistantChatMessage,
  EffectusAssistantService,
} from '../../services/effectus-assistant.service.js';
import { ChatRealtimeGateway } from './chat-realtime.gateway.js';
import {
  FormSubmissionDocument,
  FormSubmissionInput,
  ProcessFormSubmissionUseCase,
} from '../../use-cases/process-form-submission.usecase.js';
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
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

export class FormSubmissionHttpServer {
  private server?: http.Server;

  constructor(
    private readonly config: FormSubmissionHttpServerConfig,
    private readonly processFormSubmission: ProcessFormSubmissionUseCase,
    private readonly profileStore: ProfileStore,
    private readonly proposalStore: ProposalStore,
    private readonly storageService: OneDriveService,
    private readonly chatService: ChatService,
    private readonly notificationService: NotificationService,
    private readonly effectusAssistantService: EffectusAssistantService,
    private readonly chatRealtimeGateway: ChatRealtimeGateway,
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

    if (request.method === 'GET' && requestUrl.pathname === '/api/notifications') {
      await this.handleListNotifications(requestUrl, response);
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
      requestUrl.pathname.match(/^\/api\/proposals\/[^/]+\/download$/)
    ) {
      await this.handleDownloadProposal(requestUrl, response);
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

    try {
      const result = await this.proposalStore.listByBroker({
        brokerUserId,
        ownerBrokerUserId,
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
      this.logger.error('Falha ao listar propostas', { error: message, brokerUserId });
      this.sendJson(response, 500, { ok: false, error: message });
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
      const proposal = await this.proposalStore.getById({
        brokerUserId,
        proposalId,
      });

      if (!proposal) {
        this.sendJson(response, 404, {
          ok: false,
          error: 'Proposta não encontrada',
        });
        return;
      }

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

  private async handleUpdateProposal(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const status = readOptionalProposalStatus(payload);

    try {
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
        formData: readOptionalObject(payload, 'formData', 'data'),
        status,
      });

      const effects = result?.effects;

      if (effects?.statusChangedTo && effects.actorRole === 'admin') {
        await this.notificationService.notifyBrokerAboutStatusChanged({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          brokerUserId: effects.brokerUserId,
          nextStatus: effects.statusChangedTo,
        });
      }

      if (effects?.commentAdded) {
        await this.notificationService.notifyAdminsAboutComment({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          authorName: effects.actorName,
          excludeUserId: effects.actorUserId,
        });
      }

      if (effects?.resubmittedForAnalysis) {
        await this.notificationService.notifyAdminsAboutResubmission({
          proposalId: effects.proposalId,
          proposalCode: effects.proposalCode,
          brokerName: effects.brokerName,
          excludeUserId: effects.actorUserId,
        });
      }

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

  private async handleAddProposalDocuments(
    request: IncomingMessage,
    requestUrl: URL,
    response: ServerResponse,
  ): Promise<void> {
    const payload = await this.readJsonBody(request);
    const brokerUserId = readRequiredString(payload, 'brokerUserId', 'corretorUserId');
    const proposalId = getRequiredPathSegment(requestUrl.pathname, 2, 'proposalId');
    const documents = readDocuments(payload.documents);

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
        });
      }

      await this.proposalStore.addDocuments({
        brokerUserId,
        proposalId,
        documents: uploadedDocuments,
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
      this.sendJson(response, 500, { ok: false, error: message });
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

      for (const document of proposal.documents) {
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
    if (message.includes('Apenas admin')) {
      return 403;
    }

    if (message.includes('não encontrada') || message.includes('não encontrado')) {
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

  if (rawStatus === 'em analise' || rawStatus === 'em_analise') {
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
    'Status inválido. Use em_analise, pendente, condicionado, reprovado ou aprovado',
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
