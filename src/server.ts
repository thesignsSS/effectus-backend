import { WhatsAppController } from './app/controllers/whatsapp.controller.js';
import { fileURLToPath } from 'node:url';
import { NoopAutomationClient } from './app/infra/automation/noop-automation.client.js';
import { ConsoleLogger } from './app/infra/logger/logger.js';
import { FormSubmissionHttpServer } from './app/infra/http/form-submission-http.server.js';
import { MockOneDriveClient } from './app/infra/onedrive/mock-onedrive.client.js';
import { OneDriveClient } from './app/infra/onedrive/onedrive.client.js';
import { OpenRouterCustomerRegistrationClient } from './app/infra/llm/openrouter-customer-registration.client.js';
import { CompositeQrCodePresenter } from './app/infra/qrcode/composite-qr-code.presenter.js';
import { TerminalQrCodePresenter } from './app/infra/qrcode/terminal-qr-code.presenter.js';
import { WebQrCodePresenter } from './app/infra/qrcode/web-qr-code.presenter.js';
import { CompositeStorageClient } from './app/infra/storage/composite-storage.client.js';
import { LocalFolderStorageClient } from './app/infra/storage/local-folder-storage.client.js';
import { SupabaseStorageClient } from './app/infra/supabase/supabase-storage.client.js';
import { NoopOcrProvider } from './app/infra/ocr/noop-ocr.provider.js';
import { TesseractOcrProvider } from './app/infra/ocr/tesseract-ocr.provider.js';
import { BrazilianDocumentDataExtractor } from './app/services/brazilian-document-data-extractor.service.js';
import { BaileysClient } from './app/infra/whatsapp/baileys.client.js';
import { DocumentProcessingQueueService } from './app/services/document-processing-queue.service.js';
import { FileService } from './app/services/file.service.js';
import { RemittanceSessionService } from './app/services/remittance-session.service.js';
import { OneDriveService } from './app/services/onedrive.service.js';
import { WhatsAppService } from './app/services/whatsapp.service.js';
import { GenerateCustomerRegistrationReportUseCase } from './app/use-cases/generate-customer-registration-report.usecase.js';
import { ProcessAdditionalInfoUseCase } from './app/use-cases/process-additional-info.usecase.js';
import { ExtractDocumentInfoUseCase } from './app/use-cases/extract-document-info.usecase.js';
import { ProcessIncomingDocumentUseCase } from './app/use-cases/process-incoming-document.usecase.js';
import { ProcessFormSubmissionUseCase } from './app/use-cases/process-form-submission.usecase.js';
import { RegisterDocumentUseCase } from './app/use-cases/register-document.usecase.js';
import { env } from './config/env.js';

export function buildApp(): WhatsAppController {
  const logger = new ConsoleLogger();
  const storageProvider = buildStorageProvider();
  const webQrCodePresenter = new WebQrCodePresenter(
    {
      port: env.qrCodeWebPort,
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

  const messagingProvider = new BaileysClient(
    {
      sessionDir: env.whatsappSessionDir,
      allowedChatName: env.whatsappAllowedChatName,
      allowedChatId: env.whatsappAllowedChatId,
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
  const processFormSubmission = new ProcessFormSubmissionUseCase(
    oneDriveService,
    whatsAppService,
    logger,
  );
  new FormSubmissionHttpServer(
    {
      port: env.formSubmissionHttpPort,
      maxBodyBytes: env.formSubmissionMaxBodyMb * 1024 * 1024,
      apiKey: env.formSubmissionApiKey,
    },
    processFormSubmission,
    logger,
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

function buildStorageProvider() {
  if (env.storageProvider === 'supabase') {
    const supabaseStorage = new SupabaseStorageClient({
      url: env.supabaseUrl,
      serviceRoleKey: env.supabaseServiceRoleKey,
      bucket: env.supabaseBucket,
      folder: env.supabaseFolder,
    });

    if (!env.localDocumentsMirrorEnabled) {
      return supabaseStorage;
    }

    return new CompositeStorageClient(supabaseStorage, [
      new LocalFolderStorageClient({
        rootDir: env.localDocumentsRoot,
      }),
    ]);
  }

  if (env.storageProvider === 'onedrive' || env.oneDriveProvider === 'graph') {
    return new OneDriveClient({
      tenantId: env.oneDriveTenantId,
      clientId: env.oneDriveClientId,
      clientSecret: env.oneDriveClientSecret,
      refreshToken: env.oneDriveRefreshToken,
      folder: env.oneDriveFolder,
    });
  }

  return new MockOneDriveClient(env.oneDriveFolder);
}

function pathFromRoot(relativePath: string): string {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function hasListDocuments(
  storageProvider: ReturnType<typeof buildStorageProvider>,
): storageProvider is ReturnType<typeof buildStorageProvider> & {
  listDocuments: SupabaseStorageClient['listDocuments'];
} {
  return 'listDocuments' in storageProvider;
}
