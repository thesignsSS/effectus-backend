import http, { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Logger } from '../../domain/interfaces/logger.interface.js';
import {
  FormSubmissionDocument,
  FormSubmissionInput,
  ProcessFormSubmissionUseCase,
} from '../../use-cases/process-form-submission.usecase.js';

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
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });

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

    if (request.method === 'GET' && request.url === '/api/elias') {
      this.sendJson(response, 200, { message: 'Elias Lindo' });
      return;
    }

    if (request.method !== 'POST' || request.url !== '/api/form-submissions') {
      this.sendJson(response, 404, { error: 'Endpoint não encontrado' });
      return;
    }

    if (!this.isAuthorized(request)) {
      this.sendJson(response, 401, { ok: false, error: 'Não autorizado' });
      return;
    }

    try {
      const payload = await this.readJsonBody(request);
      const input = this.toFormSubmissionInput(payload);
      const result = await this.processFormSubmission.execute(input);

      this.sendJson(response, 201, {
        ok: true,
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
    const brokerName = readRequiredString(payload, 'brokerName', 'corretor');
    const clientName = readRequiredString(payload, 'clientName', 'cliente');
    const documents = readDocuments(payload.documents);
    const formData = readFormData(payload);

    return {
      brokerName,
      clientName,
      formData,
      documents,
    };
  }

  private setCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key',
    );
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
    payload: JsonObject,
  ): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
  }

  private statusFromError(message: string): number {
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
