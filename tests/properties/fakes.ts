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
import { normalizeName } from '../../src/app/modules/properties/domain/municipality-directory.js';
import type { PropertyPhoto } from '../../src/app/modules/properties/domain/property-photo.js';
import type {
  NewPropertyPhoto,
  PhotoStorage,
  PhotoSummary,
  PhotoUrls,
  PropertyPhotoRepository,
  SignedUpload,
} from '../../src/app/modules/properties/domain/property-photo-ports.js';
import type {
  DeleteResult,
  PropertyListQuery,
  PropertyUsage,
} from '../../src/app/modules/properties/domain/property-repository.js';
import { EMPTY_AD } from '../../src/app/modules/properties/domain/property-ad.js';

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
      ad: { ...EMPTY_AD, latitude: record.latitude ?? null, longitude: record.longitude ?? null },
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
      ad: { ...current.ad, ...(patch.ad ?? {}), ...(patch.latitude !== undefined ? { latitude: patch.latitude, longitude: patch.longitude ?? null } : {}) },
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

  /** Uso em propostas e engenharias, definido pelo teste. */
  readonly usageById = new Map<string, PropertyUsage>();

  async usage(_companyId: string, id: string): Promise<PropertyUsage> {
    return this.usageById.get(id) ?? { proposals: 0, activeProposals: 0, engineeringRequests: 0 };
  }

  async deleteIfUnused(companyId: string, id: string): Promise<DeleteResult> {
    const index = this.properties.findIndex((p) => p.companyId === companyId && p.id === id);
    if (index < 0) return 'not_found';
    const usage = await this.usage(companyId, id);
    if (usage.proposals > 0 || usage.engineeringRequests > 0) return 'has_history';
    this.properties.splice(index, 1);
    return 'deleted';
  }

  async listIdsByResponsible(companyId: string, brokerId: string): Promise<string[]> {
    return this.properties.filter((p) => p.companyId === companyId && p.responsibleBrokerId === brokerId).map((p) => p.id);
  }

  /** Imita o banco: search_text sem acento e em minúsculas; inativos só quando pedidos. */
  async list(companyId: string, query: PropertyListQuery) {
    const searchText = (p: Property) =>
      normalizeName([p.address.street, p.address.number, p.address.neighborhood, p.address.municipality, p.referenceCode, p.registrationNumber, p.developmentName].filter(Boolean).join(' '));
    const filtered = this.properties
      .filter((p) => p.companyId === companyId)
      .filter((p) => (query.statuses.length ? query.statuses.includes(p.status) : p.status !== 'inativo'))
      .filter((p) => !query.types.length || query.types.includes(p.type))
      .filter((p) => !query.responsibleBrokerId || p.responsibleBrokerId === query.responsibleBrokerId)
      .filter((p) => !query.search || searchText(p).includes(query.search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const from = (query.page - 1) * query.pageSize;

    return { items: filtered.slice(from, from + query.pageSize).map((p) => ({ ...p })), total: filtered.length };
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

export class InMemoryPhotoRepository implements PropertyPhotoRepository {
  photos: PropertyPhoto[] = [];

  async list(companyId: string, propertyId: string) {
    return this.photos
      .filter((p) => p.companyId === companyId && p.propertyId === propertyId)
      .sort((a, b) => a.position - b.position);
  }

  async find(companyId: string, propertyId: string, photoId: string) {
    return this.photos.find((p) => p.companyId === companyId && p.propertyId === propertyId && p.id === photoId) ?? null;
  }

  async add(photo: NewPropertyPhoto) {
    const existing = await this.list(photo.companyId, photo.propertyId);
    const created: PropertyPhoto = {
      ...photo,
      id: randomUUID(),
      isCover: !existing.some((p) => p.isCover),
      position: existing.length + 1,
      createdAt: new Date().toISOString(),
    };
    this.photos.push(created);
    return created;
  }

  async setCover(companyId: string, propertyId: string, photoId: string) {
    for (const photo of await this.list(companyId, propertyId)) photo.isCover = photo.id === photoId;
  }

  async summaries(companyId: string, propertyIds: string[]) {
    const result = new Map<string, PhotoSummary>();
    for (const id of propertyIds) {
      const list = await this.list(companyId, id);
      if (list.length) result.set(id, { count: list.length, coverPath: list.find((p) => p.isCover)?.storagePath ?? null });
    }
    return result;
  }

  async remove(companyId: string, propertyId: string, photoId: string) {
    const photo = await this.find(companyId, propertyId, photoId);
    this.photos = this.photos.filter((p) => p.id !== photoId);
    if (photo?.isCover) {
      const [next] = await this.list(companyId, propertyId);
      if (next) next.isCover = true;
    }
  }
}

export class FakeStorage implements PhotoStorage {
  files = new Map<string, { head: Uint8Array; sizeBytes: number }>();
  removed: string[] = [];

  async createUpload(path: string): Promise<SignedUpload> {
    return { path, token: 't', signedUrl: `https://storage/${path}?token=t` };
  }

  async readHead(path: string) {
    return this.files.get(path) ?? null;
  }

  async signedUrls(paths: string[]) {
    return new Map<string, PhotoUrls>(paths.map((p) => [p, { url: `https://signed/${p}`, thumbnailUrl: `https://thumb/${p}` }]));
  }

  async remove(path: string) {
    this.removed.push(path);
    this.files.delete(path);
  }
}
