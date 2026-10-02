/**
 * Regras das fotos do imóvel (seção 11). Os valores [PROVISÓRIO] ficam todos
 * aqui (seção 16): trocar um número não exige mexer em mais nada.
 */

/** [PROVISÓRIO] Valor a definir pelo negócio. */
export const MAX_PHOTOS_PER_PROPERTY = 30;
/** [PROVISÓRIO] 30 MB; o bucket tem o mesmo limite (migration da seção 11). */
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
/** Abaixo disso a foto entra, mas com aviso de resolução (11.5). */
export const MIN_RECOMMENDED_WIDTH = 600;
/** Proporções que não cortam no anúncio: 1:1 (1080×1080) e 4:5 (1080×1350). */
export const RECOMMENDED_ASPECT_RATIOS = [1, 4 / 5] as const;

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

export type PropertyPhoto = {
  id: string;
  companyId: string;
  propertyId: string;
  storagePath: string;
  originalName: string;
  mimeType: PhotoMimeType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  isCover: boolean;
  position: number;
  createdBy: string | null;
  createdAt: string;
};

export type PhotoWarning = 'low_resolution' | 'may_be_cropped';

/** Avisos que nunca bloqueiam o envio (11.5). */
export function photoWarnings(width: number | null, height: number | null): PhotoWarning[] {
  if (!width || !height) return [];

  const warnings: PhotoWarning[] = [];

  if (width < MIN_RECOMMENDED_WIDTH) warnings.push('low_resolution');

  const ratio = width / height;
  const fits = RECOMMENDED_ASPECT_RATIOS.some((ideal) => Math.abs(ratio - ideal) / ideal <= 0.05);

  if (!fits) warnings.push('may_be_cropped');

  return warnings;
}

/** Confere o tipo pelo conteúdo, não pela extensão nem pelo Content-Type declarado. */
export function detectPhotoMime(head: Uint8Array): PhotoMimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (head.length >= png.length && png.every((byte, index) => head[index] === byte)) return 'image/png';

  return null;
}

/** Capa primeiro, depois a ordem de inclusão (11.4). */
export function sortPhotos<T extends Pick<PropertyPhoto, 'isCover' | 'position'>>(photos: T[]): T[] {
  return [...photos].sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position);
}
