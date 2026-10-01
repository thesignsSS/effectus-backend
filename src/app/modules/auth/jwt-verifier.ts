import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type VerifiedToken = {
  userId: string;
  email: string | null;
};

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}

/**
 * Verifica o JWT de sessão do Supabase sem chamada de rede, com o segredo
 * HS256 do projeto (`SUPABASE_JWT_SECRET`). É o caminho previsto no PRD de
 * autenticação do bot (RNF1): a API inteira passa por aqui a cada requisição.
 *
 * Aceita só HS256. `alg: none` ou qualquer outro algoritmo é recusado, para
 * que um token forjado não escolha como será verificado.
 */
export class Hs256TokenVerifier implements TokenVerifier {
  private readonly secret: Buffer;

  constructor(secret: string, private readonly now: () => number = Date.now) {
    this.secret = Buffer.from(secret, 'utf8');
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    const parts = token.split('.');

    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson(encodedHeader);

    if (!header || header.alg !== 'HS256') return null;

    const expected = createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const received = base64UrlToBuffer(encodedSignature);

    if (!received || received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return null;
    }

    const payload = decodeJson(encodedPayload);

    if (!payload) return null;

    const nowSeconds = Math.floor(this.now() / 1000);

    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) return null;
    // Token de serviço (anon/service_role) também é assinado com o mesmo segredo,
    // mas não representa um usuário.
    if (payload.role !== 'authenticated') return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;

    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  }
}

/**
 * Plano B quando o segredo não está configurado: pergunta ao próprio Supabase
 * (`auth.getUser`). Custa uma chamada de rede, então o resultado fica em cache
 * pelo hash do token até expirar ou por `ttlMs`, o que vier primeiro.
 */
export class SupabaseRemoteTokenVerifier implements TokenVerifier {
  private readonly cache = new Map<string, { value: VerifiedToken | null; expiresAt: number }>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(token: string): Promise<VerifiedToken | null> {
    const key = createHash('sha256').update(token).digest('hex');
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > this.now()) return cached.value;

    const { data, error } = await this.client.auth.getUser(token);
    const value = error || !data.user ? null : { userId: data.user.id, email: data.user.email ?? null };
    const tokenExp = readExpiry(token);
    const expiresAt = Math.min(this.now() + this.ttlMs, tokenExp ?? Number.POSITIVE_INFINITY);

    this.cache.set(key, { value, expiresAt });
    this.pruneExpired();

    return value;
  }

  private pruneExpired() {
    if (this.cache.size < 1000) return;

    const now = this.now();

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

type JwtPart = Record<string, unknown>;

function decodeJson(segment: string): JwtPart | null {
  const buffer = base64UrlToBuffer(segment);

  if (!buffer) return null;

  try {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JwtPart) : null;
  } catch {
    return null;
  }
}

function base64UrlToBuffer(segment: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return null;

  return Buffer.from(segment, 'base64url');
}

function readExpiry(token: string): number | null {
  const payload = decodeJson(token.split('.')[1] ?? '');

  return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
}
