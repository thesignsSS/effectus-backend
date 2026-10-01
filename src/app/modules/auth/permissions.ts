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

export function definePolicy<Actions extends Record<string, PolicyRule<never>>>(rules: Actions) {
  return {
    can<A extends keyof Actions & string>(
      context: AuthContext,
      action: A,
      resource: Parameters<Actions[A]>[1],
    ): boolean {
      // Todo dado é de uma empresa: sem empresa no perfil, nada é permitido.
      if (!context.companyId) return false;

      return (rules[action] as PolicyRule<Parameters<Actions[A]>[1]>)(context, resource);
    },

    assert<A extends keyof Actions & string>(
      context: AuthContext,
      action: A,
      resource: Parameters<Actions[A]>[1],
    ): void {
      if (!this.can(context, action, resource)) throw new PermissionDenied(action);
    },
  };
}

/** Mesma empresa do usuário — base de toda regra de isolamento. */
export function sameCompany(context: AuthContext, resource: { companyId: string }): boolean {
  return context.companyId !== null && context.companyId === resource.companyId;
}
