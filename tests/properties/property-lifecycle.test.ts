import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionDenied } from '../../src/app/modules/auth/permissions.js';
import {
  PropertyHasHistory,
  PropertyLifecycleService,
} from '../../src/app/modules/properties/application/property-lifecycle.service.js';
import {
  PropertyNotFound,
  PropertyService,
  PropertyValidationError,
} from '../../src/app/modules/properties/application/property.service.js';
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

let repository: InMemoryPropertyRepository;
let photos: InMemoryPhotoRepository;
let storage: FakeStorage;
let properties: PropertyService;
let lifecycle: PropertyLifecycleService;

beforeEach(() => {
  repository = new InMemoryPropertyRepository();
  photos = new InMemoryPhotoRepository();
  storage = new FakeStorage();
  const logger = memoryLogger().logger;
  properties = new PropertyService(repository, new FakeMunicipalityDirectory(), logger, photos);
  lifecycle = new PropertyLifecycleService(repository, photos, storage, logger);
});

describe('Seção 15 · excluir, inativar e transferir', () => {
  it('CA-15.1 sem proposta, engenharia e campanha: o responsável exclui e o imóvel some, com as fotos', async () => {
    const property = await properties.create(brokerA, validInput());
    await photos.add({
      companyId: COMPANY_A,
      propertyId: property.id,
      storagePath: `${COMPANY_A}/${property.id}/a.jpg`,
      originalName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      width: null,
      height: null,
      createdBy: BROKER_A,
    });

    expect((await lifecycle.options(brokerA, property.id)).canDelete).toBe(true);
    await lifecycle.delete(brokerA, property.id);

    await expect(properties.get(brokerA, property.id)).rejects.toBeInstanceOf(PropertyNotFound);
    expect(storage.removed).toEqual([`${COMPANY_A}/${property.id}/a.jpg`]);
  });

  it('CA-15.2 com proposta: não há Excluir, há Inativar, e o pedido direto de exclusão é recusado', async () => {
    const property = await properties.create(brokerA, validInput());
    repository.usageById.set(property.id, { proposals: 1, activeProposals: 0, engineeringRequests: 0 });

    expect(await lifecycle.options(brokerA, property.id)).toMatchObject({ canDelete: false, canInactivate: true });
    await expect(lifecycle.delete(brokerA, property.id)).rejects.toBeInstanceOf(PropertyHasHistory);
  });

  it('CA-15.3 inativado sai de circulação; o ADM reativa', async () => {
    const property = await properties.create(brokerA, validInput());

    await properties.changeStatus(brokerA, property.id, 'inativo');
    expect((await properties.get(brokerA, property.id)).status).toBe('inativo');

    await expect(properties.changeStatus(adminA, property.id, 'disponivel')).resolves.toMatchObject({ status: 'disponivel' });
  });

  it('CA-15.4 inativar com proposta ativa: a tela recebe quantas estão ativas para confirmar', async () => {
    const property = await properties.create(brokerA, validInput());
    repository.usageById.set(property.id, { proposals: 2, activeProposals: 1, engineeringRequests: 0 });

    expect((await lifecycle.options(brokerA, property.id)).activeProposals).toBe(1);
  });

  it('CA-15.5 ADM transfere 5 imóveis de A para C: responsável e histórico de cada um', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await properties.create(brokerA, validInput())).id);

    await expect(lifecycle.transfer(adminA, { propertyIds: ids, toBrokerId: BROKER_C })).resolves.toEqual({ transferred: 5 });

    for (const id of ids) {
      const property = await properties.get(brokerC, id);
      expect(property.responsibleBrokerId).toBe(BROKER_C);
      expect(property.permissions.canEdit).toBe(true);
      const history = await properties.history(brokerC, id);
      expect(history[0]).toMatchObject({ kind: 'transferred', actorId: ADMIN_A, data: { from: BROKER_A, to: BROKER_C } });
    }
    expect((await properties.get(brokerA, ids[0])).permissions.canEdit).toBe(false);
  });

  it('CA-15.7 só o ADM transfere; quem não é responsável não exclui nem inativa', async () => {
    const property = await properties.create(brokerA, validInput());

    await expect(lifecycle.transfer(brokerA, { propertyIds: [property.id], toBrokerId: BROKER_C })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(lifecycle.delete(brokerC, property.id)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(properties.changeStatus(brokerC, property.id, 'inativo')).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('CA-15.8 corretor de outra empresa não pode ser destino', async () => {
    const property = await properties.create(brokerA, validInput());

    const error = await lifecycle.transfer(adminA, { propertyIds: [property.id], toBrokerId: BROKER_B }).catch((e: unknown) => e);

    expect((error as PropertyValidationError).fields.toBrokerId).toBe('Escolha um corretor ativo desta imobiliária');
  });

  it('decisão 10: corretor que sai da empresa tem os imóveis passados ao dono do plano, como "Sistema"', async () => {
    const one = await properties.create(brokerA, validInput());
    const two = await properties.create(brokerA, validInput());
    const others = await properties.create(brokerC, validInput());

    await expect(lifecycle.reassignFromDepartingBroker(COMPANY_A, BROKER_A, ADMIN_A)).resolves.toBe(2);

    for (const id of [one.id, two.id]) {
      expect((await repository.findById(COMPANY_A, id))?.responsibleBrokerId).toBe(ADMIN_A);
      expect((await repository.listEvents(COMPANY_A, id))[0]).toMatchObject({
        kind: 'transferred',
        actorId: null,
        data: { from: BROKER_A, to: ADMIN_A, reason: 'responsavel_saiu_da_empresa' },
      });
    }
    expect((await repository.findById(COMPANY_A, others.id))?.responsibleBrokerId).toBe(BROKER_C);
  });

  it('imóvel de outra empresa na transferência: "Imóvel não encontrado" e nada muda', async () => {
    const mine = await properties.create(brokerA, validInput());
    const foreign = await properties.create(context({ userId: BROKER_B, companyId: COMPANY_B }), validInput());

    await expect(lifecycle.transfer(adminA, { propertyIds: [mine.id, foreign.id], toBrokerId: BROKER_C })).rejects.toBeInstanceOf(
      PropertyNotFound,
    );
    expect((await repository.findById(COMPANY_A, mine.id))?.responsibleBrokerId).toBe(BROKER_A);
  });
});
