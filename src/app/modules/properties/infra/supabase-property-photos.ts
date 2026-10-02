import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoMimeType, PropertyPhoto } from '../domain/property-photo.js';
import type {
  NewPropertyPhoto,
  PhotoSummary,
  PhotoStorage,
  PhotoUrls,
  PropertyPhotoRepository,
  SignedUpload,
} from '../domain/property-photo-ports.js';

export const PROPERTY_PHOTOS_BUCKET = 'property-photos';
const THUMBNAIL_WIDTH = 160;

type PhotoRow = {
  id: string;
  company_id: string;
  property_id: string;
  storage_path: string;
  original_name: string;
  mime_type: PhotoMimeType;
  size_bytes: number;
  width: number | null;
  height: number | null;
  is_cover: boolean;
  position: number;
  created_by: string | null;
  created_at: string;
};

export class SupabasePropertyPhotoRepository implements PropertyPhotoRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(companyId: string, propertyId: string): Promise<PropertyPhoto[]> {
    const { data, error } = await this.client
      .from('property_photos')
      .select('*')
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .order('position', { ascending: true });

    if (error) throw new Error(`Falha ao listar fotos: ${error.message}`);

    return (data as PhotoRow[]).map(toPhoto);
  }

  async find(companyId: string, propertyId: string, photoId: string): Promise<PropertyPhoto | null> {
    if (!isUuid(photoId)) return null;

    const { data, error } = await this.client
      .from('property_photos')
      .select('*')
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .eq('id', photoId)
      .maybeSingle<PhotoRow>();

    if (error) throw new Error(`Falha ao carregar foto: ${error.message}`);

    return data ? toPhoto(data) : null;
  }

  async add(photo: NewPropertyPhoto): Promise<PropertyPhoto> {
    const existing = await this.list(photo.companyId, photo.propertyId);
    const position = existing.reduce((max, item) => Math.max(max, item.position), 0) + 1;

    const { data, error } = await this.client
      .from('property_photos')
      .insert({
        company_id: photo.companyId,
        property_id: photo.propertyId,
        storage_path: photo.storagePath,
        original_name: photo.originalName,
        mime_type: photo.mimeType,
        size_bytes: photo.sizeBytes,
        width: photo.width,
        height: photo.height,
        is_cover: !existing.some((item) => item.isCover),
        position,
        created_by: photo.createdBy,
      })
      .select('*')
      .single<PhotoRow>();

    if (error) throw new Error(`Falha ao salvar foto: ${error.message}`);

    return toPhoto(data);
  }

  async setCover(companyId: string, propertyId: string, photoId: string): Promise<void> {
    // Tira a capa atual antes de marcar a nova: o índice único só aceita uma.
    const clear = await this.client
      .from('property_photos')
      .update({ is_cover: false })
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .eq('is_cover', true);

    if (clear.error) throw new Error(`Falha ao trocar capa: ${clear.error.message}`);

    const set = await this.client
      .from('property_photos')
      .update({ is_cover: true })
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .eq('id', photoId);

    if (set.error) throw new Error(`Falha ao trocar capa: ${set.error.message}`);
  }

  async remove(companyId: string, propertyId: string, photoId: string): Promise<void> {
    const photo = await this.find(companyId, propertyId, photoId);

    if (!photo) return;

    const { error } = await this.client
      .from('property_photos')
      .delete()
      .eq('company_id', companyId)
      .eq('property_id', propertyId)
      .eq('id', photoId);

    if (error) throw new Error(`Falha ao remover foto: ${error.message}`);

    if (photo.isCover) {
      const [next] = await this.list(companyId, propertyId);

      if (next) await this.setCover(companyId, propertyId, next.id);
    }
  }

  async summaries(companyId: string, propertyIds: string[]): Promise<Map<string, PhotoSummary>> {
    const result = new Map<string, PhotoSummary>();

    if (propertyIds.length === 0) return result;

    const { data, error } = await this.client
      .from('property_photos')
      .select('property_id, storage_path, is_cover')
      .eq('company_id', companyId)
      .in('property_id', propertyIds);

    if (error) throw new Error(`Falha ao resumir fotos: ${error.message}`);

    for (const row of data ?? []) {
      const current = result.get(row.property_id as string) ?? { count: 0, coverPath: null };
      current.count += 1;
      if (row.is_cover) current.coverPath = row.storage_path as string;
      result.set(row.property_id as string, current);
    }

    return result;
  }
}

export class SupabasePhotoStorage implements PhotoStorage {
  constructor(private readonly client: SupabaseClient) {}

  private get bucket() {
    return this.client.storage.from(PROPERTY_PHOTOS_BUCKET);
  }

  async createUpload(path: string): Promise<SignedUpload> {
    const { data, error } = await this.bucket.createSignedUploadUrl(path);

    if (error || !data) throw new Error(`Falha ao preparar envio da foto: ${error?.message}`);

    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }

  async readHead(path: string, bytes: number): Promise<{ head: Uint8Array; sizeBytes: number } | null> {
    const { data, error } = await this.bucket.createSignedUrl(path, 60);

    if (error || !data) return null;

    const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${bytes - 1}` } });

    if (!response.ok) return null;

    const head = new Uint8Array(await response.arrayBuffer()).slice(0, bytes);
    const range = response.headers.get('content-range');
    const total = range ? Number(range.split('/')[1]) : Number(response.headers.get('content-length'));

    return { head, sizeBytes: Number.isFinite(total) ? total : head.length };
  }

  async signedUrls(paths: string[], expiresInSeconds: number): Promise<Map<string, PhotoUrls>> {
    const result = new Map<string, PhotoUrls>();

    if (paths.length === 0) return result;

    const { data, error } = await this.bucket.createSignedUrls(paths, expiresInSeconds);

    if (error || !data) throw new Error(`Falha ao gerar links das fotos: ${error?.message}`);

    await Promise.all(
      data.map(async (item) => {
        if (!item.path || !item.signedUrl) return;

        // [PROVISÓRIO] Versão reduzida pela transformação de imagem do Storage
        // (11.14); se o ambiente não tiver, a miniatura usa o original.
        const thumb = await this.bucket
          .createSignedUrl(item.path, expiresInSeconds, { transform: { width: THUMBNAIL_WIDTH, resize: 'cover' } })
          .catch(() => null);

        result.set(item.path, {
          url: item.signedUrl,
          thumbnailUrl: thumb?.data?.signedUrl ?? item.signedUrl,
        });
      }),
    );

    return result;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.bucket.remove([path]);

    if (error) throw new Error(`Falha ao apagar arquivo da foto: ${error.message}`);
  }
}

function toPhoto(row: PhotoRow): PropertyPhoto {
  return {
    id: row.id,
    companyId: row.company_id,
    propertyId: row.property_id,
    storagePath: row.storage_path,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    isCover: row.is_cover,
    position: row.position,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
