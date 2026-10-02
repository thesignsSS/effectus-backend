import { randomBytes } from 'node:crypto';
import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { requireActiveCompany } from '../../auth/permissions.js';
import type { MunicipalityDirectory } from '../domain/municipality-directory.js';
import { adReadinessLabel, computeAdReadiness, type AdReadiness } from '../domain/ad-readiness.js';
import type { PropertyPhotoRepository } from '../domain/property-photo-ports.js';
import { NoGeocoder, type Geocoder } from '../domain/geocoder.js';
import { validateAdInput, type AdInput } from '../domain/property-ad.js';
import {
  MANUAL_STATUSES_FOR_RESPONSIBLE,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type PropertyStatus,
  type Property,
  type PropertyEvent,
  type PropertyInput,
} from '../domain/property.js';
import { isCompanyAdmin, propertyPolicy } from '../domain/property-policy.js';
import {
  DuplicateReferenceCode,
  type CompanyBroker,
  type NewPropertyRecord,
  type PropertyPatch,
  type PropertyRepository,
} from '../domain/property-repository.js';
import { validatePropertyInput, type FieldErrors, type ValidPropertyData } from '../domain/property-validation.js';

export class PropertyNotFound extends Error {
  constructor() {
    // Mesma resposta para "não existe" e "é de outra empresa" (CA-8.10).
    super('Imóvel não encontrado');
    this.name = 'PropertyNotFound';
  }
}

export class MunicipalitiesUnavailable extends Error {
  constructor() {
    super('Não foi possível carregar os municípios agora. Tente de novo em instantes');
    this.name = 'MunicipalitiesUnavailable';
  }
}

export class PropertyValidationError extends Error {
  constructor(public readonly fields: FieldErrors) {
    super('Confira os campos destacados');
    this.name = 'PropertyValidationError';
  }
}

/** O que a tela recebe: o imóvel, nomes para exibir e o que o usuário pode fazer nele. */
export type PropertyView = Property & {
  typeLabel: string;
  statusLabel: string;
  responsibleBroker: { id: string; name: string | null };
  /** Presente quando o serviço tem acesso às fotos (detalhe e lista). */
  adReadiness?: AdReadiness;
  adReadinessLabel?: string;
  permissions: {
    canEdit: boolean;
    canChangeStatus: boolean;
    canCorrectType: boolean;
    canViewSellers: boolean;
    canDeleteOrInactivate: boolean;
    canTransfer: boolean;
    canUseInProposal: boolean;
  };
};

const REFERENCE_CODE_ATTEMPTS = 5;

export type PropertyHistoryItem = PropertyEvent & { actorName: string | null };

export class PropertyService {
  constructor(
    private readonly repository: PropertyRepository,
    private readonly municipalities: MunicipalityDirectory,
    private readonly logger: Logger,
    private readonly photos?: PropertyPhotoRepository,
    private readonly geocoder: Geocoder = new NoGeocoder(),
  ) {}

