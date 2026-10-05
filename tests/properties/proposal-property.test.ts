import { beforeEach, describe, expect, it } from 'vitest';
import { PropertyListService } from '../../src/app/modules/properties/application/property-list.service.js';
import { PropertySituationService } from '../../src/app/modules/properties/application/property-situation.service.js';
import {
  PropertyNotFound,
  PropertyService,
  PropertyValidationError,
} from '../../src/app/modules/properties/application/property.service.js';
import {
  ProposalNotFound,
  ProposalPropertyLocked,
  ProposalPropertyService,
} from '../../src/app/modules/properties/application/proposal-property.service.js';
import { situationFromActiveProposals } from '../../src/app/modules/properties/domain/proposal-link.js';
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
  InMemoryProposalLinks,
  RecordingAlerts,
  validInput,
} from './fakes.js';

const brokerA = context({ userId: BROKER_A, companyId: COMPANY_A });
const brokerC = context({ userId: BROKER_C, companyId: COMPANY_A });
const adminA = context({ userId: ADMIN_A, companyId: COMPANY_A, isAdmin: true });
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

let repository: InMemoryPropertyRepository;
let links: InMemoryProposalLinks;
let alerts: RecordingAlerts;
let properties: PropertyService;
let list: PropertyListService;
let service: ProposalPropertyService;

beforeEach(() => {
  repository = new InMemoryPropertyRepository();
  links = new InMemoryProposalLinks();
  alerts = new RecordingAlerts();
  const logger = memoryLogger().logger;
  const photos = new InMemoryPhotoRepository();
  properties = new PropertyService(repository, new FakeMunicipalityDirectory(), logger, photos);
  list = new PropertyListService(repository, photos, new FakeStorage());
  service = new ProposalPropertyService(
    repository,
    links,
    new PropertySituationService(repository, links, alerts, logger),
    list,
    logger,
  );
});

async function statusOf(id: string) {
  return (await repository.findById(COMPANY_A, id))?.status;
}

/** Proposta do corretor C (que usa imóvel do colega A) já com o imóvel. */
async function proposalWith(propertyId: string, broker = BROKER_C) {
  const proposal = links.add({ companyId: COMPANY_A, brokerUserId: broker });
  await service.link(broker === BROKER_C ? brokerC : brokerA, proposal.id, propertyId);
  return proposal;
}

