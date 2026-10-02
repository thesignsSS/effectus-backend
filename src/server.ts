import { WhatsAppController } from './app/controllers/whatsapp.controller.js';
import { fileURLToPath } from 'node:url';
import { NoopAutomationClient } from './app/infra/automation/noop-automation.client.js';
import { ConsoleLogger } from './app/infra/logger/logger.js';
import { FormSubmissionHttpServer } from './app/infra/http/form-submission-http.server.js';
import { ChatRealtimeGateway } from './app/infra/http/chat-realtime.gateway.js';
import { OpenRouterCustomerRegistrationClient } from './app/infra/llm/openrouter-customer-registration.client.js';
import { CompositeQrCodePresenter } from './app/infra/qrcode/composite-qr-code.presenter.js';
import { TerminalQrCodePresenter } from './app/infra/qrcode/terminal-qr-code.presenter.js';
import { WebQrCodePresenter } from './app/infra/qrcode/web-qr-code.presenter.js';
import { CompositeStorageClient } from './app/infra/storage/composite-storage.client.js';
import { LocalFolderStorageClient } from './app/infra/storage/local-folder-storage.client.js';
import { SupabaseBrokerClientStore } from './app/infra/supabase/supabase-broker-client.store.js';
import { SupabaseEngineeringRequestStore } from './app/infra/supabase/supabase-engineering-request.store.js';
import { SupabaseProfileStore } from './app/infra/supabase/supabase-profile.store.js';
import { SupabaseTeamStore } from './app/infra/supabase/supabase-team.store.js';
import { SupabaseProposalStore } from './app/infra/supabase/supabase-proposal.store.js';
import { SupabaseNotificationStore } from './app/infra/supabase/supabase-notification.store.js';
import { SupabaseChatStore } from './app/infra/supabase/supabase-chat.store.js';
import { SupabaseStorageClient } from './app/infra/supabase/supabase-storage.client.js';
import { SupabaseWhatsAppSessionStore } from './app/infra/supabase/supabase-whatsapp-session.store.js';
import { NoopOcrProvider } from './app/infra/ocr/noop-ocr.provider.js';
import { TesseractOcrProvider } from './app/infra/ocr/tesseract-ocr.provider.js';
import { BrazilianDocumentDataExtractor } from './app/services/brazilian-document-data-extractor.service.js';
import { BaileysClient } from './app/infra/whatsapp/baileys.client.js';
import { DocumentProcessingQueueService } from './app/services/document-processing-queue.service.js';
import { EffectusAssistantService } from './app/services/effectus-assistant.service.js';
import { FileService } from './app/services/file.service.js';
import { GmailSmtpEmailService } from './app/services/gmail-smtp-email.service.js';
import { ProposalEmailReplySyncService } from './app/services/proposal-email-reply-sync.service.js';
import { ChatService } from './app/services/chat.service.js';
import { NotificationService } from './app/services/notification.service.js';
import { RemittanceSessionService } from './app/services/remittance-session.service.js';
import { OneDriveService } from './app/services/onedrive.service.js';
import { WhatsAppService } from './app/services/whatsapp.service.js';
import { GenerateCustomerRegistrationReportUseCase } from './app/use-cases/generate-customer-registration-report.usecase.js';
import { ProcessAdditionalInfoUseCase } from './app/use-cases/process-additional-info.usecase.js';
import { ExtractDocumentInfoUseCase } from './app/use-cases/extract-document-info.usecase.js';
import { ProcessIncomingDocumentUseCase } from './app/use-cases/process-incoming-document.usecase.js';
import { ProcessFormSubmissionUseCase } from './app/use-cases/process-form-submission.usecase.js';
import { ProcessEngineeringRequestUseCase } from './app/use-cases/process-engineering-request.usecase.js';
import { RegisterDocumentUseCase } from './app/use-cases/register-document.usecase.js';
import { env } from './config/env.js';
import { LeadAdsHttpHandler } from './app/infra/http/lead-ads-http.handler.js';
import { FakeMetaAdsClient } from './app/infra/meta/fake-meta-ads.client.js';
import { GraphMetaAdsClient } from './app/infra/meta/graph-meta-ads.client.js';
import { SupabaseLeadAdsStore } from './app/infra/supabase/supabase-lead-ads.store.js';
import { LeadAdsService } from './app/services/lead-ads.service.js';
import { TokenCipher } from './app/utils/token-cipher.js';
import { createClient } from '@supabase/supabase-js';
import {
  Hs256TokenVerifier,
  SupabaseRemoteTokenVerifier,
} from './app/modules/auth/jwt-verifier.js';
import { SupabaseAuthContextResolver } from './app/modules/auth/auth-context.js';
import { RequestAuthenticator } from './app/modules/auth/request-authenticator.js';
import { IdentityGuard } from './app/modules/auth/identity-guard.js';
import { PropertyService } from './app/modules/properties/application/property.service.js';
import { PropertiesRouter } from './app/modules/properties/http/properties.router.js';
import { IbgeMunicipalityDirectory } from './app/modules/properties/infra/ibge-municipality.directory.js';
import { SupabasePropertyRepository } from './app/modules/properties/infra/supabase-property.repository.js';
import { PropertyPhotoService } from './app/modules/properties/application/property-photo.service.js';
import { PropertyListService } from './app/modules/properties/application/property-list.service.js';
import {
  SupabasePhotoStorage,
  SupabasePropertyPhotoRepository,
} from './app/modules/properties/infra/supabase-property-photos.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export function buildApp(): WhatsAppController {
  const logger = new ConsoleLogger();
  const storageProvider = buildStorageProvider(logger);
  logger.info('Storage configurado', {
    provider: env.storageProvider,
    bucket: env.supabaseBucket,
    folder: env.supabaseFolder,
    localMirrorEnabled: env.localDocumentsMirrorEnabled,
  });
  const webQrCodePresenter = new WebQrCodePresenter(
    {
      port: env.qrCodeWebPort,
      host: env.qrCodeWebHost,
      frontendDir: pathFromRoot('frontend'),
      loadDocuments: hasListDocuments(storageProvider)
        ? () => storageProvider.listDocuments()
        : undefined,
    },
    logger,
  );
  webQrCodePresenter.start();
  const qrCodePresenter = new CompositeQrCodePresenter([
    new TerminalQrCodePresenter(),
    webQrCodePresenter,
  ]);
  const whatsAppSessionStore =
    env.supabaseUrl && env.supabaseServiceRoleKey
      ? new SupabaseWhatsAppSessionStore(
          {
            url: env.supabaseUrl,
            serviceRoleKey: env.supabaseServiceRoleKey,
            bucket: env.supabaseBucket,
            path: `${env.supabaseFolder.replace(/^\/+|\/+$/g, '')}/_session/baileys-auth.json`,
          },
          logger,
        )
      : undefined;

  const messagingProvider = new BaileysClient(
    {
      sessionDir: env.whatsappSessionDir,
      allowedChatName: env.whatsappAllowedChatName,
      allowedChatId: env.whatsappAllowedChatId,
      sessionStore: whatsAppSessionStore,
    },
    logger,
    qrCodePresenter,
    webQrCodePresenter,
  );

  const fileService = new FileService(env.tempDir);
  const oneDriveService = new OneDriveService(storageProvider);
  const documentDataExtractor = new BrazilianDocumentDataExtractor();
  const extractDocumentInfo =
    env.ocrProvider === 'tesseract'
      ? new ExtractDocumentInfoUseCase(
          new TesseractOcrProvider(env.ocrLanguage, logger),
          logger,
        )
      : new ExtractDocumentInfoUseCase(
          new NoopOcrProvider(),
          logger,
        );
  const whatsAppService = new WhatsAppService(messagingProvider);
  const brokerClientStore = new SupabaseBrokerClientStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const profileStore = new SupabaseProfileStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const teamStore = new SupabaseTeamStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const proposalStore = new SupabaseProposalStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const engineeringRequestStore = new SupabaseEngineeringRequestStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const notificationStore = new SupabaseNotificationStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const chatStore = new SupabaseChatStore({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  });
  const notificationService = new NotificationService(notificationStore);
  const chatService = new ChatService(chatStore, notificationService);
  const gmailSmtpEmailService = new GmailSmtpEmailService({
    user: env.gmailSmtpUser,
    appPassword: env.gmailSmtpAppPassword,
  });
  const proposalEmailReplySyncService = new ProposalEmailReplySyncService({
    user: env.gmailSmtpUser,
    appPassword: env.gmailSmtpAppPassword,
    supabaseUrl: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
  }, proposalStore, logger);
  proposalEmailReplySyncService.start();
  const serviceClient = buildServiceClient();
  const authenticator = buildAuthenticator(serviceClient, logger);
  const propertyRepository = new SupabasePropertyRepository(serviceClient);
  const propertyService = new PropertyService(propertyRepository, new IbgeMunicipalityDirectory(logger), logger);
  const propertyPhotoRepository = new SupabasePropertyPhotoRepository(serviceClient);
  const photoStorage = new SupabasePhotoStorage(serviceClient);
  const propertyPhotoService = new PropertyPhotoService(propertyRepository, propertyPhotoRepository, photoStorage, logger);
  const propertyListService = new PropertyListService(propertyRepository, propertyPhotoRepository, photoStorage);
  const chatRealtimeGateway = new ChatRealtimeGateway(authenticator, logger);
  const processFormSubmission = new ProcessFormSubmissionUseCase(
    oneDriveService,
    brokerClientStore,
    proposalStore,
    whatsAppService,
    logger,
  );
  const processEngineeringRequest = new ProcessEngineeringRequestUseCase(
    oneDriveService,
    engineeringRequestStore,
    whatsAppService,
    logger,
  );
  const effectusAssistantService = new EffectusAssistantService(
    {
      apiKey: env.openRouterApiKey,
      model: env.openRouterModel,
      baseUrl: env.openRouterBaseUrl,
      policyFilePath: pathFromWorkspaceRoot('docs/effectus-assistant-policy.md'),
    },
    logger,
  );
  new FormSubmissionHttpServer(
    {
      port: env.formSubmissionHttpPort,
      maxBodyBytes: env.formSubmissionMaxBodyMb * 1024 * 1024,
      effectusAppBaseUrl: env.effectusAppBaseUrl,
      corsAllowedOrigins: env.corsAllowedOrigins,
    },
    authenticator,
    new IdentityGuard(env.identityMode, logger),
    processFormSubmission,
    processEngineeringRequest,
    engineeringRequestStore,
    profileStore,
    teamStore,
    proposalStore,
    oneDriveService,
    chatService,
    notificationService,
    effectusAssistantService,
    chatRealtimeGateway,
    whatsAppService,
    webQrCodePresenter,
    gmailSmtpEmailService,
    proposalEmailReplySyncService,
    new LeadAdsHttpHandler(buildLeadAdsService(logger), logger),
    logger,
    [new PropertiesRouter(propertyService, propertyPhotoService, propertyListService, logger)],
  ).start();
  const remittanceSessionService = new RemittanceSessionService();
  const customerRegistrationExtractor = new OpenRouterCustomerRegistrationClient(
    {
      apiKey: env.openRouterApiKey,
      model: env.openRouterModel,
      baseUrl: env.openRouterBaseUrl,
    },
    logger,
  );
  const generateCustomerRegistrationReport =
    new GenerateCustomerRegistrationReportUseCase(
      fileService,
      oneDriveService,
      documentDataExtractor,
      logger,
      customerRegistrationExtractor,
      webQrCodePresenter,
    );
  const processIncomingDocument = new ProcessIncomingDocumentUseCase(
    fileService,
    oneDriveService,
    logger,
    remittanceSessionService,
    webQrCodePresenter,
    extractDocumentInfo,
  );
  const processAdditionalInfo = new ProcessAdditionalInfoUseCase(
    fileService,
    oneDriveService,
    logger,
    webQrCodePresenter,
  );
  const processingQueue = new DocumentProcessingQueueService(
    env.documentProcessingConcurrency,
    async (message) => {
      try {
        if (message.hasMedia) {
          await processIncomingDocument.execute(message);
          return;
        }

        await processAdditionalInfo.execute(message);
      } catch (error) {
        logger.error('Erro ao processar mensagem recebida', {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  new RegisterDocumentUseCase(new NoopAutomationClient(), logger);

  const controller = new WhatsAppController(
    whatsAppService,
    processIncomingDocument,
    processAdditionalInfo,
    logger,
    processingQueue,
    remittanceSessionService,
    generateCustomerRegistrationReport,
  );

  return controller;
}

function buildStorageProvider(logger: ConsoleLogger) {
  const supabaseStorage = new SupabaseStorageClient({
    url: env.supabaseUrl,
    serviceRoleKey: env.supabaseServiceRoleKey,
    bucket: env.supabaseBucket,
    folder: env.supabaseFolder,
  }, logger);

  if (!env.localDocumentsMirrorEnabled) {
    return supabaseStorage;
  }

  return new CompositeStorageClient(supabaseStorage, [
    new LocalFolderStorageClient({
      rootDir: env.localDocumentsRoot,
    }),
  ]);

  /*
   * Fluxo OneDrive pausado temporariamente.
   *
   * if (env.storageProvider === 'onedrive' || env.oneDriveProvider === 'graph') {
   *   return new OneDriveClient({
   *     tenantId: env.oneDriveTenantId,
   *     clientId: env.oneDriveClientId,
   *     clientSecret: env.oneDriveClientSecret,
   *     refreshToken: env.oneDriveRefreshToken,
   *     folder: env.oneDriveFolder,
   *   });
   * }
   *
   * return new MockOneDriveClient(env.oneDriveFolder);
   */
}

/** Cliente com a service role, compartilhado pela autenticação e pelos módulos novos. */
function buildServiceClient(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para autenticar a API');
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildAuthenticator(client: SupabaseClient, logger: ConsoleLogger): RequestAuthenticator {
  if (!env.supabaseJwtSecret) {
    logger.warn('SUPABASE_JWT_SECRET ausente: JWT validado no Supabase a cada sessão nova (mais lento)');
  }

  if (env.acceptLegacyApiKey) {
    logger.warn('Chave compartilhada antiga ainda aceita (ACCEPT_LEGACY_API_KEY): desligar após migrar o app');
  }

  return new RequestAuthenticator(
    { legacyApiKey: env.formSubmissionApiKey, acceptLegacyApiKey: env.acceptLegacyApiKey },
    env.supabaseJwtSecret
      ? new Hs256TokenVerifier(env.supabaseJwtSecret)
      : new SupabaseRemoteTokenVerifier(client),
    new SupabaseAuthContextResolver(client),
  );
}

// Chave fixa só para o modo fake, onde os tokens também são falsos.
const FAKE_MODE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

function buildLeadAdsService(logger: ConsoleLogger): LeadAdsService | undefined {
  if (env.metaAdsProvider !== 'fake' && env.metaAdsProvider !== 'graph') {
    return undefined;
  }

  try {
    const isGraph = env.metaAdsProvider === 'graph';

    if (isGraph) {
      const missing = [
        ['META_APP_ID', env.metaAppId],
        ['META_APP_SECRET', env.metaAppSecret],
        ['META_TOKEN_ENCRYPTION_KEY', env.metaTokenEncryptionKey],
        ['META_WEBHOOK_VERIFY_TOKEN', env.metaWebhookVerifyToken],
        ['META_PRIVACY_POLICY_URL', env.metaPrivacyPolicyUrl],
        ['EFFECTUS_APP_BASE_URL', env.effectusAppBaseUrl],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

      if (missing.length) {
        throw new Error(`variáveis ausentes: ${missing.join(', ')}`);
      }
    }

    const appSecret = env.metaAppSecret ?? 'fake-app-secret';
    const metaClient = isGraph
      ? new GraphMetaAdsClient(
          {
            appId: env.metaAppId as string,
            appSecret,
            apiVersion: env.metaApiVersion,
            redirectUri: env.metaOAuthRedirectUri,
            loginConfigId: env.metaLoginConfigId,
            specialAdCategories: env.metaSpecialAdCategories,
          },
          logger,
        )
      : new FakeMetaAdsClient(env.metaOAuthRedirectUri);

    const store = new SupabaseLeadAdsStore(
      { url: env.supabaseUrl, serviceRoleKey: env.supabaseServiceRoleKey },
      new TokenCipher(env.metaTokenEncryptionKey ?? FAKE_MODE_TOKEN_KEY),
    );

    logger.info('Captação de leads (Meta) habilitada', { provider: env.metaAdsProvider });

    return new LeadAdsService(
      {
        provider: env.metaAdsProvider,
        appSecret,
        webhookVerifyToken: env.metaWebhookVerifyToken,
        privacyPolicyUrl: env.metaPrivacyPolicyUrl,
        appReturnUrl: `${(env.effectusAppBaseUrl ?? 'http://localhost:5173').replace(/\/+$/, '')}/captacao`,
      },
      store,
      metaClient,
      logger,
    );
  } catch (error) {
    // Não derruba o servidor: ele também roda o bot de WhatsApp e o resto da API.
    logger.error('Captação de leads desativada por configuração inválida', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function pathFromRoot(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function pathFromWorkspaceRoot(relativePath: string): string {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

function hasListDocuments(
  storageProvider: ReturnType<typeof buildStorageProvider>,
): storageProvider is ReturnType<typeof buildStorageProvider> & {
  listDocuments: SupabaseStorageClient['listDocuments'];
} {
  return 'listDocuments' in storageProvider;
}
