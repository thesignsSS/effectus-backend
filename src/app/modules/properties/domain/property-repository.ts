import type { Property, PropertyEvent, PropertyEventKind, PropertyStatus } from './property.js';
import type { ValidPropertyData } from './property-validation.js';

export type NewPropertyRecord = Omit<ValidPropertyData, 'referenceCode' | 'responsibleBrokerId'> & {
  companyId: string;
  referenceCode: string;
  responsibleBrokerId: string;
  createdBy: string;
};

export type PropertyPatch = Partial<Omit<NewPropertyRecord, 'companyId' | 'createdBy'>> & {
  status?: PropertyStatus;
  updatedBy: string;
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
}
