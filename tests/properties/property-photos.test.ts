import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionDenied } from '../../src/app/modules/auth/permissions.js';
import { PhotoNotFound, PropertyPhotoService } from '../../src/app/modules/properties/application/property-photo.service.js';
import {
  PropertyNotFound,
  PropertyService,
  PropertyValidationError,
} from '../../src/app/modules/properties/application/property.service.js';
import { MAX_PHOTOS_PER_PROPERTY, type PropertyPhoto } from '../../src/app/modules/properties/domain/property-photo.js';
import type {
  NewPropertyPhoto,
  PhotoStorage,
  PhotoUrls,
  PropertyPhotoRepository,
  SignedUpload,
} from '../../src/app/modules/properties/domain/property-photo-ports.js';
import { context, memoryLogger } from '../auth/helpers.js';
import {
  BROKER_A,
  BROKER_B,
  BROKER_C,
  COMPANY_A,
  COMPANY_B,
  FakeMunicipalityDirectory,
  InMemoryPropertyRepository,
  validInput,
} from './fakes.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0]);

class InMemoryPhotoRepository implements PropertyPhotoRepository {
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

  async remove(companyId: string, propertyId: string, photoId: string) {
    const photo = await this.find(companyId, propertyId, photoId);
    this.photos = this.photos.filter((p) => p.id !== photoId);
    if (photo?.isCover) {
      const [next] = await this.list(companyId, propertyId);
      if (next) next.isCover = true;
    }
  }
}

class FakeStorage implements PhotoStorage {
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

const brokerA = context({ userId: BROKER_A, companyId: COMPANY_A });
const brokerC = context({ userId: BROKER_C, companyId: COMPANY_A });
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

let properties: InMemoryPropertyRepository;
let photos: InMemoryPhotoRepository;
let storage: FakeStorage;
let service: PropertyPhotoService;
let propertyId: string;

beforeEach(async () => {
  properties = new InMemoryPropertyRepository();
  photos = new InMemoryPhotoRepository();
  storage = new FakeStorage();
  const logger = memoryLogger().logger;
  service = new PropertyPhotoService(properties, photos, storage, logger);
  propertyId = (await new PropertyService(properties, new FakeMunicipalityDirectory(), logger).create(brokerA, validInput())).id;
});

/** Simula o navegador: prepara, "envia" o arquivo para o Storage e confirma. */
async function upload(name: string, head = JPEG, { width = 1080, height = 1080, sizeBytes = 2 * 1024 * 1024 } = {}) {
  const prepared = await service.prepareUpload(brokerA, propertyId, { fileName: name, contentType: 'image/jpeg', sizeBytes });
  storage.files.set(prepared.path, { head, sizeBytes });
  return service.confirmUpload(brokerA, propertyId, { path: prepared.path, originalName: name, width, height });
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('era para recusar');
    },
    (error: unknown) => error,
  );
}

