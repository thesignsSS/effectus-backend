import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionDenied } from '../../src/app/modules/auth/permissions.js';
import { PropertyAdReader } from '../../src/app/modules/properties/application/property-ad-reader.js';
import {
  PropertyNotFound,
  PropertyService,
  PropertyValidationError,
} from '../../src/app/modules/properties/application/property.service.js';
import type { Geocoder } from '../../src/app/modules/properties/domain/geocoder.js';
import { context, memoryLogger } from '../auth/helpers.js';
import {
  ADMIN_A,
  BROKER_A,
  BROKER_B,
  BROKER_C,
  COMPANY_A,
  COMPANY_B,
  FakeMunicipalityDirectory,
  FakeStorage,
  InMemoryPhotoRepository,
  InMemoryPropertyRepository,
  validInput,
} from './fakes.js';

const brokerA = context({ userId: BROKER_A, companyId: COMPANY_A });
const brokerC = context({ userId: BROKER_C, companyId: COMPANY_A });
const adminA = context({ userId: ADMIN_A, companyId: COMPANY_A, isAdmin: true });
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

const FULL_AD = {
  typology: 'apartamento',
  title: 'Apartamento com vista para o mar',
  headline: 'Três quartos, varanda gourmet e lazer completo no Meireles.',
  description: 'Andar alto, nascente.',
  highlights: ['Varanda gourmet', 'Vista mar'],
  bedrooms: 3,
  suites: 1,
  bathrooms: 2,
  parkingSpaces: 2,
  acceptsFinancing: 'sim',
};

let repository: InMemoryPropertyRepository;
let photos: InMemoryPhotoRepository;
let geocoder: Geocoder;
let service: PropertyService;

function build() {
  service = new PropertyService(repository, new FakeMunicipalityDirectory(), memoryLogger().logger, photos, geocoder);
}

beforeEach(() => {
  repository = new InMemoryPropertyRepository();
  photos = new InMemoryPhotoRepository();
  geocoder = { locate: async () => ({ latitude: -3.72, longitude: -38.49 }) };
  build();
});

async function addCover(propertyId: string) {
  await photos.add({
    companyId: COMPANY_A,
    propertyId,
    storagePath: `${COMPANY_A}/${propertyId}/capa.jpg`,
    originalName: 'capa.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    width: 1080,
    height: 1080,
    createdBy: BROKER_A,
  });
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('era para recusar');
    },
    (error: unknown) => error,
  );
}

