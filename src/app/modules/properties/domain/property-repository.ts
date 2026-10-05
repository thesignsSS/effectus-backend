import type { Property, PropertyEvent, PropertyEventKind, PropertyStatus } from './property.js';
import type { PropertyAdData } from './property-ad.js';
import type { ValidPropertyData } from './property-validation.js';

export type NewPropertyRecord = Omit<ValidPropertyData, 'referenceCode' | 'responsibleBrokerId'> & {
  companyId: string;
  latitude?: number | null;
  longitude?: number | null;
  referenceCode: string;
  responsibleBrokerId: string;
  createdBy: string;
};

export type PropertyPatch = Partial<Omit<NewPropertyRecord, 'companyId' | 'createdBy'>> & {
  status?: PropertyStatus;
  ad?: Partial<PropertyAdData>;
  /** Nulo em mudança automática ("Sistema"). */
  updatedBy: string | null;
};

export type NewPropertyEvent = {
  companyId: string;
  propertyId: string;
  kind: PropertyEventKind;
  actorId: string | null;
  data?: Record<string, unknown>;
};

export type CompanyBroker = {
  id: string;
  fullName: string | null;
  isActive: boolean;
};

export type PropertyListQuery = {
  /** Já normalizado (minúsculas, sem acento) por quem chama. */
  search: string | null;
  statuses: PropertyStatus[];
  types: string[];
  responsibleBrokerId: string | null;
  page: number;
  pageSize: number;
};

/** Uso do imóvel em propostas e engenharias (15.1 e 15.4). */
export type PropertyUsage = {
  proposals: number;
  activeProposals: number;
  engineeringRequests: number;
};

export type DeleteResult = 'deleted' | 'has_history' | 'not_found';

export class DuplicateReferenceCode extends Error {
  constructor() {
    super('Já existe um imóvel com este código nesta imobiliária. Use outro código ou deixe em branco para gerar um');
    this.name = 'DuplicateReferenceCode';
  }
}

/**
 * Acesso aos dados do imóvel. Toda leitura e gravação recebe a empresa: não
 * existe método que alcance imóvel sem filtrar por `company_id` (seção 6.1).
 */
export interface PropertyRepository {
  insert(record: NewPropertyRecord): Promise<Property>;
  findById(companyId: string, id: string): Promise<Property | null>;
  update(companyId: string, id: string, patch: PropertyPatch): Promise<Property>;
  referenceCodeExists(companyId: string, code: string, exceptId?: string): Promise<boolean>;
  addEvent(event: NewPropertyEvent): Promise<void>;
  listEvents(companyId: string, propertyId: string): Promise<PropertyEvent[]>;
  findBroker(companyId: string, brokerId: string): Promise<CompanyBroker | null>;
  listBrokers(companyId: string): Promise<CompanyBroker[]>;
  /** Mais recente primeiro (9.7, [PROVISÓRIO]). Inativos só quando pedidos no filtro (9.4). */
  list(companyId: string, query: PropertyListQuery): Promise<{ items: Property[]; total: number }>;
  usage(companyId: string, id: string): Promise<PropertyUsage>;
  /** Apaga só se não houver proposta nem engenharia, checando na mesma operação (15.1). */
  deleteIfUnused(companyId: string, id: string): Promise<DeleteResult>;
  listIdsByResponsible(companyId: string, brokerId: string): Promise<string[]>;
}
