import { randomUUID } from 'node:crypto';
import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { requireActiveCompany } from '../../auth/permissions.js';
import {
  MAX_PHOTOS_PER_PROPERTY,
  MAX_PHOTO_BYTES,
  PHOTO_MIME_TYPES,
  detectPhotoMime,
  photoWarnings,
  sortPhotos,
  type PhotoWarning,
  type PropertyPhoto,
} from '../domain/property-photo.js';
import type { PhotoStorage, PropertyPhotoRepository, SignedUpload } from '../domain/property-photo-ports.js';
import { propertyPolicy } from '../domain/property-policy.js';
import type { Property } from '../domain/property.js';
import type { PropertyRepository } from '../domain/property-repository.js';
import { PropertyNotFound, PropertyValidationError } from './property.service.js';

const SIGNED_URL_SECONDS = 10 * 60;

export class PhotoNotFound extends Error {
  constructor() {
    super('Foto não encontrada');
    this.name = 'PhotoNotFound';
  }
}

export type PhotoView = Pick<
  PropertyPhoto,
  'id' | 'originalName' | 'mimeType' | 'sizeBytes' | 'width' | 'height' | 'isCover' | 'position' | 'createdAt'
> & {
  url: string;
  thumbnailUrl: string;
  warnings: PhotoWarning[];
};

const MB = 1024 * 1024;

/**
 * Fotos do imóvel (seção 11). O arquivo vai do navegador direto para o
 * Storage por URL assinada; o bot confere o conteúdo antes de registrar.
 */
