import type { AuthContext } from '../../auth/auth-context.js';
import { definePolicy, sameCompany } from '../../auth/permissions.js';
import type { Property } from './property.js';

type PropertyRef = Pick<Property, 'companyId' | 'responsibleBrokerId'>;

/**
 * Administrador da empresa para as regras do imóvel. Inclui o dono do plano
 * mesmo sem papel `admin`: ele herda os imóveis de corretores desligados
 * (decisão 10) e precisa poder geri-los. [PROVISÓRIO] até a spec definir o
 * dono como papel próprio.
 */
export function isCompanyAdmin(context: AuthContext): boolean {
  return context.isAdmin || context.isOwner;
}

function isResponsible(context: AuthContext, property: PropertyRef): boolean {
  return context.userId === property.responsibleBrokerId;
}

/**
 * Tabela da seção 3 da spec, colunas Corretor responsável, Outro corretor e
 * ADM. Assistente de vendas e CCA são [FUTURO] e entram aqui quando existirem.
 */
export const propertyPolicy = definePolicy({
  view: (ctx: AuthContext, p: PropertyRef) => sameCompany(ctx, p),
  create: (ctx: AuthContext, p: { companyId: string }) => sameCompany(ctx, p),
  edit: (ctx: AuthContext, p: PropertyRef) =>
    sameCompany(ctx, p) && (isResponsible(ctx, p) || isCompanyAdmin(ctx)),
  changeStatus: (ctx: AuthContext, p: PropertyRef) =>
    sameCompany(ctx, p) && (isResponsible(ctx, p) || isCompanyAdmin(ctx)),
  /** Decisão 6: o tipo não muda depois do cadastro, salvo correção do ADM. */
  correctType: (ctx: AuthContext, p: PropertyRef) => sameCompany(ctx, p) && isCompanyAdmin(ctx),
  viewSellers: (ctx: AuthContext, p: PropertyRef) =>
    sameCompany(ctx, p) && (isResponsible(ctx, p) || isCompanyAdmin(ctx)),
  deleteOrInactivate: (ctx: AuthContext, p: PropertyRef) =>
    sameCompany(ctx, p) && (isResponsible(ctx, p) || isCompanyAdmin(ctx)),
  transfer: (ctx: AuthContext, p: PropertyRef) => sameCompany(ctx, p) && isCompanyAdmin(ctx),
  useInProposal: (ctx: AuthContext, p: PropertyRef) => sameCompany(ctx, p),
});

export type PropertyAction = Parameters<typeof propertyPolicy.can>[1];
