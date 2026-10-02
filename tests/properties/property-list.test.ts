import { beforeEach, describe, expect, it } from 'vitest';
import { PropertyListService } from '../../src/app/modules/properties/application/property-list.service.js';
import { PropertyService } from '../../src/app/modules/properties/application/property.service.js';
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
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

let repository: InMemoryPropertyRepository;
let photos: InMemoryPhotoRepository;
let properties: PropertyService;
let service: PropertyListService;

beforeEach(() => {
  repository = new InMemoryPropertyRepository();
  photos = new InMemoryPhotoRepository();
  properties = new PropertyService(repository, new FakeMunicipalityDirectory(), memoryLogger().logger);
  service = new PropertyListService(repository, photos, new FakeStorage());
});

function withNeighborhood(neighborhood: string, extra = {}) {
  return validInput({ address: { ...validInput().address, neighborhood }, ...extra });
}

describe('Seção 9 · lista e busca de imóveis', () => {
  it('CA-9.1 sete imóveis com um Inativo: a lista mostra seis; filtrando Inativo, ele aparece', async () => {
    const created = [];
    for (let i = 0; i < 7; i += 1) created.push(await properties.create(brokerA, validInput()));
    await repository.update(COMPANY_A, created[3].id, { status: 'inativo', updatedBy: ADMIN_A });

    expect((await service.list(brokerA, {})).total).toBe(6);

    const onlyInactive = await service.list(brokerA, { statuses: ['inativo'] });
    expect(onlyInactive.items.map((p) => p.id)).toEqual([created[3].id]);
    expect(onlyInactive.items[0].statusLabel).toBe('Inativo');
  });

  it('CA-9.2 imóvel Vendido mostra "Fora do anúncio nesta situação", não "Faltam"', async () => {
    const property = await properties.create(brokerA, validInput());
    await repository.update(COMPANY_A, property.id, { status: 'vendido', updatedBy: ADMIN_A });

    const [item] = (await service.list(brokerA, {})).items;
    expect(item.adReadinessLabel).toBe('Fora do anúncio nesta situação');
  });

  it('CA-9.3 sem título, chamada e foto: a linha diz em texto o que falta', async () => {
    await properties.create(brokerA, validInput());

    const [item] = (await service.list(brokerA, {})).items;
    expect(item.adReadinessLabel).toBe('Faltam: tipologia, título, chamada, foto');
    expect(item.coverThumbnailUrl).toBeNull();
  });

  it('CA-9.4 busca por parte do código, e "meireles" sem acento acha Meireles', async () => {
    await properties.create(brokerA, validInput({ referenceCode: 'AP-0132' }));
    await properties.create(brokerA, withNeighborhood('Aldeota', { referenceCode: 'CS-0900' }));
    await properties.create(brokerA, withNeighborhood('Meireles', { referenceCode: 'TR-0001' }));

    expect((await service.list(brokerA, { search: 'p-01' })).items.map((p) => p.referenceCode)).toEqual(['AP-0132']);
    expect((await service.list(brokerA, { search: 'MEIRELES' })).items.map((p) => p.referenceCode).sort()).toEqual([
      'AP-0132',
      'TR-0001',
    ]);
  });

  it('busca ignora acento no que foi digitado ("são joão" acha "Sao Joao")', async () => {
    await properties.create(brokerA, withNeighborhood('Sao Joao do Tauape'));

    expect((await service.list(brokerA, { search: 'são joão' })).total).toBe(1);
  });

  it('filtros de tipo e corretor combinam com a busca', async () => {
    await properties.create(brokerA, validInput({ type: 'usado' }));
    await properties.create(brokerA, validInput({ type: 'terreno' }));
    await properties.create(brokerC, validInput({ type: 'terreno' }));

    const result = await service.list(brokerA, { types: ['terreno'], responsibleBrokerId: BROKER_C, search: 'meireles' });
    expect(result.total).toBe(1);
    expect(result.items[0].responsibleBroker.name).toBe('Carlos Corretor');
  });

  it('CA-9.5 empresa sem imóveis: lista vazia', async () => {
    await expect(service.list(brokerA, {})).resolves.toMatchObject({ items: [], total: 0 });
  });

  it('CA-9.6 corretor vê imóveis de colegas e nenhum dado de vendedor na lista', async () => {
    await properties.create(brokerC, validInput());

    const [item] = (await service.list(brokerA, {})).items;
    expect(item.responsibleBroker.id).toBe(BROKER_C);
    expect(Object.keys(item).some((key) => /seller|vendedor|internalNotes|appraisal|registration/i.test(key))).toBe(false);
  });

  it('CA-9.7 lista e busca nunca trazem imóvel de outra empresa', async () => {
    await properties.create(brokerB, validInput({ referenceCode: 'B-1' }));

    expect((await service.list(brokerA, {})).total).toBe(0);
    expect((await service.list(brokerA, { search: 'b-1' })).total).toBe(0);
  });

  it('paginação respeita o tamanho de página', async () => {
    for (let i = 0; i < 5; i += 1) await properties.create(brokerA, validInput());

    const page2 = await service.list(brokerA, { page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(2);
  });

  it('capa vira miniatura na linha', async () => {
    const property = await properties.create(brokerA, validInput());
    await photos.add({
      companyId: COMPANY_A,
      propertyId: property.id,
      storagePath: `${COMPANY_A}/${property.id}/a.jpg`,
      originalName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      width: 1080,
      height: 1080,
      createdBy: BROKER_A,
    });

    const [item] = (await service.list(brokerA, {})).items;
    expect(item.coverThumbnailUrl).toBe(`https://thumb/${COMPANY_A}/${property.id}/a.jpg`);
    expect(item.adReadinessLabel).toBe('Faltam: tipologia, título, chamada');
  });
});
