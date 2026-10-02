import type { PhotoMimeType, PropertyPhoto } from './property-photo.js';

export type NewPropertyPhoto = Omit<PropertyPhoto, 'id' | 'createdAt' | 'isCover' | 'position'>;

/** Fotos sempre filtradas por empresa e imóvel. */
export interface PropertyPhotoRepository {
  list(companyId: string, propertyId: string): Promise<PropertyPhoto[]>;
  find(companyId: string, propertyId: string, photoId: string): Promise<PropertyPhoto | null>;
  /** Grava como capa se o imóvel ainda não tem nenhuma (11.3) e na próxima posição. */
  add(photo: NewPropertyPhoto): Promise<PropertyPhoto>;
  setCover(companyId: string, propertyId: string, photoId: string): Promise<void>;
  /** Remove e, se era a capa, passa a capa para a próxima na ordem (11.3). */
  remove(companyId: string, propertyId: string, photoId: string): Promise<void>;
  /** Quantidade de fotos e caminho da capa de cada imóvel, para lista e indicador. */
  summaries(companyId: string, propertyIds: string[]): Promise<Map<string, PhotoSummary>>;
}

export type PhotoSummary = { count: number; coverPath: string | null };

export type SignedUpload = { path: string; token: string; signedUrl: string };

export type PhotoUrls = { url: string; thumbnailUrl: string };

/** Storage privado das fotos; todo acesso é por URL assinada de vida curta. */
export interface PhotoStorage {
  createUpload(path: string): Promise<SignedUpload>;
  /** Primeiros bytes do arquivo enviado, para conferir o tipo pelo conteúdo; nulo se não existe. */
  readHead(path: string, bytes: number): Promise<{ head: Uint8Array; sizeBytes: number } | null>;
  signedUrls(paths: string[], expiresInSeconds: number): Promise<Map<string, PhotoUrls>>;
  remove(path: string): Promise<void>;
}

export type { PhotoMimeType };