export class PropertyPhotoService {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly photos: PropertyPhotoRepository,
    private readonly storage: PhotoStorage,
    private readonly logger: Logger,
  ) {}

  async list(context: AuthContext, propertyId: string): Promise<{ items: PhotoView[]; canManage: boolean }> {
    const property = await this.load(context, propertyId);
    propertyPolicy.assert(context, 'view', property);

    const photos = sortPhotos(await this.photos.list(property.companyId, property.id));

    return {
      items: await this.toViews(photos),
      canManage: propertyPolicy.can(context, 'edit', property),
    };
  }

  /** Passo 1: confere tipo, tamanho e limite antes de liberar o envio. */
  async prepareUpload(
    context: AuthContext,
    propertyId: string,
    input: { fileName?: unknown; contentType?: unknown; sizeBytes?: unknown },
  ): Promise<SignedUpload> {
    const property = await this.load(context, propertyId);
    propertyPolicy.assert(context, 'edit', property);

    const fileName = typeof input.fileName === 'string' ? input.fileName : 'foto';
    const contentType = typeof input.contentType === 'string' ? input.contentType : '';
    const sizeBytes = typeof input.sizeBytes === 'number' ? input.sizeBytes : NaN;

    if (!PHOTO_MIME_TYPES.includes(contentType as (typeof PHOTO_MIME_TYPES)[number])) {
      throw invalidFile(fileName, 'Formato não aceito. Use foto JPG ou PNG');
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PHOTO_BYTES) {
      throw invalidFile(fileName, `A foto passa do tamanho máximo de ${MAX_PHOTO_BYTES / MB} MB`);
    }

    await this.assertBelowLimit(property);

    const extension = contentType === 'image/png' ? 'png' : 'jpg';

    return this.storage.createUpload(`${property.companyId}/${property.id}/${randomUUID()}.${extension}`);
  }

  /** Passo 2: o arquivo já está no Storage; confere o conteúdo e registra. */
  async confirmUpload(
    context: AuthContext,
    propertyId: string,
    input: { path?: unknown; originalName?: unknown; width?: unknown; height?: unknown },
  ): Promise<PhotoView> {
    const property = await this.load(context, propertyId);
    propertyPolicy.assert(context, 'edit', property);

    const path = typeof input.path === 'string' ? input.path : '';
    const originalName = (typeof input.originalName === 'string' && input.originalName.trim()) || 'foto';

    // O caminho só vale dentro da pasta deste imóvel: ninguém registra arquivo de outro.
    if (!path.startsWith(`${property.companyId}/${property.id}/`) || path.includes('..')) {
      throw invalidFile(originalName, 'Envio de foto inválido. Tente de novo');
    }

    const file = await this.storage.readHead(path, 16);

    if (!file) throw invalidFile(originalName, 'A foto não chegou. Tente enviar de novo');

    const mimeType = detectPhotoMime(file.head);
    const rejectReason = !mimeType
      ? 'Formato não aceito. Use foto JPG ou PNG'
      : file.sizeBytes > MAX_PHOTO_BYTES
        ? `A foto passa do tamanho máximo de ${MAX_PHOTO_BYTES / MB} MB`
        : null;

    if (rejectReason || !mimeType) {
      await this.discard(path);
      throw invalidFile(originalName, rejectReason ?? 'Formato não aceito. Use foto JPG ou PNG');
    }

    try {
      await this.assertBelowLimit(property);
    } catch (error) {
      await this.discard(path);
      throw error;
    }

    const photo = await this.photos.add({
      companyId: property.companyId,
      propertyId: property.id,
      storagePath: path,
      originalName: originalName.slice(0, 200),
      mimeType,
      sizeBytes: file.sizeBytes,
      width: positiveInt(input.width),
      height: positiveInt(input.height),
      createdBy: context.userId,
    });

    await this.properties.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'photo_added',
      actorId: context.userId,
      data: { photoId: photo.id, name: photo.originalName },
    });

    const [view] = await this.toViews([photo]);

    return view;
  }

  async setCover(context: AuthContext, propertyId: string, photoId: string): Promise<void> {
    const property = await this.load(context, propertyId);
    propertyPolicy.assert(context, 'edit', property);

    const photo = await this.photos.find(property.companyId, property.id, photoId);

    if (!photo) throw new PhotoNotFound();
    if (photo.isCover) return;

    await this.photos.setCover(property.companyId, property.id, photo.id);
    await this.properties.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'cover_changed',
      actorId: context.userId,
      data: { photoId: photo.id, name: photo.originalName },
    });
  }

  async remove(context: AuthContext, propertyId: string, photoId: string): Promise<void> {
    const property = await this.load(context, propertyId);
    propertyPolicy.assert(context, 'edit', property);

    const photo = await this.photos.find(property.companyId, property.id, photoId);

    if (!photo) throw new PhotoNotFound();

    await this.photos.remove(property.companyId, property.id, photo.id);
    await this.discard(photo.storagePath);
    await this.properties.addEvent({
      companyId: property.companyId,
      propertyId: property.id,
      kind: 'photo_removed',
      actorId: context.userId,
      data: { photoId: photo.id, name: photo.originalName },
    });
  }

  private async load(context: AuthContext, propertyId: string): Promise<Property> {
    const companyId = requireActiveCompany(context);
    const property = await this.properties.findById(companyId, propertyId);

    if (!property) throw new PropertyNotFound();

    return property;
  }

  private async assertBelowLimit(property: Property) {
    const count = (await this.photos.list(property.companyId, property.id)).length;

    if (count >= MAX_PHOTOS_PER_PROPERTY) {
      throw new PropertyValidationError({
        photos: `Este imóvel já tem o máximo de ${MAX_PHOTOS_PER_PROPERTY} fotos. Remova uma para incluir outra`,
      });
    }
  }

  /** Arquivo órfão no Storage não pode derrubar a operação do usuário. */
  private async discard(path: string) {
    await this.storage.remove(path).catch((error: unknown) =>
      this.logger.warn('Arquivo de foto não removido do Storage', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private async toViews(photos: PropertyPhoto[]): Promise<PhotoView[]> {
    const urls = await this.storage.signedUrls(
      photos.map((photo) => photo.storagePath),
      SIGNED_URL_SECONDS,
    );

    return photos.map((photo) => ({
      id: photo.id,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      width: photo.width,
      height: photo.height,
      isCover: photo.isCover,
      position: photo.position,
      createdAt: photo.createdAt,
      url: urls.get(photo.storagePath)?.url ?? '',
      thumbnailUrl: urls.get(photo.storagePath)?.thumbnailUrl ?? '',
      warnings: photoWarnings(photo.width, photo.height),
    }));
  }
}

function invalidFile(fileName: string, message: string) {
  return new PropertyValidationError({ photos: `${fileName}: ${message}` });
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