describe('Seção 12 · dados do anúncio e "pronto para anunciar"', () => {
  it('CA-12.1 sem dados de anúncio: mostra só o que falta e salva vazio', async () => {
    const property = await service.create(brokerA, validInput());

    const saved = await service.saveAd(brokerA, property.id, {});

    expect(saved.property.adReadinessLabel).toBe('Faltam: tipologia, título, chamada, foto');
  });

  it('CA-12.2 título acima de 40 e chamada acima de 125 caracteres são recusados', async () => {
    const property = await service.create(brokerA, validInput());

    const error = await rejection(
      service.saveAd(brokerA, property.id, { title: 'x'.repeat(41), headline: 'y'.repeat(126) }),
    );

    expect((error as PropertyValidationError).fields).toEqual({
      title: 'Use no máximo 40 caracteres no título',
      headline: 'Use no máximo 125 caracteres na chamada',
    });
  });

  it('CA-12.3 Disponível com tipologia, título, chamada, município/UF e 1 foto: pronto para anunciar', async () => {
    const property = await service.create(brokerA, validInput());
    await addCover(property.id);

    const saved = await service.saveAd(brokerA, property.id, FULL_AD);

    expect(saved.property.adReadinessLabel).toBe('Pronto para anunciar');
  });

  it('CA-12.4 pronto que vira Vendido: deixa de estar pronto e os dados continuam salvos', async () => {
    const property = await service.create(brokerA, validInput());
    await addCover(property.id);
    await service.saveAd(brokerA, property.id, FULL_AD);

    const sold = await service.changeStatus(adminA, property.id, 'vendido');

    expect(sold.adReadiness).toEqual({ kind: 'not_advertisable' });
    expect(sold.ad.title).toBe(FULL_AD.title);
  });

  it('CA-12.5 Reservado com tudo preenchido continua pronto', async () => {
    const property = await service.create(brokerA, validInput());
    await addCover(property.id);
    await service.saveAd(brokerA, property.id, FULL_AD);

    expect((await service.changeStatus(brokerA, property.id, 'reservado')).adReadinessLabel).toBe('Pronto para anunciar');
  });

  it('CA-12.6 imóvel novo: exibir preço marcado e exibir endereço desmarcado', async () => {
    const property = await service.create(brokerA, validInput());

    expect(property.ad).toMatchObject({ showPrice: true, showFullAddress: false, acceptsFgts: 'nao_informado' });
  });

  it('CA-12.7 endereço que não pôde ser localizado: salva normalmente e o indicador não muda', async () => {
    geocoder = {
      locate: async () => {
        throw new Error('serviço fora do ar');
      },
    };
    build();

    const property = await service.create(brokerA, validInput());

    expect(property.ad.latitude).toBeNull();
    expect(property.adReadinessLabel).toBe('Faltam: tipologia, título, chamada, foto');
  });

  it('12.6 mudar o endereço refaz a localização', async () => {
    const property = await service.create(brokerA, validInput());
    geocoder = { locate: async () => ({ latitude: -3.75, longitude: -38.52 }) };
    build();

    const moved = await service.update(
      brokerA,
      property.id,
      validInput({ address: { ...validInput().address, neighborhood: 'Aldeota' } }),
    );

    expect(moved.ad.latitude).toBe(-3.75);
  });

  it('CA-12.8 descrição com telefone: avisa e salva', async () => {
    const property = await service.create(brokerA, validInput());

    const saved = await service.saveAd(brokerA, property.id, { description: 'Ligue (85) 99999-0001' });

    expect(saved.warnings).toEqual([expect.stringMatching(/descrição pública parece ter telefone ou e-mail/)]);
    expect(saved.property.ad.description).toBe('Ligue (85) 99999-0001');
  });

  it('CA-12.9 outro corretor não edita o anúncio; ADM edita qualquer imóvel da empresa', async () => {
    const property = await service.create(brokerA, validInput());

    await expect(service.saveAd(brokerC, property.id, FULL_AD)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(service.saveAd(adminA, property.id, FULL_AD)).resolves.toBeTruthy();
  });

  it('CA-12.10 outra empresa não lê nem edita e não descobre se o imóvel existe', async () => {
    const property = await service.create(brokerA, validInput());

    await expect(service.saveAd(brokerB, property.id, FULL_AD)).rejects.toBeInstanceOf(PropertyNotFound);
  });

  it('CA-12.11 contrato de leitura nunca devolve vendedor, observações, avaliação ou matrícula', async () => {
    const property = await service.create(
      brokerA,
      validInput({
        internalNotes: 'Vendedor aceita negociar',
        registrationNumber: 'MAT-123',
        hasAppraisal: true,
        appraisalValue: 800000,
        appraisalValidUntil: '2027-01-01',
      }),
    );
    await addCover(property.id);
    await service.saveAd(brokerA, property.id, FULL_AD);

    const reader = new PropertyAdReader(repository, photos, new FakeStorage());
    const forAd = await reader.read(COMPANY_A, property.id);
    const serialized = JSON.stringify(forAd);

    expect(serialized).not.toMatch(/Vendedor aceita|MAT-123|800000|internalNotes|appraisal|registration|seller/);
    expect(forAd).toMatchObject({ title: FULL_AD.title, salePrice: 890000, typologyLabel: 'Apartamento' });
    // Endereço completo desmarcado: só bairro e município, sem ponto exato no mapa.
    expect(forAd?.location).toMatchObject({ neighborhood: 'Meireles', street: null, latitude: null });
    expect(await reader.read(COMPANY_B, property.id)).toBeNull();
  });

  it('12.2 "exibir preço" desmarcado: o contrato não devolve o valor', async () => {
    const property = await service.create(brokerA, validInput());
    await service.saveAd(brokerA, property.id, { ...FULL_AD, showPrice: false, showFullAddress: true });

    const forAd = await new PropertyAdReader(repository, photos, new FakeStorage()).read(COMPANY_A, property.id);

    expect(forAd?.salePrice).toBeNull();
    expect(forAd?.location.street).toBe('Rua Silva Jatahy');
  });

  it('12.10 mudanças de situação ficam legíveis para Anúncios', async () => {
    const property = await service.create(brokerA, validInput());
    await service.changeStatus(brokerA, property.id, 'reservado');

    const changes = await new PropertyAdReader(repository, photos, new FakeStorage()).statusChanges(COMPANY_A, property.id);

    expect(changes).toEqual([expect.objectContaining({ from: 'disponivel', to: 'reservado', actorId: BROKER_A })]);
  });
});
