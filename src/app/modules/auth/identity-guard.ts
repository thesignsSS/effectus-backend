import type { Logger } from '../../domain/interfaces/logger.interface.js';
import type { AuthContext } from './auth-context.js';

/**
 * Campos em que o cliente declara *quem é* (PRD de autenticação, seção 3).
 * Campos que apontam para o *alvo* da operação (ex.: `targetUserId` do admin
 * agindo sobre um membro do time, ou o id no caminho da URL) ficam de fora de
 * propósito: não são identidade e não podem ser trocados pelo id do token.
 */
export const IDENTITY_FIELDS = ['userId', 'usuarioId', 'brokerUserId', 'corretorUserId'] as const;

/**
 * `log`: só registra quando o id declarado diverge do token (fase 2 do PRD,
 * para descobrir com dado real quais telas ainda mandam id errado).
 * `enforce`: além de registrar, substitui pelo id do token.
 */
export type IdentityMode = 'log' | 'enforce';

export class IdentityGuard {
  constructor(
    private readonly mode: IdentityMode,
    private readonly logger: Logger,
  ) {}

  applyToSearchParams(params: URLSearchParams, context: AuthContext, route: string): void {
    for (const field of IDENTITY_FIELDS) {
      const declared = params.get(field)?.trim();

      if (declared === undefined || declared === context.userId) continue;

      this.report(field, 'query', route, declared === '');

      if (this.mode === 'enforce') params.set(field, context.userId);
    }
  }

  applyToBody<T extends Record<string, unknown>>(body: T, context: AuthContext, route: string): T {
    for (const field of IDENTITY_FIELDS) {
      if (!(field in body)) continue;

      const declared = body[field];

      if (typeof declared === 'string' && declared.trim() === context.userId) continue;

      this.report(field, 'body', route, typeof declared !== 'string' || declared.trim() === '');

      if (this.mode === 'enforce') (body as Record<string, unknown>)[field] = context.userId;
    }

    return body;
  }

  private report(field: string, source: 'query' | 'body', route: string, empty: boolean) {
    // Sem os ids: o log diz onde a divergência acontece, não de quem para quem.
    this.logger.warn('Identidade declarada diverge do token', {
      field,
      source,
      route,
      empty,
      mode: this.mode,
    });
  }
}

/** Normaliza o caminho para agrupar o log: ids viram `:id`. */
export function routeLabel(method: string | undefined, pathname: string): string {
  const normalized = pathname
    .split('/')
    .map((segment) => (/^[0-9a-f-]{8,}$/i.test(segment) || /^\d+$/.test(segment) ? ':id' : segment))
    .join('/');

  return `${method ?? 'GET'} ${normalized}`;
}
