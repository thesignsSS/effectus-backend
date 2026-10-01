import { createHmac } from 'node:crypto';
import type { AuthContext } from '../../src/app/modules/auth/auth-context.js';
import type { Logger } from '../../src/app/domain/interfaces/logger.interface.js';

export const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
export const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);

export function signJwt(
  payload: Record<string, unknown>,
  { secret = SECRET, alg = 'HS256' }: { secret?: string; alg?: string } = {},
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg, typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');

  return `${head}.${body}.${signature}`;
}

export function userToken(sub: string, overrides: Record<string, unknown> = {}): string {
  return signJwt({
    sub,
    email: `${sub}@example.com`,
    role: 'authenticated',
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  });
}

export function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-a',
    email: 'user-a@example.com',
    companyId: 'company-a',
    isAdmin: false,
    isOwner: false,
    ...overrides,
  };
}

export function memoryLogger() {
  const entries: { level: string; message: string; context?: Record<string, unknown> }[] = [];
  const logger: Logger = {
    info: (message, ctx) => entries.push({ level: 'info', message, context: ctx }),
    warn: (message, ctx) => entries.push({ level: 'warn', message, context: ctx }),
    error: (message, ctx) => entries.push({ level: 'error', message, context: ctx }),
  };

  return { logger, entries };
}
