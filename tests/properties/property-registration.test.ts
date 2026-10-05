import { beforeEach, describe, expect, it } from 'vitest';
import {
  PropertyNotFound,
  PropertyService,
  PropertyValidationError,
} from '../../src/app/modules/properties/application/property.service.js';
import { validatePropertyInput } from '../../src/app/modules/properties/domain/property-validation.js';
import { PermissionDenied } from '../../src/app/modules/auth/permissions.js';
import { context, memoryLogger } from '../auth/helpers.js';
import {
  ADMIN_A,
  BROKER_A,
  BROKER_B,
  BROKER_C,
  COMPANY_A,
  COMPANY_B,
  FakeMunicipalityDirectory,
  InMemoryPropertyRepository,
  validInput,
} from './fakes.js';

const brokerA = context({ userId: BROKER_A, companyId: COMPANY_A });
const brokerC = context({ userId: BROKER_C, companyId: COMPANY_A });
const adminA = context({ userId: ADMIN_A, companyId: COMPANY_A, isAdmin: true });
const brokerB = context({ userId: BROKER_B, companyId: COMPANY_B });

let repository: InMemoryPropertyRepository;
let directory: FakeMunicipalityDirectory;
let service: PropertyService;

beforeEach(() => {
  repository = new InMemoryPropertyRepository();
  directory = new FakeMunicipalityDirectory();
  service = new PropertyService(repository, directory, memoryLogger().logger);
});

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('era para recusar');
    },
    (error: unknown) => error,
  );
}

