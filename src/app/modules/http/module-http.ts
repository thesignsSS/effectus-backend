import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../auth/auth-context.js';
import { CompanySuspended, PermissionDenied } from '../auth/permissions.js';

/**
 * Roteador de um módulo novo. Recebe a requisição já autenticada por JWT
 * (a chave antiga não chega aqui: módulo novo não aceita identidade declarada)
 * e devolve `true` se tratou a rota.
 */
export interface ModuleRouter {
  handle(request: IncomingMessage, response: ServerResponse, url: URL, context: AuthContext): Promise<boolean>;
}

/** Erro de negócio com status e, opcionalmente, mensagens por campo. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields?: Partial<Record<string, string>>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function readJson(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    request.on('data', (chunk: Buffer) => {
      total += chunk.length;

      if (total > maxBytes) {
        request.destroy();
        reject(new HttpError(413, 'Os dados enviados passam do limite permitido'));
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'Envie os dados como um objeto JSON'));
          return;
        }

        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Os dados enviados não são um JSON válido'));
      }
    });

    request.on('error', reject);
  });
}

/**
 * Traduz erro em resposta. Erros conhecidos viram mensagem para o usuário;
 * o resto vira 500 genérico, com o detalhe só no log (sem expor o banco).
 */
export function sendError(response: ServerResponse, error: unknown, logger: Logger, route: string): void {
  if (error instanceof HttpError) {
    sendJson(response, error.status, { ok: false, error: error.message, fields: error.fields });
    return;
  }

  if (error instanceof CompanySuspended || error instanceof PermissionDenied) {
    sendJson(response, 403, { ok: false, error: error.message });
    return;
  }

  logger.error('Erro inesperado em rota de módulo', {
    route,
    error: error instanceof Error ? error.message : String(error),
  });
  sendJson(response, 500, { ok: false, error: 'Algo deu errado do nosso lado. Tente de novo' });
}

/** Casa `/api/properties/:id/history` com `['/api/properties/', '/history']` e devolve o id. */
export function matchId(pathname: string, prefix: string, suffix = ''): string | null {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;

  const id = pathname.slice(prefix.length, pathname.length - suffix.length);

  return id && !id.includes('/') ? decodeURIComponent(id) : null;
}
