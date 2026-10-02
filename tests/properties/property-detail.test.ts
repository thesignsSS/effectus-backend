import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionDenied } from '../../src/app/modules/auth/permissions.js';
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
  InMemoryPhotoRepository,
  InMemoryPropertyRepository,
  validInput,
} from './fakes.js';

const brokerA = context({ userId: BROKER_A, companyId: COMPANY_A });
const brokerC = context({ userId: BROKER_C, companyId: COMPANY_A });
const adminA = context({ userId: ADMIN_A, companyId: COMPANY_A, isAdmin: true });
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

let service: PropertyService;

beforeEach(() => {
  service = new PropertyService(
    new InMemoryPropertyRepository(),
    new FakeMunicipalityDirectory(),
    memoryLogger().logger,
    new InMemoryPhotoRepository(),
  );
});

describe('Seção 10 · detalhe do imóvel e situação', () => {
  it('CA-10.1 responsável muda Disponível → Reservado e o histórico registra quem e quando', async () => {
    const property = await service.create(brokerA, validInput());

    const updated = await service.changeStatus(brokerA, property.id, 'reservado');

    expect(updated.status).toBe('reservado');
    const [last] = await service.history(brokerA, property.id);
    expect(last).toMatchObject({
      kind: 'status_changed',
      data: { from: 'disponivel', to: 'reservado' },
      actorName: 'Ana Corretora',
    });
    expect(last.createdAt).toBeTruthy();
  });

  it('CA-10.2 outro corretor não tem as ações de situação e anúncio, e o pedido direto é recusado', async () => {
    const property = await service.create(brokerA, validInput());
    const seen = await service.get(brokerC, property.id);

    expect(seen.permissions).toMatchObject({ canChangeStatus: false, canEdit: false, canViewSellers: false });
    await expect(service.changeStatus(brokerC, property.id, 'reservado')).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('10.4 responsável não escolhe Em proposta nem Vendido à mão', async () => {
    const property = await service.create(brokerA, validInput());

    for (const status of ['em_proposta', 'vendido']) {
      const error = await service.changeStatus(brokerA, property.id, status).catch((e: unknown) => e);
      expect((error as PropertyValidationError).fields.status).toMatch(/Só o administrador/);
    }
  });

  it('CA-10.5 ADM leva Vendido de volta a Disponível', async () => {
    const property = await service.create(brokerA, validInput());
    await service.changeStatus(adminA, property.id, 'vendido');

    const back = await service.changeStatus(adminA, property.id, 'disponivel');

    expect(back.status).toBe('disponivel');
    expect(back.permissions.canUseInProposal).toBe(true);
  });

  it('situação inválida é recusada com mensagem', async () => {
    const property = await service.create(brokerA, validInput());
    const error = await service.changeStatus(brokerA, property.id, 'rascunho').catch((e: unknown) => e);

    expect((error as PropertyValidationError).fields.status).toBe('Escolha uma situação da lista');
  });

  it('detalhe traz o indicador de anúncio', async () => {
    const property = await service.create(brokerA, validInput());

    expect((await service.get(brokerA, property.id)).adReadinessLabel).toBe('Faltam: tipologia, título, chamada, foto');
  });

  it('CA-10.7 imóvel de outra empresa: "Imóvel não encontrado", inclusive para mudar situação', async () => {
    const property = await service.create(brokerA, validInput());

    await expect(service.get(brokerB, property.id)).rejects.toBeInstanceOf(PropertyNotFound);
    await expect(service.changeStatus(brokerB, property.id, 'inativo')).rejects.toBeInstanceOf(PropertyNotFound);
  });
});
