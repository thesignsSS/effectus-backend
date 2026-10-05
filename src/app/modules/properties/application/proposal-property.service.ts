import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { requireActiveCompany } from '../../auth/permissions.js';
import { modalityWarning } from '../domain/modality-compatibility.js';
import { PROPERTY_STATUS_LABELS, STATUSES_BLOCKING_NEW_USE, type Property } from '../domain/property.js';
import { propertyPolicy } from '../domain/property-policy.js';
import type { PropertyRepository } from '../domain/property-repository.js';
import { isSuccessfulFinalPhase } from '../domain/proposal-phases.js';
import type { LinkedProposal, ProposalLinkGateway } from '../domain/proposal-link.js';
import type { PropertyListItem, PropertyListService } from './property-list.service.js';
import type { PropertySituationService } from './property-situation.service.js';
import { PropertyNotFound, PropertyValidationError } from './property.service.js';

export class ProposalNotFound extends Error {
  constructor() {
    super('Proposta não encontrada.');
    this.name = 'ProposalNotFound';
  }
}

/** 13.11 e CA-13.14: proposta Finalizada não troca de imóvel, nem por pedido direto. */
export class ProposalPropertyLocked extends Error {
  constructor() {
    super('Esta proposta já foi finalizada e não pode trocar de imóvel.');
    this.name = 'ProposalPropertyLocked';
  }
}

/** Bloco do imóvel na proposta (seção 13, "Proposta com imóvel"). */
export type ProposalPropertyView = {
  property: PropertyListItem | null;
  /** Trocar, vincular ou remover: só antes de Finalizado. */
  canChange: boolean;
  /** 13.5: só avisa. Nulo enquanto a tabela de compatibilidade não existir. */
  modalityWarning: string | null;
};

/**
 * Seção 13: vínculo de 0 ou 1 imóvel por proposta. A situação do imóvel é
 * sempre recalculada pela regra central (`PropertySituationService`).
 */
export class ProposalPropertyService {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly proposals: ProposalLinkGateway,
    private readonly situation: PropertySituationService,
    private readonly list: PropertyListService,
    private readonly logger: Logger,
  ) {}

  async view(context: AuthContext, proposalId: string): Promise<ProposalPropertyView> {
    const proposal = await this.loadProposal(context, proposalId);
    const canChange = !isSuccessfulFinalPhase(proposal.status);

    if (!proposal.propertyId) return { property: null, canChange, modalityWarning: null };

    const property = await this.properties.findById(proposal.companyId, proposal.propertyId);

    if (!property) return { property: null, canChange, modalityWarning: null };

    const [item] = await this.list.toItems(proposal.companyId, [property]);

    return { property: item, canChange, modalityWarning: modalityWarning(proposal.modality, property.type) };
  }

  /**
   * Confere se o imóvel pode entrar numa proposta nova (13.3, CA-13.13): da
   * mesma empresa e nem Vendido nem Inativo. Usado antes de criar a proposta,
   * para não criar proposta com vínculo que vai falhar.
   */
  async assertLinkable(context: AuthContext, propertyId: string): Promise<Property> {
    const companyId = requireActiveCompany(context);
    const property = await this.properties.findById(companyId, propertyId);

    if (!property) throw new PropertyNotFound();

    propertyPolicy.assert(context, 'useInProposal', property);

    if (STATUSES_BLOCKING_NEW_USE.includes(property.status)) {
      throw new PropertyValidationError({
        propertyId: `Este imóvel está ${PROPERTY_STATUS_LABELS[property.status]} e não pode entrar em nova proposta. Escolha outro imóvel`,
      });
    }

    return property;
  }

  /** Vincula, troca (13.11) ou remove (`null`) o imóvel de uma proposta existente. */
  async link(context: AuthContext, proposalId: string, propertyId: string | null): Promise<ProposalPropertyView> {
    const proposal = await this.loadProposal(context, proposalId);

    if (isSuccessfulFinalPhase(proposal.status)) throw new ProposalPropertyLocked();

    if (propertyId === proposal.propertyId) return this.view(context, proposalId);

    if (propertyId) await this.assertLinkable(context, propertyId);

    await this.proposals.setProperty(proposal.companyId, proposal.id, propertyId);

    if (proposal.propertyId) {
      await this.situation.recalculate(proposal.companyId, proposal.propertyId, {
        kind: 'unlinked',
        proposal: { ...proposal, propertyId },
      });
    }

    if (propertyId) {
      await this.situation.recalculate(proposal.companyId, propertyId, {
        kind: 'linked',
        proposal: { ...proposal, propertyId },
      });
    }

    this.logger.info('Imóvel da proposta alterado', {
      proposalId: proposal.id,
      from: proposal.propertyId,
      to: propertyId,
      by: context.userId,
    });

    return this.view(context, proposalId);
  }

  /** Gancho do módulo de propostas: a fase mudou. */
  async onPhaseChanged(proposalId: string): Promise<void> {
    const proposal = await this.proposals.findById(proposalId);

    if (!proposal?.propertyId) return;

    await this.situation.recalculate(proposal.companyId, proposal.propertyId, { kind: 'phase_changed', proposal });
  }

  /**
   * Gancho do módulo de propostas: lê o imóvel antes da exclusão e devolve o
   * que rodar depois dela, quando a proposta já não conta como ativa (13.8).
   */
  async beforeProposalDeleted(proposalId: string): Promise<() => Promise<void>> {
    const proposal = await this.proposals.findById(proposalId);

    if (!proposal?.propertyId) return async () => undefined;

    const propertyId = proposal.propertyId;

    return () => this.situation.recalculate(proposal.companyId, propertyId, { kind: 'deleted', proposal });
  }

  private async loadProposal(context: AuthContext, proposalId: string): Promise<LinkedProposal> {
    requireActiveCompany(context);
    const proposal = await this.proposals.findAccessible(context, proposalId);

    if (!proposal) throw new ProposalNotFound();

    return proposal;
  }
}