describe('Seção 11 · fotos do imóvel', () => {
  it('CA-11.1 três fotos válidas: três linhas e a primeira é a capa', async () => {
    await upload('fachada.jpg');
    await upload('sala.jpg');
    await upload('cozinha.jpg');

    const { items } = await service.list(brokerA, propertyId);
    expect(items.map((p) => [p.originalName, p.isCover])).toEqual([
      ['fachada.jpg', true],
      ['sala.jpg', false],
      ['cozinha.jpg', false],
    ]);
    expect(properties.events.filter((e) => e.kind === 'photo_added')).toHaveLength(3);
  });

  it('CA-11.2 "Usar como capa" na segunda leva o selo para ela, e ela vem primeiro', async () => {
    await upload('fachada.jpg');
    const sala = await upload('sala.jpg');

    await service.setCover(brokerA, propertyId, sala.id);

    const { items } = await service.list(brokerA, propertyId);
    expect(items[0]).toMatchObject({ originalName: 'sala.jpg', isCover: true });
    expect(items.filter((p) => p.isCover)).toHaveLength(1);
  });

  it('CA-11.3 removida a capa, a próxima foto vira capa e o arquivo sai do Storage', async () => {
    const fachada = await upload('fachada.jpg');
    await upload('sala.jpg');

    await service.remove(brokerA, propertyId, fachada.id);

    const { items } = await service.list(brokerA, propertyId);
    expect(items).toEqual([expect.objectContaining({ originalName: 'sala.jpg', isCover: true })]);
    expect(storage.removed).toHaveLength(1);
    expect(properties.events.some((e) => e.kind === 'photo_removed')).toBe(true);
  });

  it('CA-11.4 foto com 480 px entra, com aviso de resolução baixa', async () => {
    const photo = await upload('cozinha.jpg', JPEG, { width: 480, height: 480 });

    expect(photo.warnings).toContain('low_resolution');
  });

  it('11.5 proporção fora de 1:1 ou 4:5 entra com aviso de corte, sem bloquear', async () => {
    await expect(upload('paisagem.jpg', JPEG, { width: 1920, height: 1080 })).resolves.toMatchObject({
      warnings: ['may_be_cropped'],
    });
    await expect(upload('retrato.jpg', JPEG, { width: 1080, height: 1350 })).resolves.toMatchObject({ warnings: [] });
  });

  it('CA-11.5 PDF é recusado com motivo (pelo tipo declarado e pelo conteúdo) e não sobra arquivo', async () => {
    const declared = await rejection(
      service.prepareUpload(brokerA, propertyId, { fileName: 'doc.pdf', contentType: 'application/pdf', sizeBytes: 1000 }),
    );
    expect((declared as PropertyValidationError).fields.photos).toBe('doc.pdf: Formato não aceito. Use foto JPG ou PNG');

    const disguised = await rejection(upload('falso.jpg', PDF));
    expect((disguised as PropertyValidationError).fields.photos).toMatch(/Formato não aceito/);
    expect(storage.removed).toHaveLength(1);
    expect(photos.photos).toHaveLength(0);
  });

  it('CA-11.6 foto de 35 MB é recusada com o tamanho máximo', async () => {
    const error = await rejection(
      service.prepareUpload(brokerA, propertyId, { fileName: 'grande.jpg', contentType: 'image/jpeg', sizeBytes: 35 * 1024 * 1024 }),
    );

    expect((error as PropertyValidationError).fields.photos).toBe('grande.jpg: A foto passa do tamanho máximo de 30 MB');
  });

  it('CA-11.7 limite atingido: avisa e a foto não entra', async () => {
    for (let i = 0; i < MAX_PHOTOS_PER_PROPERTY; i += 1) await upload(`f${i}.jpg`);

    const error = await rejection(upload('mais-uma.jpg'));

    expect((error as PropertyValidationError).fields.photos).toMatch(/já tem o máximo de/);
    expect(photos.photos).toHaveLength(MAX_PHOTOS_PER_PROPERTY);
  });

  it('CA-11.11 empresa B não lista nem mexe nas fotos da empresa A; caminho de outra pasta é recusado', async () => {
    const fachada = await upload('fachada.jpg');

    await expect(service.list(brokerB, propertyId)).rejects.toBeInstanceOf(PropertyNotFound);
    await expect(service.remove(brokerB, propertyId, fachada.id)).rejects.toBeInstanceOf(PropertyNotFound);

    const forged = await rejection(
      service.confirmUpload(brokerA, propertyId, { path: `${COMPANY_B}/outro-imovel/x.jpg`, originalName: 'x.jpg' }),
    );
    expect((forged as PropertyValidationError).fields.photos).toMatch(/Envio de foto inválido/);
  });

  it('CA-11.12 outro corretor vê as fotos sem poder incluir, remover ou trocar a capa', async () => {
    const fachada = await upload('fachada.jpg');

    const seenByC = await service.list(brokerC, propertyId);
    expect(seenByC.items).toHaveLength(1);
    expect(seenByC.canManage).toBe(false);

    await expect(
      service.prepareUpload(brokerC, propertyId, { fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(service.setCover(brokerC, propertyId, fachada.id)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(service.remove(brokerC, propertyId, fachada.id)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('foto inexistente → "Foto não encontrada"', async () => {
    await expect(service.setCover(brokerA, propertyId, randomUUID())).rejects.toBeInstanceOf(PhotoNotFound);
  });
});
