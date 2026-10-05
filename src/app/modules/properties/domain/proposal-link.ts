import type { AuthContext } from '../../auth/auth-context.js';
import type { PropertyStatus } from './property.js';

/** Proposta vista pelo módulo do imóvel: só o que a seção 13 precisa. */
export type LinkedProposal = {
  id: string;
  companyId: string;
  /** Código exibido ao usuário (ex.: PROP-012). */
  code: string;
  status: string;
  brokerUserId: string;
  propertyId: string | null;
  /** "Tipo do Imóvel" escolhido na proposta (Novo, Usado...), usado como modalidade no aviso 13.5. */
  modality: string | null;
};

/**
 * Acesso às propostas a partir do imóvel. A proposta continua sendo do
 * módulo de propostas; aqui só se lê e se grava o vínculo com o imóvel.
 */
export interface ProposalLinkGateway {
  /** Proposta da empresa do usuário que ele pode abrir (dono, colaborador ou ADM). */
  findAccessible(context: AuthContext, proposalId: string): Promise<LinkedProposal | null>;
  /** Uso do sistema (recalcular situação): sem usuário, a empresa vem da própria proposta. */
  findById(proposalId: string): Promise<LinkedProposal | null>;
  setProperty(companyId: string, proposalId: string, propertyId: string | null): Promise<void>;
  listByProperty(companyId: string, propertyId: string): Promise<LinkedProposal[]>;
}

/** Avisos do imóvel aos corretores (13.7 e 13.9), pelo sino de notificações. */
export interface PropertyAlerts {
  notify(alert: { userIds: string[]; proposalId: string; title: string; message: string }): Promise<void>;
}

/** Situações que passam a Em proposta quando o imóvel entra numa proposta ativa (13.6). */
const BECOME_IN_PROPOSAL: readonly PropertyStatus[] = ['disponivel', 'em_negociacao', 'reservado'];

/**
 * Situação do imóvel a partir das propostas ativas, sem contar finalização
 * (essa é tratada à parte, porque gera avisos). Regras 13.6, 13.8 e 13.14:
 * nunca coloca em Reservado e nunca tira de Inativo ou Vendido.
 */
export function situationFromActiveProposals(current: PropertyStatus, activeProposals: number): PropertyStatus {
  if (activeProposals > 0 && BECOME_IN_PROPOSAL.includes(current)) return 'em_proposta';
  if (activeProposals === 0 && current === 'em_proposta') return 'disponivel';

  return current;
}
