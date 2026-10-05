import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AuthContext, AuthContextResolver } from './auth-context.js';
import type { TokenVerifier } from './jwt-verifier.js';

export type AuthResult =
  | { kind: 'user'; context: AuthContext }
  /** Chave compartilhada antiga. Só aceita enquanto `acceptLegacyApiKey` (PRD, fase 1). */
  | { kind: 'legacy' }
  | { kind: 'unauthenticated' };

export interface RequestAuthenticatorConfig {
  legacyApiKey?: string;
  acceptLegacyApiKey: boolean;
}

/**
 * Decide quem está chamando. Ordem: JWT de sessão do Supabase (o caminho novo)
 * e, só na transição, a chave antiga. A chave chega pelo mesmo header
 * `Authorization: Bearer`, então é comparada antes de tentar ler como JWT.
 */
export class RequestAuthenticator {
  private readonly contexts = new WeakMap<IncomingMessage, AuthContext>();

  constructor(
    private readonly config: RequestAuthenticatorConfig,
    private readonly verifier: TokenVerifier,
    private readonly contextResolver: AuthContextResolver,
  ) {}

  async authenticate(request: IncomingMessage): Promise<AuthResult> {
    const result = await this.authenticateToken(readCredential(request));

    if (result.kind === 'user') this.contexts.set(request, result.context);

    return result;
  }

  /** Para quem não tem `IncomingMessage` à mão (ex.: query string do websocket). */
  async authenticateToken(credential: string | null): Promise<AuthResult> {
    if (!credential) return { kind: 'unauthenticated' };

    if (this.isLegacyKey(credential)) {
      return this.config.acceptLegacyApiKey ? { kind: 'legacy' } : { kind: 'unauthenticated' };
    }

    const token = await this.verifier.verify(credential);

    if (!token) return { kind: 'unauthenticated' };

    return { kind: 'user', context: await this.contextResolver.resolve(token) };
  }

  /** Contexto da requisição já autenticada; `undefined` na chave antiga. */
  contextOf(request: IncomingMessage): AuthContext | undefined {
    return this.contexts.get(request);
  }

  private isLegacyKey(credential: string): boolean {
    const key = this.config.legacyApiKey;

    if (!key) return false;

    const a = Buffer.from(credential);
    const b = Buffer.from(key);

    return a.length === b.length && timingSafeEqual(a, b);
  }
}

function readCredential(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  const bearer = value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer) return bearer;

  const apiKeyHeader = request.headers['x-api-key'];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

  return apiKey?.trim() || null;
}
