import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Lista vazia mantém o comportamento antigo (`*`), para o deploy não quebrar
 * antes de `CORS_ALLOWED_ORIGINS` ser configurado em cada ambiente.
 */
export function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
): void {
  if (allowedOrigins.length === 0) {
    response.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const origin = request.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
    }

    response.setHeader('Vary', 'Origin');
  }

  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
}