  /**
   * Dados do anúncio (seção 12). Salvar nunca é bloqueado por falta de
   * campo; telefone ou e-mail no texto voltam como aviso (12.4).
   */
  async saveAd(context: AuthContext, id: string, input: AdInput): Promise<{ property: PropertyView; warnings: string[] }> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'edit', property);

    const result = validateAdInput(input);

    if (!result.ok) throw new PropertyValidationError(result.errors);

    const updated = await this.repository.update(property.companyId, property.id, {
      ad: result.data,
      updatedBy: context.userId,
    });

    await this.repository.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'updated',
      actorId: context.userId,
      data: { section: 'ad' },
    });

    return { property: await this.toView(context, updated), warnings: result.warnings };
  }

  /** 12.6: tenta localizar; qualquer falha deixa o imóvel sem ponto no mapa, sem bloquear. */
  private async locate(address: ValidPropertyData['address']) {
    try {
      return (await this.geocoder.locate({ ...address })) ?? { latitude: null, longitude: null };
    } catch (error) {
      this.logger.warn('Imóvel salvo sem localização no mapa', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { latitude: null, longitude: null };
    }
  }

  /**
   * Mudança manual de situação (10.3 e 10.4). Responsável escolhe entre
   * Disponível, Em negociação, Reservado e Inativo; o ADM escolhe qualquer
   * uma. Toda mudança fica no histórico com anterior, nova, autor e hora (4.4).
   * A escolha do ADM vale até a próxima mudança automática (decisão 3).
   */
  async changeStatus(context: AuthContext, id: string, status: unknown): Promise<PropertyView> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'changeStatus', property);

    if (!PROPERTY_STATUSES.includes(status as PropertyStatus)) {
      throw new PropertyValidationError({ status: 'Escolha uma situação da lista' });
    }

    const next = status as PropertyStatus;
    if (!isCompanyAdmin(context) && !MANUAL_STATUSES_FOR_RESPONSIBLE.includes(next)) {
      throw new PropertyValidationError({
        status: 'Em proposta e Vendido mudam pelas propostas. Só o administrador escolhe essas situações à mão',
      });
    }

    if (next === property.status) return this.toView(context, property);

    const updated = await this.repository.update(property.companyId, property.id, {
      status: next,
      updatedBy: context.userId,
    });

    await this.repository.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'status_changed',
      actorId: context.userId,
      data: { from: property.status, to: next },
    });

    return this.toView(context, updated);
  }

  /** Seção 8: cadastra só com o essencial; nasce Disponível com quem cadastrou de responsável. */
  async create(context: AuthContext, input: PropertyInput): Promise<PropertyView> {
    const companyId = requireActiveCompany(context);
    propertyPolicy.assert(context, 'create', { companyId });

    const data = await this.validate(input);
    const responsible = await this.resolveResponsible(companyId, data.responsibleBrokerId ?? context.userId);
    const record = {
      ...data,
      ...(await this.locate(data.address)),
      companyId,
      createdBy: context.userId,
      responsibleBrokerId: responsible.id,
    };

    const property = data.referenceCode
      ? await this.insertWithCode(record, data.referenceCode)
      : await this.insertWithGeneratedCode(record);

    await this.repository.addEvent({
      companyId,
      propertyId: property.id,
      kind: 'created',
      actorId: context.userId,
      data: { status: property.status },
    });

    return this.toView(context, property, responsible);
  }

  async get(context: AuthContext, id: string): Promise<PropertyView> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'view', property);

    return this.toView(context, property);
  }

  /**
   * Edição pelo mesmo formulário (8.11). Valor de venda alterado não muda o
   * que as propostas já usaram (cada proposta guarda o próprio valor) e fica
   * no histórico com o valor anterior (decisão 9). O tipo só muda por
   * correção do ADM (decisão 6). Trocar o responsável é transferência, que é
   * só do ADM (seção 15).
   */
  async update(context: AuthContext, id: string, input: PropertyInput): Promise<PropertyView> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'edit', property);

    const data = await this.validate(input);
    const errors: FieldErrors = {};

    if (data.type !== property.type && !propertyPolicy.can(context, 'correctType', property)) {
      errors.type = 'Só o administrador corrige o tipo depois do cadastro';
    }

    const wantedResponsible = data.responsibleBrokerId ?? property.responsibleBrokerId;
    const responsibleChanged = wantedResponsible !== property.responsibleBrokerId;

    if (responsibleChanged && !propertyPolicy.can(context, 'transfer', property)) {
      errors.responsibleBrokerId = 'Só o administrador transfere o imóvel para outro corretor';
    }

    if (Object.keys(errors).length > 0) throw new PropertyValidationError(errors);

    const responsible = responsibleChanged
      ? await this.resolveResponsible(property.companyId, wantedResponsible)
      : null;
    const referenceCode = data.referenceCode ?? property.referenceCode;

    if (
      referenceCode !== property.referenceCode &&
      (await this.repository.referenceCodeExists(property.companyId, referenceCode, property.id))
    ) {
      throw new PropertyValidationError({ referenceCode: new DuplicateReferenceCode().message });
    }

    const addressChanged = JSON.stringify(data.address) !== JSON.stringify(property.address);
    const patch: PropertyPatch = {
      ...data,
      ...(addressChanged ? await this.locate(data.address) : {}),
      referenceCode,
      responsibleBrokerId: wantedResponsible,
      updatedBy: context.userId,
    };

    const updated = await this.repository.update(property.companyId, property.id, patch).catch((error: unknown) => {
      if (error instanceof DuplicateReferenceCode) {
        throw new PropertyValidationError({ referenceCode: error.message });
      }
      throw error;
    });

    await this.recordEditEvents(context, property, updated);

    return this.toView(context, updated, responsible ?? undefined);
  }

  /** Histórico do imóvel, mais recente primeiro, com o nome de quem fez ("Sistema" = nulo). */
  async history(context: AuthContext, id: string): Promise<PropertyHistoryItem[]> {
    const property = await this.load(context, id);
    propertyPolicy.assert(context, 'view', property);

    const [events, brokers] = await Promise.all([
      this.repository.listEvents(property.companyId, property.id),
      this.repository.listBrokers(property.companyId),
    ]);
    const names = new Map(brokers.map((broker) => [broker.id, broker.fullName]));

    return events.map((event) => ({ ...event, actorName: event.actorId ? (names.get(event.actorId) ?? null) : null }));
  }

  /** Corretores da empresa para escolher o responsável (8.9). */
  async listBrokers(context: AuthContext): Promise<CompanyBroker[]> {
    const companyId = requireActiveCompany(context);

    return (await this.repository.listBrokers(companyId)).filter((broker) => broker.isActive);
  }

  async listMunicipalities(context: AuthContext, state: string) {
    requireActiveCompany(context);

    const list = await this.municipalities.listByState(state);

    if (!list) throw new MunicipalitiesUnavailable();

    return list;
  }

  private async load(context: AuthContext, id: string): Promise<Property> {
    const companyId = requireActiveCompany(context);
    const property = await this.repository.findById(companyId, id);

    if (!property) throw new PropertyNotFound();

    return property;
  }

  private async validate(input: PropertyInput): Promise<ValidPropertyData> {
    const result = validatePropertyInput(input);

    if (!result.ok) throw new PropertyValidationError(result.errors);

    const { address } = result.data;
    const check = await this.municipalities.check(address.state, address.municipality, address.municipalityIbgeCode);

    if (check.status === 'invalid') {
      throw new PropertyValidationError({
        'address.municipality': `Escolha um município de ${address.state}`,
      });
    }

    if (check.status === 'unavailable') {
      // [PROVISÓRIO] IBGE fora do ar não impede cadastrar: grava como digitado.
      this.logger.warn('Município salvo sem validação no IBGE', { state: address.state });

      return result.data;
    }

    return {
      ...result.data,
      address: {
        ...address,
        municipality: check.municipality.name,
        municipalityIbgeCode: check.municipality.ibgeCode,
      },
    };
  }

  private async resolveResponsible(companyId: string, brokerId: string): Promise<CompanyBroker> {
    const broker = await this.repository.findBroker(companyId, brokerId);

    if (!broker || !broker.isActive) {
      throw new PropertyValidationError({
        responsibleBrokerId: 'Escolha um corretor ativo desta imobiliária',
      });
    }

    return broker;
  }

  private async insertWithCode(record: Omit<NewPropertyRecord, 'referenceCode'>, code: string) {
    if (await this.repository.referenceCodeExists(record.companyId, code)) {
      throw new PropertyValidationError({ referenceCode: new DuplicateReferenceCode().message });
    }

    try {
      return await this.repository.insert({ ...record, referenceCode: code });
    } catch (error) {
      if (error instanceof DuplicateReferenceCode) {
        throw new PropertyValidationError({ referenceCode: error.message });
      }
      throw error;
    }
  }

  /** 8.6: código em branco recebe um único na empresa; colisão rara tenta outro. */
  private async insertWithGeneratedCode(record: Omit<NewPropertyRecord, 'referenceCode'>) {
    for (let attempt = 1; attempt <= REFERENCE_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.repository.insert({ ...record, referenceCode: generateReferenceCode() });
      } catch (error) {
        if (!(error instanceof DuplicateReferenceCode) || attempt === REFERENCE_CODE_ATTEMPTS) throw error;
      }
    }

    throw new Error('Não foi possível gerar um código para o imóvel');
  }

  private async recordEditEvents(context: AuthContext, before: Property, after: Property) {
    const base = { companyId: after.companyId, propertyId: after.id, actorId: context.userId };
    const events: Promise<void>[] = [];

    if (before.salePrice !== after.salePrice) {
      events.push(this.repository.addEvent({ ...base, kind: 'price_changed', data: { from: before.salePrice, to: after.salePrice } }));
    }

    if (before.type !== after.type) {
      events.push(this.repository.addEvent({ ...base, kind: 'type_corrected', data: { from: before.type, to: after.type } }));
    }

    if (before.responsibleBrokerId !== after.responsibleBrokerId) {
      events.push(
        this.repository.addEvent({
          ...base,
          kind: 'transferred',
          data: { from: before.responsibleBrokerId, to: after.responsibleBrokerId },
        }),
      );
    }

    events.push(this.repository.addEvent({ ...base, kind: 'updated' }));

    await Promise.all(events);
  }

  private async toView(context: AuthContext, property: Property, responsible?: CompanyBroker): Promise<PropertyView> {
    const broker = responsible ?? (await this.repository.findBroker(property.companyId, property.responsibleBrokerId));
    const can = (action: Parameters<typeof propertyPolicy.can>[1]) => propertyPolicy.can(context, action, property);
    const summary = this.photos
      ? ((await this.photos.summaries(property.companyId, [property.id])).get(property.id) ?? { count: 0, coverPath: null })
      : null;
    const readiness = summary
      ? computeAdReadiness({
          status: property.status,
          typology: property.ad.typology,
          title: property.ad.title,
          headline: property.ad.headline,
          municipality: property.address.municipality,
          state: property.address.state,
          photoCount: summary.count,
          hasCover: Boolean(summary.coverPath),
        })
      : undefined;

    return {
      ...property,
      adReadiness: readiness,
      adReadinessLabel: readiness ? adReadinessLabel(readiness) : undefined,
      // Observações internas e avaliação ficam visíveis a todo o time por
      // enquanto (seção 5 + decisão 17, pendente de privacidade).
      typeLabel: PROPERTY_TYPE_LABELS[property.type],
      statusLabel: PROPERTY_STATUS_LABELS[property.status],
      responsibleBroker: { id: property.responsibleBrokerId, name: broker?.fullName ?? null },
      permissions: {
        canEdit: can('edit'),
        canChangeStatus: can('changeStatus'),
        canCorrectType: can('correctType'),
        canViewSellers: can('viewSellers'),
        canDeleteOrInactivate: can('deleteOrInactivate'),
        canTransfer: can('transfer'),
        canUseInProposal: can('useInProposal'),
      },
    };
  }
}

/** Ex.: IM-4F7K2Q. Sem 0/O/1/I para não confundir quem lê em voz alta. */
function generateReferenceCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);

  return `IM-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

