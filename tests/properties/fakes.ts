import { randomUUID } from 'node:crypto';
import type { Property, PropertyEvent } from '../../src/app/modules/properties/domain/property.js';
import {
  DuplicateReferenceCode,
  type CompanyBroker,
  type NewPropertyEvent,
  type NewPropertyRecord,
  type PropertyPatch,
  type PropertyRepository,
} from '../../src/app/modules/properties/domain/property-repository.js';
import {
  checkAgainstList,
  type Municipality,
  type MunicipalityDirectory,
} from '../../src/app/modules/properties/domain/municipality-directory.js';
import type { PropertyInput } from '../../src/app/modules/properties/domain/property.js';

export const COMPANY_A = 'company-a';
export const COMPANY_B = 'company-b';
export const BROKER_A = '11111111-1111-4111-8111-111111111111';
export const BROKER_C = '33333333-3333-4333-8333-333333333333';
export const ADMIN_A = '22222222-2222-4222-8222-222222222222';
export const BROKER_B = '44444444-4444-4444-8444-444444444444';

type BrokerRow = CompanyBroker & { companyId: string };

export class InMemoryPropertyRepository implements PropertyRepository {
  readonly properties: Property[] = [];
  readonly events: (NewPropertyEvent & { createdAt: string })[] = [];
  readonly brokers: BrokerRow[] = [
    { id: BROKER_A, fullName: 'Ana Corretora', isActive: true, companyId: COMPANY_A },
    { id: BROKER_C, fullName: 'Carlos Corretor', isActive: true, companyId: COMPANY_A },
    { id: ADMIN_A, fullName: 'Adm da Imobiliária', isActive: true, companyId: COMPANY_A },
    { id: BROKER_B, fullName: 'Bia de Outra Empresa', isActive: true, companyId: COMPANY_B },
  ];

  async insert(record: NewPropertyRecord): Promise<Property> {
    if (this.properties.some((p) => p.companyId === record.companyId && p.referenceCode === record.referenceCode)) {
      throw new DuplicateReferenceCode();
    }

    const now = new Date().toISOString();
    const property: Property = {
      id: randomUUID(),
      companyId: record.companyId,
      referenceCode: record.referenceCode,
      type: record.type,
      salePrice: record.salePrice,
      developmentName: record.developmentName,
      address: record.address,
      privateAreaM2: record.privateAreaM2,
      totalAreaM2: record.totalAreaM2,
      registrationNumber: record.registrationNumber,
      appraisal:
        record.hasAppraisal && record.appraisalValue && record.appraisalValidUntil
          ? { value: record.appraisalValue, validUntil: record.appraisalValidUntil }
          : null,
      internalNotes: record.internalNotes,
      responsibleBrokerId: record.responsibleBrokerId,
      status: 'disponivel',
      statusChangedAt: now,
      createdBy: record.createdBy,
      updatedBy: record.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    this.properties.push(property);

    return { ...property };
  }

  async findById(companyId: string, id: string): Promise<Property | null> {
    const found = this.properties.find((p) => p.companyId === companyId && p.id === id);

    return found ? { ...found } : null;
  }

  async update(companyId: string, id: string, patch: PropertyPatch): Promise<Property> {
    const index = this.properties.findIndex((p) => p.companyId === companyId && p.id === id);
    const current = this.properties[index];
    const next: Property = {
      ...current,
      referenceCode: patch.referenceCode ?? current.referenceCode,
      type: patch.type ?? current.type,
      salePrice: patch.salePrice ?? current.salePrice,
      address: patch.address ?? current.address,
      responsibleBrokerId: patch.responsibleBrokerId ?? current.responsibleBrokerId,
      internalNotes: patch.internalNotes === undefined ? current.internalNotes : patch.internalNotes,
      status: patch.status ?? current.status,
      updatedBy: patch.updatedBy,
      updatedAt: new Date().toISOString(),
    };

    this.properties[index] = next;

    return { ...next };
  }

  async referenceCodeExists(companyId: string, code: string, exceptId?: string): Promise<boolean> {
    return this.properties.some((p) => p.companyId === companyId && p.referenceCode === code && p.id !== exceptId);
  }

  async addEvent(event: NewPropertyEvent): Promise<void> {
    this.events.push({ ...event, createdAt: new Date().toISOString() });
  }

  async listEvents(companyId: string, propertyId: string): Promise<PropertyEvent[]> {
    return this.events
      .filter((e) => e.companyId === companyId && e.propertyId === propertyId)
      .map((e, i) => ({
        id: String(i),
        propertyId: e.propertyId,
        kind: e.kind,
        actorId: e.actorId,
        data: e.data ?? {},
        createdAt: e.createdAt,
      }))
      .reverse();
  }

  async findBroker(companyId: string, brokerId: string): Promise<CompanyBroker | null> {
    const found = this.brokers.find((b) => b.companyId === companyId && b.id === brokerId);

    return found ? { id: found.id, fullName: found.fullName, isActive: found.isActive } : null;
  }

  async listBrokers(companyId: string): Promise<CompanyBroker[]> {
    return this.brokers.filter((b) => b.companyId === companyId);
  }
}

const MUNICIPALITIES: Record<string, Municipality[]> = {
  CE: [
    { ibgeCode: '2304400', name: 'Fortaleza' },
    { ibgeCode: '2303709', name: 'Caucaia' },
  ],
  SP: [{ ibgeCode: '3550308', name: 'São Paulo' }],
};

export class FakeMunicipalityDirectory implements MunicipalityDirectory {
  available = true;

  async listByState(state: string): Promise<Municipality[] | null> {
    return this.available ? (MUNICIPALITIES[state] ?? []) : null;
  }

  async check(state: string, municipality: string, ibgeCode?: string | null) {
    return checkAgainstList(await this.listByState(state), municipality, ibgeCode);
  }
}

export function validInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return {
    type: 'usado',
    salePrice: 890000,
    address: {
      state: 'CE',
      municipality: 'Fortaleza',
      neighborhood: 'Meireles',
      street: 'Rua Silva Jatahy',
      number: '1200',
      complement: 'Apto 1001',
      postalCode: '60165-070',
    },
    ...overrides,
  };
}
