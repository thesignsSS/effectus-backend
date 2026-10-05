import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import { PROPERTY_STATUS_LABELS, type Property, type PropertyStatus } from '../domain/property.js';
import type { PropertyRepository } from '../domain/property-repository.js';
import { isActiveProposalPhase, isSuccessfulFinalPhase } from '../domain/proposal-phases.js';
import {
  situationFromActiveProposals,
  type LinkedProposal,
  type PropertyAlerts,
  type ProposalLinkGateway,
} from '../domain/proposal-link.js';

/** O que aconteceu com a proposta que pede o recálculo. */
export type ProposalChange =
  | { kind: 'linked'; proposal: LinkedProposal }
  | { kind: 'unlinked'; proposal: LinkedProposal }
  | { kind: 'phase_changed'; proposal: LinkedProposal }
  | { kind: 'deleted'; proposal: LinkedProposal };

/**
 * Regra central única da situação do imóvel em função das propostas (13.15).
 * Toda mudança de fase, de imóvel ou exclusão de proposta passa por aqui. A
 * mudança é gravada como "Sistema" (autor nulo) com a proposta que a causou.
 */
export class PropertySituationService {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly proposals: ProposalLinkGateway,
    private readonly alerts: PropertyAlerts,
    private readonly logger: Logger,
  ) {}

  async recalculate(companyId: string, propertyId: string, change: ProposalChange): Promise<void> {
    const property = await this.properties.findById(companyId, propertyId);

    if (!property) return;

    if (change.kind === 'phase_changed' && isSuccessfulFinalPhase(change.proposal.status)) {
      await this.onFinalized(property, change.proposal);
      return;
    }

    const linked = await this.proposals.listByProperty(companyId, propertyId);
    const active = linked.filter((proposal) => isActiveProposalPhase(proposal.status));
    const next = situationFromActiveProposals(property.status, active.length);

    await this.apply(property, next, change);
  }

  /**
   * 13.7 e 13.9: a proposta finalizada vende o imóvel e avisa os corretores
   * das outras propostas ativas, que continuam ativas. Imóvel Inativo não
   * vira Vendido; o responsável é avisado.
   */
  private async onFinalized(property: Property, finalized: LinkedProposal): Promise<void> {
    if (property.status === 'inativo') {
      await this.safeNotify({
        userIds: [property.responsibleBrokerId],
        proposalId: finalized.id,
        title: 'Proposta finalizada com imóvel inativo',
        message: `A proposta ${finalized.code} foi finalizada, mas o imóvel ${property.referenceCode} está Inativo e não foi marcado como Vendido. Revise a situação do imóvel.`,
      });
      return;
    }

    await this.apply(property, 'vendido', { kind: 'phase_changed', proposal: finalized });

    const linked = await this.proposals.listByProperty(property.companyId, property.id);
    const others = linked.filter((p) => p.id !== finalized.id && isActiveProposalPhase(p.status));

    for (const other of others) {
      await this.safeNotify({
        userIds: [other.brokerUserId],
        proposalId: other.id,
        title: 'Imóvel da proposta foi vendido',
        message: `O imóvel ${property.referenceCode} da proposta ${other.code} foi vendido pela proposta ${finalized.code}. Sua proposta continua ativa.`,
      });
    }
  }

  private async apply(property: Property, next: PropertyStatus, change: ProposalChange): Promise<void> {
    if (next === property.status) return;

    await this.properties.update(property.companyId, property.id, { status: next, updatedBy: null });
    await this.properties.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'status_changed',
      actorId: null,
      data: {
        from: property.status,
        to: next,
        reason: `proposal_${change.kind}`,
        proposalId: change.proposal.id,
        proposalCode: change.proposal.code,
      },
    });

    this.logger.info('Situação do imóvel recalculada', {
      propertyId: property.id,
      from: PROPERTY_STATUS_LABELS[property.status],
      to: PROPERTY_STATUS_LABELS[next],
      proposalId: change.proposal.id,
    });
  }

  /** O aviso não pode desfazer a mudança de situação. */
  private async safeNotify(alert: Parameters<PropertyAlerts['notify']>[0]): Promise<void> {
    await this.alerts.notify(alert).catch((error: unknown) =>
      this.logger.warn('Aviso de imóvel não enviado', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
