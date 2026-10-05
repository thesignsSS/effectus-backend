import type { AuthContext } from '../../auth/auth-context.js';
import { requireActiveCompany } from '../../auth/permissions.js';
import { adReadinessLabel, computeAdReadiness, type AdReadiness } from '../domain/ad-readiness.js';
import { normalizeName } from '../domain/municipality-directory.js';
import {
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  type Property,
  type PropertyStatus,
} from '../domain/property.js';
import type { PhotoStorage, PropertyPhotoRepository } from '../domain/property-photo-ports.js';
import type { PropertyRepository } from '../domain/property-repository.js';

export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const THUMBNAIL_SECONDS = 10 * 60;

export type PropertyListParams = {
  search?: string | null;
  statuses?: string[];
  types?: string[];
  responsibleBrokerId?: string | null;
  page?: number;
  pageSize?: number;
};

/** Linha da lista (9.2). Nunca leva dado de vendedor (CA-9.6). */
export type PropertyListItem = {
  id: string;
  referenceCode: string;
  street: string;
  number: string | null;
  neighborhood: string;
  municipality: string;
  state: string;
  type: Property['type'];
  typeLabel: string;
  salePrice: number;
  status: PropertyStatus;
  statusLabel: string;
  responsibleBroker: { id: string; name: string | null };
  coverThumbnailUrl: string | null;
  adReadiness: AdReadiness;
  adReadinessLabel: string;
  updatedAt: string;
};

export class PropertyListService {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly photos: PropertyPhotoRepository,
    private readonly storage: PhotoStorage,
  ) {}

  /**
   * Seção 9: todos os imóveis da empresa, inclusive de colegas. Inativos só
   * aparecem quando o filtro de situação os pede. Busca num campo só, sem
   * diferenciar maiúsculas, minúsculas e acentos.
   */
  async list(
    context: AuthContext,
    params: PropertyListParams,
  ): Promise<{ items: PropertyListItem[]; total: number; page: number; pageSize: number }> {
    const companyId = requireActiveCompany(context);
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)));
    const search = params.search ? normalizeName(params.search) : '';

    const { items, total } = await this.properties.list(companyId, {
      search: search || null,
      statuses: (params.statuses ?? []).filter((s): s is PropertyStatus => PROPERTY_STATUSES.includes(s as PropertyStatus)),
      types: (params.types ?? []).filter((t) => PROPERTY_TYPES.includes(t as Property['type'])),
      responsibleBrokerId: params.responsibleBrokerId || null,
      page,
      pageSize,
    });

    return { page, pageSize, total, items: await this.toItems(companyId, items) };
  }

  /** Mesma linha da lista, para quem mostra imóveis fora dela (seletor e bloco da proposta). */
  async toItems(companyId: string, items: Property[]): Promise<PropertyListItem[]> {
    const ids = items.map((item) => item.id);
    const [summaries, brokers] = await Promise.all([
      this.photos.summaries(companyId, ids),
      this.properties.listBrokers(companyId),
    ]);
    const coverPaths = [...summaries.values()].map((s) => s.coverPath).filter((p): p is string => Boolean(p));
    const urls = await this.storage.signedUrls(coverPaths, THUMBNAIL_SECONDS);
    const brokerNames = new Map(brokers.map((b) => [b.id, b.fullName]));

    return items.map((property) => {
      const summary = summaries.get(property.id) ?? { count: 0, coverPath: null };
      const readiness = computeAdReadiness({
        status: property.status,
        typology: property.ad.typology,
        title: property.ad.title,
        headline: property.ad.headline,
        municipality: property.address.municipality,
        state: property.address.state,
        photoCount: summary.count,
        hasCover: Boolean(summary.coverPath),
      });

      return {
        id: property.id,
        referenceCode: property.referenceCode,
        street: property.address.street,
        number: property.address.number,
        neighborhood: property.address.neighborhood,
        municipality: property.address.municipality,
        state: property.address.state,
        type: property.type,
        typeLabel: PROPERTY_TYPE_LABELS[property.type],
        salePrice: property.salePrice,
        status: property.status,
        statusLabel: PROPERTY_STATUS_LABELS[property.status],
        responsibleBroker: { id: property.responsibleBrokerId, name: brokerNames.get(property.responsibleBrokerId) ?? null },
        coverThumbnailUrl: summary.coverPath ? (urls.get(summary.coverPath)?.thumbnailUrl ?? null) : null,
        adReadiness: readiness,
        adReadinessLabel: adReadinessLabel(readiness),
        updatedAt: property.updatedAt,
      };
    });
  }
}