describe('Seção 8 · cadastrar e editar imóvel', () => {
  it('CA-8.1 sem tipo: erro no campo tipo e nada é gravado', async () => {
    const error = await rejection(service.create(brokerA, validInput({ type: undefined })));

    expect(error).toBeInstanceOf(PropertyValidationError);
    expect((error as PropertyValidationError).fields.type).toBe('Escolha o tipo do imóvel');
    expect(repository.properties).toHaveLength(0);
  });

  it('CA-8.2 com o essencial: nasce Disponível com quem cadastrou de responsável', async () => {
    const property = await service.create(brokerA, validInput());

    expect(property.status).toBe('disponivel');
    expect(property.responsibleBrokerId).toBe(BROKER_A);
    expect(property.responsibleBroker.name).toBe('Ana Corretora');
    expect(repository.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('CA-8.3 Fortaleza com UF SP: recusa e pede para corrigir o município', async () => {
    const error = await rejection(
      service.create(brokerA, validInput({ address: { ...validInput().address, state: 'SP' } })),
    );

    expect((error as PropertyValidationError).fields['address.municipality']).toBe('Escolha um município de SP');
  });

  it('município é gravado com o nome oficial e o código do IBGE', async () => {
    const property = await service.create(
      brokerA,
      validInput({ address: { ...validInput().address, municipality: '  fortaleza ' } }),
    );

    expect(property.address.municipality).toBe('Fortaleza');
    expect(property.address.municipalityIbgeCode).toBe('2304400');
  });

  it('[PROVISÓRIO] IBGE fora do ar não impede o cadastro', async () => {
    directory.available = false;

    await expect(service.create(brokerA, validInput())).resolves.toMatchObject({ status: 'disponivel' });
  });

  it('CA-8.4 valor de venda zero: recusa', async () => {
    const error = await rejection(service.create(brokerA, validInput({ salePrice: 0 })));

    expect((error as PropertyValidationError).fields.salePrice).toBe('O valor de venda precisa ser maior que zero');
  });

  it('CA-8.5 código em branco recebe um único; repetido na mesma empresa é recusado; em outra empresa é aceito', async () => {
    const generated = await service.create(brokerA, validInput({ referenceCode: '' }));
    expect(generated.referenceCode).toMatch(/^IM-[A-Z2-9]{6}$/);

    await service.create(brokerA, validInput({ referenceCode: 'AP-0132' }));
    const duplicate = await rejection(service.create(brokerC, validInput({ referenceCode: 'AP-0132' })));
    expect((duplicate as PropertyValidationError).fields.referenceCode).toMatch(/Já existe um imóvel com este código/);

    await expect(service.create(brokerB, validInput({ referenceCode: 'AP-0132' }))).resolves.toMatchObject({
      referenceCode: 'AP-0132',
    });
  });

  it('CA-8.6 avaliação: com Não, valor e validade ficam vazios; com Sim, são obrigatórios', () => {
    const withoutAppraisal = validatePropertyInput(
      validInput({ hasAppraisal: false, appraisalValue: 500000, appraisalValidUntil: '2027-01-01' }),
    );
    expect(withoutAppraisal.ok && withoutAppraisal.data.appraisalValue).toBeNull();

    const missing = validatePropertyInput(validInput({ hasAppraisal: true }));
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.errors).toMatchObject({
      appraisalValue: 'Informe o valor avaliado',
      appraisalValidUntil: 'Informe até quando a avaliação vale',
    });
  });

  it('endereço: bairro e logradouro obrigatórios, número, complemento e CEP opcionais', () => {
    const result = validatePropertyInput(
      validInput({ address: { state: 'CE', municipality: 'Fortaleza', neighborhood: '', street: ' ' } }),
    );

    expect(!result.ok && result.errors).toEqual({
      'address.neighborhood': 'Informe o bairro',
      'address.street': 'Informe o logradouro',
    });
  });

  it('8.9 responsável pode ser outro corretor da mesma empresa, nunca de outra', async () => {
    await expect(service.create(brokerA, validInput({ responsibleBrokerId: BROKER_C }))).resolves.toMatchObject({
      responsibleBrokerId: BROKER_C,
    });

    const error = await rejection(service.create(brokerA, validInput({ responsibleBrokerId: BROKER_B })));
    expect((error as PropertyValidationError).fields.responsibleBrokerId).toBe(
      'Escolha um corretor ativo desta imobiliária',
    );
  });

  it('CA-8.10 empresa A não abre nem edita imóvel da empresa B, e a resposta não revela se existe', async () => {
    const fromB = await service.create(brokerB, validInput());

    await expect(service.get(brokerA, fromB.id)).rejects.toBeInstanceOf(PropertyNotFound);
    await expect(service.update(adminA, fromB.id, validInput())).rejects.toBeInstanceOf(PropertyNotFound);
    await expect(service.get(brokerA, 'nao-existe')).rejects.toThrow('Imóvel não encontrado');
  });

  it('CA-8.11 outro corretor abre sem poder editar; pedido direto de edição é recusado', async () => {
    const property = await service.create(brokerA, validInput());
    const seenByC = await service.get(brokerC, property.id);

    expect(seenByC.permissions.canEdit).toBe(false);
    await expect(service.update(brokerC, property.id, validInput({ salePrice: 1 }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('decisão 9: mudar o valor de venda registra valor anterior e novo no histórico', async () => {
    const property = await service.create(brokerA, validInput());

    await service.update(brokerA, property.id, validInput({ salePrice: 850000 }));

    const history = await service.history(brokerA, property.id);
    expect(history.find((e) => e.kind === 'price_changed')?.data).toEqual({ from: 890000, to: 850000 });
  });

  it('decisão 6: o responsável não muda o tipo; o ADM corrige e fica no histórico', async () => {
    const property = await service.create(brokerA, validInput({ type: 'usado' }));

    const error = await rejection(service.update(brokerA, property.id, validInput({ type: 'novo' })));
    expect((error as PropertyValidationError).fields.type).toBe('Só o administrador corrige o tipo depois do cadastro');

    await service.update(adminA, property.id, validInput({ type: 'novo' }));
    const history = await service.history(adminA, property.id);
    expect(history.find((e) => e.kind === 'type_corrected')?.data).toEqual({ from: 'usado', to: 'novo' });
  });

  it('seção 15: trocar o responsável pela edição é transferência, só do ADM', async () => {
    const property = await service.create(brokerA, validInput());

    const error = await rejection(
      service.update(brokerA, property.id, validInput({ responsibleBrokerId: BROKER_C })),
    );
    expect((error as PropertyValidationError).fields.responsibleBrokerId).toMatch(/Só o administrador transfere/);

    const transferred = await service.update(adminA, property.id, validInput({ responsibleBrokerId: BROKER_C }));
    expect(transferred.responsibleBrokerId).toBe(BROKER_C);
  });

  it('empresa suspensa não cadastra', async () => {
    await expect(
      service.create(context({ userId: BROKER_A, companyId: COMPANY_A, companyBlockedReason: 'teste vencido' }), validInput()),
    ).rejects.toThrow(/^Empresa suspensa/);
  });
});
