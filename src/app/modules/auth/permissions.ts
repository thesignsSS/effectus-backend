import { EMPRESA_SUSPENSA } from '../../infra/supabase/company-scope.js';
import type { AuthContext } from './auth-context.js';

/**
 * Ponto único de decisão de permissão para os módulos novos (imóvel, vendedor,
 * anúncios). Telas e API perguntam aqui, nunca decidem sozinhas — assim papéis
 * futuros (assistente de vendas, CCA) e a restrição por plano entram num lugar
 * só (spec BKL-093, seções 3 e 7).
 *
 * Cada módulo registra suas regras com `definePolicy`; este arquivo não conhece
 * nenhum domínio.
 */
export type PolicyRule<Resource> = (context: AuthContext, resource: Resource) => boolean;

export class PermissionDenied extends Error {
  constructor(public readonly action: string) {
    super('Sem permissão para esta ação');
    this.name = 'PermissionDenied';
  }
}

/** Mensagem com `EMPRESA_SUSPENSA`: o app reconhece o trecho e mostra a tela de suspensão. */
export class CompanySuspended extends Error {
  constructor(reason: string) {
    super(`${EMPRESA_SUSPENSA}: ${reason}. Fale com o suporte.`);
    this.name = 'CompanySuspended';
  }
}

/**
 * Exige empresa no perfil e com direito de uso. Toda rota dos módulos novos
 * passa por aqui antes de qualquer regra de domínio.
 */
export function requireActiveCompany(context: AuthContext): string {
  if (!context.companyId) throw new PermissionDenied('company');
  if (context.companyBlockedReason) throw new CompanySuspended(context.companyBlockedReason);

  return context.companyId;
}

export function definePolicy<Actions extends Record<string, PolicyRule<never>>>(rules: Actions) {
  return {
    can<A extends keyof Actions & string>(
      context: AuthContext,
      action: A,
      resource: Parameters<Actions[A]>[1],
    ): boolean {
      // Todo dado é de uma empresa: sem empresa ativa no perfil, nada é permitido.
      if (!context.companyId || context.companyBlockedReason) return false;

      return (rules[action] as PolicyRule<Parameters<Actions[A]>[1]>)(context, resource);
    },

    assert<A extends keyof Actions & string>(
      context: AuthContext,
      action: A,
      resource: Parameters<Actions[A]>[1],
    ): void {
      requireActiveCompany(context);

      if (!this.can(context, action, resource)) throw new PermissionDenied(action);
    },
  };
}

/** Mesma empresa do usuário — base de toda regra de isolamento. */
export function sameCompany(context: AuthContext, resource: { companyId: string }): boolean {
  return context.companyId !== null && context.companyId === resource.companyId;
}
