import { TYPOLOGY_LABELS, type TriState, type Typology } from '../domain/property-ad.js';
import { sortPhotos } from '../domain/property-photo.js';
import type { PhotoStorage, PropertyPhotoRepository } from '../domain/property-photo-ports.js';
import { PROPERTY_TYPE_LABELS, type PropertyStatus, type PropertyType } from '../domain/property.js';
import type { PropertyRepository } from '../domain/property-repository.js';

const PHOTO_URL_SECONDS = 60 * 60;

/**
 * O que o módulo de Anúncios pode ler de um imóvel (12.9). Lista fechada:
 * nunca vendedor, observações internas, avaliação nem matrícula (CA-12.11).
 * Preço só com "exibir preço"; endereço completo só com "exibir endereço".
 */
export type PropertyForAd = {
  id: string;
  referenceCode: string;
  type: PropertyType;
  typeLabel: string;
  typology: Typology | null;
  typologyLabel: string | null;
  title: string | null;
  headline: string | null;
  description: string | null;
  highlights: string[];
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  privateAreaM2: number | null;
  totalAreaM2: number | null;
  acceptsFinancing: TriState;
  acceptsFgts: TriState;
  acceptsMcmv: TriState;
  /** Nulo quando "exibir preço" está desmarcado. */
  salePrice: number | null;
  location: {
    neighborhood: string;
    municipality: string;
    state: string;
    /** Só com "exibir endereço completo"; senão o anúncio mostra bairro e município. */
    street: string | null;
    number: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  photos: { url: string; isCover: boolean }[];
  status: PropertyStatus;
  responsibleBroker: { id: string; name: string | null };
};

export type PropertyStatusChange = {
  propertyId: string;
  from: PropertyStatus;
  to: PropertyStatus;
  /** Nulo = mudança automática ("Sistema"). */
  actorId: string | null;
  changedAt: string;
};

/** Contrato de leitura do imóvel para o módulo de Anúncios (12.9 e 12.10). */
export class PropertyAdReader {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly photos: PropertyPhotoRepository,
    private readonly storage: PhotoStorage,
  ) {}

  async read(companyId: string, propertyId: string): Promise<PropertyForAd | null> {
    const property = await this.properties.findById(companyId, propertyId);

    if (!property) return null;

    const [photos, broker] = await Promise.all([
      this.photos.list(companyId, propertyId),
      this.properties.findBroker(companyId, property.responsibleBrokerId),
    ]);
    const ordered = sortPhotos(photos);
    const urls = await this.storage.signedUrls(
      ordered.map((photo) => photo.storagePath),
      PHOTO_URL_SECONDS,
    );
    const { ad, address } = property;

    return {
      id: property.id,
      referenceCode: property.referenceCode,
      type: property.type,
      typeLabel: PROPERTY_TYPE_LABELS[property.type],
      typology: ad.typology,
      typologyLabel: ad.typology ? TYPOLOGY_LABELS[ad.typology] : null,
      title: ad.title,
      headline: ad.headline,
      description: ad.description,
      highlights: ad.highlights,
      bedrooms: ad.bedrooms,
      suites: ad.suites,
      bathrooms: ad.bathrooms,
      parkingSpaces: ad.parkingSpaces,
      privateAreaM2: property.privateAreaM2,
      totalAreaM2: property.totalAreaM2,
      acceptsFinancing: ad.acceptsFinancing,
      acceptsFgts: ad.acceptsFgts,
      acceptsMcmv: ad.acceptsMcmv,
      salePrice: ad.showPrice ? property.salePrice : null,
      location: {
        neighborhood: address.neighborhood,
        municipality: address.municipality,
        state: address.state,
        street: ad.showFullAddress ? address.street : null,
        number: ad.showFullAddress ? address.number : null,
        postalCode: ad.showFullAddress ? address.postalCode : null,
        latitude: ad.showFullAddress ? ad.latitude : null,
        longitude: ad.showFullAddress ? ad.longitude : null,
      },
      photos: ordered.map((photo) => ({ url: urls.get(photo.storagePath)?.url ?? '', isCover: photo.isCover })),
      status: property.status,
      responsibleBroker: { id: property.responsibleBrokerId, name: broker?.fullName ?? null },
    };
  }

  /** Mudanças de situação do imóvel, para Anúncios reagir (4.4 e 12.10). */
  async statusChanges(companyId: string, propertyId: string): Promise<PropertyStatusChange[]> {
    const events = await this.properties.listEvents(companyId, propertyId);

    return events
      .filter((event) => event.kind === 'status_changed')
      .map((event) => ({
        propertyId,
        from: event.data.from as PropertyStatus,
        to: event.data.to as PropertyStatus,
        actorId: event.actorId,
        changedAt: event.createdAt,
      }));
  }
}
