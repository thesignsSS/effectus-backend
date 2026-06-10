import dotenv from 'dotenv';
import { homedir } from 'node:os';
import path from 'node:path';

dotenv.config();

type OneDriveProviderMode = 'mock' | 'graph';
type StorageProviderMode = 'mock' | 'onedrive' | 'supabase';
type OcrProviderMode = 'disabled' | 'tesseract';

export interface Env {
  nodeEnv: string;
  whatsappSessionDir: string;
  whatsappAllowedChatName: string;
  whatsappAllowedChatId?: string;
  qrCodeWebPort: number;
  formSubmissionHttpPort: number;
  formSubmissionMaxBodyMb: number;
  formSubmissionApiKey?: string;
  documentProcessingConcurrency: number;
  storageProvider: StorageProviderMode;
  oneDriveProvider: OneDriveProviderMode;
  oneDriveTenantId?: string;
  oneDriveClientId?: string;
  oneDriveClientSecret?: string;
  oneDriveRefreshToken?: string;
  oneDriveRedirectUri: string;
  oneDriveFolder: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseBucket: string;
  supabaseFolder: string;
  localDocumentsRoot: string;
  localDocumentsMirrorEnabled: boolean;
  ocrProvider: OcrProviderMode;
  ocrLanguage: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  openRouterBaseUrl: string;
  tempDir: string;
}

const oneDriveProvider = (process.env.ONEDRIVE_PROVIDER ?? 'mock') as OneDriveProviderMode;
const storageProvider = (process.env.STORAGE_PROVIDER ??
  (oneDriveProvider === 'graph' ? 'onedrive' : 'mock')) as StorageProviderMode;

export const env: Env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  whatsappSessionDir: process.env.WHATSAPP_SESSION_DIR ?? 'auth/whatsapp',
  whatsappAllowedChatName: process.env.WHATSAPP_ALLOWED_CHAT_NAME ?? 'docs_bot',
  whatsappAllowedChatId: process.env.WHATSAPP_ALLOWED_CHAT_ID,
  qrCodeWebPort: Number(3334),
  formSubmissionHttpPort: Number(3335),
  formSubmissionMaxBodyMb: Number(process.env.FORM_SUBMISSION_MAX_BODY_MB ?? 50),
  formSubmissionApiKey: process.env.FORM_SUBMISSION_API_KEY,
  documentProcessingConcurrency: Math.max(
    1,
    Number(process.env.DOCUMENT_PROCESSING_CONCURRENCY ?? 1),
  ),
  storageProvider,
  oneDriveProvider,
  oneDriveTenantId: process.env.ONEDRIVE_TENANT_ID,
  oneDriveClientId: process.env.ONEDRIVE_CLIENT_ID,
  oneDriveClientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
  oneDriveRefreshToken: process.env.ONEDRIVE_REFRESH_TOKEN,
  oneDriveRedirectUri:
    process.env.ONEDRIVE_REDIRECT_URI ??
    'http://localhost:3333/auth/onedrive/callback',
  oneDriveFolder: process.env.ONEDRIVE_FOLDER ?? '/docs',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseBucket: process.env.SUPABASE_BUCKET ?? 'docs-bot',
  supabaseFolder: process.env.SUPABASE_FOLDER ?? 'whatsapp',
  localDocumentsRoot:
    process.env.LOCAL_DOCUMENTS_ROOT ??
    path.join(homedir(), 'Library', 'CloudStorage', 'OneDrive-Pessoal'),
  localDocumentsMirrorEnabled:
    (process.env.LOCAL_DOCUMENTS_MIRROR_ENABLED ?? 'true').toLowerCase() !== 'false',
  ocrProvider: (process.env.OCR_PROVIDER ?? 'disabled') as OcrProviderMode,
  ocrLanguage: process.env.OCR_LANGUAGE ?? 'por',
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterModel:
    process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash',
  openRouterBaseUrl:
    process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  tempDir: process.env.TEMP_DIR ?? 'tmp/uploads',
};