describe('Seção 13 · imóvel na proposta', () => {
  it('CA-13.1 o seletor lista imóveis de todos os corretores da empresa e nenhum de outra', async () => {
    await properties.create(brokerA, validInput());
    await properties.create(brokerC, validInput());
    await properties.create(brokerB, validInput());

    const all = ['disponivel', 'em_negociacao', 'reservado', 'em_proposta', 'vendido', 'inativo'];
    const result = await list.list(brokerC, { statuses: all });

    expect(result.items).toHaveLength(2);
    expect(new Set(result.items.map((i) => i.responsibleBroker.id))).toEqual(new Set([BROKER_A, BROKER_C]));
  });

  it('CA-13.2 Vendido e Inativo não podem ser escolhidos', async () => {
    const sold = await properties.create(brokerA, validInput());
    const inactive = await properties.create(brokerA, validInput());
    await properties.changeStatus(adminA, sold.id, 'vendido');
    await properties.changeStatus(brokerA, inactive.id, 'inativo');
    const proposal = links.add({ companyId: COMPANY_A, brokerUserId: BROKER_C });

    await expect(service.link(brokerC, proposal.id, sold.id)).rejects.toBeInstanceOf(PropertyValidationError);
    await expect(service.assertLinkable(brokerC, inactive.id)).rejects.toThrow(PropertyValidationError);
    expect(links.proposals[0].propertyId).toBeNull();
  });

  it('CA-13.3 imóvel Disponível vinculado vira Em proposta, registrado como Sistema', async () => {
    const property = await properties.create(brokerA, validInput());
    const proposal = await proposalWith(property.id);

    expect(await statusOf(property.id)).toBe('em_proposta');
    const event = repository.events.find((e) => e.kind === 'status_changed');
    expect(event).toMatchObject({ actorId: null, data: { from: 'disponivel', to: 'em_proposta', proposalId: proposal.id } });
  });

  it('CA-13.4 imóvel Reservado vinculado vira Em proposta (o aviso é da tela)', async () => {
    const property = await properties.create(brokerA, validInput());
    await properties.changeStatus(brokerA, property.id, 'reservado');

    await proposalWith(property.id);

    expect(await statusOf(property.id)).toBe('em_proposta');
  });

  it('CA-13.5 com 2 propostas ativas, cancelar uma mantém Em proposta; cancelar a última volta a Disponível', async () => {
    const property = await properties.create(brokerA, validInput());
    const first = await proposalWith(property.id);
    const second = await proposalWith(property.id, BROKER_A);

    links.setStatus(first.id, 'reprovado');
    await service.onPhaseChanged(first.id);
    expect(await statusOf(property.id)).toBe('em_proposta');

    links.setStatus(second.id, 'renda_nao_validada');
    await service.onPhaseChanged(second.id);
    expect(await statusOf(property.id)).toBe('disponivel');
  });

  it('CA-13.5 excluir a única proposta ativa ou tirar o imóvel dela volta a Disponível', async () => {
    const property = await properties.create(brokerA, validInput());
    const deleted = await proposalWith(property.id);

    const after = await service.beforeProposalDeleted(deleted.id);
    links.remove(deleted.id);
    await after();
    expect(await statusOf(property.id)).toBe('disponivel');

    const unlinked = await proposalWith(property.id);
    expect(await statusOf(property.id)).toBe('em_proposta');
    await service.link(brokerC, unlinked.id, null);
    expect(await statusOf(property.id)).toBe('disponivel');
  });

  it('CA-13.6 imóvel Inativo com proposta ativa continua Inativo quando ela é cancelada', async () => {
    const property = await properties.create(brokerA, validInput());
    const proposal = await proposalWith(property.id);
    await properties.changeStatus(brokerA, property.id, 'inativo');

    links.setStatus(proposal.id, 'reprovado');
    await service.onPhaseChanged(proposal.id);

    expect(await statusOf(property.id)).toBe('inativo');
  });

  it('CA-13.7 A finalizada vende o imóvel, o corretor de B é avisado e B continua ativa', async () => {
    const property = await properties.create(brokerA, validInput());
    const a = await proposalWith(property.id, BROKER_A);
    const b = await proposalWith(property.id, BROKER_C);

    links.setStatus(a.id, 'finalizado');
    await service.onPhaseChanged(a.id);

    expect(await statusOf(property.id)).toBe('vendido');
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0]).toMatchObject({ userIds: [BROKER_C], proposalId: b.id });
    expect(links.proposals.find((p) => p.id === b.id)?.status).toBe('em_analise');
  });

  it('CA-13.8 proposta finalizada com imóvel Inativo: não vira Vendido e o responsável é avisado', async () => {
    const property = await properties.create(brokerA, validInput());
    const proposal = await proposalWith(property.id);
    await properties.changeStatus(brokerA, property.id, 'inativo');

    links.setStatus(proposal.id, 'finalizado');
    await service.onPhaseChanged(proposal.id);

    expect(await statusOf(property.id)).toBe('inativo');
    expect(alerts.sent).toEqual([expect.objectContaining({ userIds: [BROKER_A], proposalId: proposal.id })]);
  });

  it('CA-13.9 vincular e usar o imóvel na proposta não muda o valor do cadastro', async () => {
    const property = await properties.create(brokerA, validInput({ salePrice: 890000 }));
    const proposal = await proposalWith(property.id);

    const view = await service.view(brokerC, proposal.id);

    expect(view.property?.salePrice).toBe(890000);
    expect((await repository.findById(COMPANY_A, property.id))?.salePrice).toBe(890000);
  });

  it('CA-13.12 proposta antiga sem imóvel continua funcionando', async () => {
    const proposal = links.add({ companyId: COMPANY_A, brokerUserId: BROKER_C, status: 'aprovado' });

    await expect(service.onPhaseChanged(proposal.id)).resolves.toBeUndefined();
    await expect((await service.beforeProposalDeleted(proposal.id))()).resolves.toBeUndefined();
    expect(await service.view(brokerC, proposal.id)).toEqual({ property: null, canChange: true, modalityWarning: null });
  });

  it('CA-13.13 imóvel de outra empresa é recusado sem revelar nada; proposta de outra empresa também', async () => {
    const foreign = await properties.create(brokerB, validInput());
    const proposal = links.add({ companyId: COMPANY_A, brokerUserId: BROKER_C });

    await expect(service.link(brokerC, proposal.id, foreign.id)).rejects.toBeInstanceOf(PropertyNotFound);
    await expect(service.view(brokerB, proposal.id)).rejects.toBeInstanceOf(ProposalNotFound);
    expect(links.proposals[0].propertyId).toBeNull();
  });

  it('CA-13.14 proposta Finalizada não troca de imóvel, nem por pedido direto', async () => {
    const first = await properties.create(brokerA, validInput());
    const second = await properties.create(brokerA, validInput());
    const proposal = await proposalWith(first.id);
    links.setStatus(proposal.id, 'finalizado');

    await expect(service.link(brokerC, proposal.id, second.id)).rejects.toBeInstanceOf(ProposalPropertyLocked);
    await expect(service.link(adminA, proposal.id, null)).rejects.toBeInstanceOf(ProposalPropertyLocked);
    expect((await service.view(brokerC, proposal.id)).canChange).toBe(false);
  });

  it('13.11 trocar o imóvel recalcula o anterior e o novo', async () => {
    const first = await properties.create(brokerA, validInput());
    const second = await properties.create(brokerA, validInput());
    const proposal = await proposalWith(first.id);

    await service.link(brokerC, proposal.id, second.id);

    expect(await statusOf(first.id)).toBe('disponivel');
    expect(await statusOf(second.id)).toBe('em_proposta');
  });

  it('só quem acessa a proposta mexe no imóvel dela', async () => {
    const property = await properties.create(brokerA, validInput());
    const proposal = links.add({ companyId: COMPANY_A, brokerUserId: BROKER_A });

    await expect(service.link(brokerC, proposal.id, property.id)).rejects.toBeInstanceOf(ProposalNotFound);
    await expect(service.link(adminA, proposal.id, property.id)).resolves.toMatchObject({ property: { id: property.id } });
  });

  it('a regra central nunca põe em Reservado nem tira de Vendido ou Inativo (13.14)', () => {
    expect(situationFromActiveProposals('reservado', 0)).toBe('reservado');
    expect(situationFromActiveProposals('em_negociacao', 1)).toBe('em_proposta');
    expect(situationFromActiveProposals('vendido', 0)).toBe('vendido');
    expect(situationFromActiveProposals('vendido', 2)).toBe('vendido');
    expect(situationFromActiveProposals('inativo', 1)).toBe('inativo');
  });
});
