import { PROPERTY_TYPES, type PropertyAddress, type PropertyInput, type PropertyType } from './property.js';

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

const MAX_REFERENCE_CODE = 30;
const MAX_SHORT_TEXT = 200;
const MAX_NOTES = 5000;

/** Dados do formulário já limpos e validados, prontos para gravar. */
export type ValidPropertyData = {
  referenceCode: string | null;
  type: PropertyType;
  salePrice: number;
  developmentName: string | null;
  address: PropertyAddress;
  privateAreaM2: number | null;
  totalAreaM2: number | null;
  registrationNumber: string | null;
  hasAppraisal: boolean;
  appraisalValue: number | null;
  appraisalValidUntil: string | null;
  internalNotes: string | null;
  responsibleBrokerId: string | null;
};

/** Erros por campo, com texto que diz o que fazer (regra 0.8 da spec). */
export type FieldErrors = Partial<Record<string, string>>;

export type ValidationResult =
  | { ok: true; data: ValidPropertyData }
  | { ok: false; errors: FieldErrors };

/**
 * Valida o formulário de cadastro e edição (seção 8). Obrigatórios: endereço
 * (UF, município, bairro, logradouro), valor de venda e tipo. O resto é
 * opcional. A checagem "município pertence à UF" (8.2) depende da lista do
 * IBGE e é feita pelo serviço, fora desta função pura.
 */
export function validatePropertyInput(input: PropertyInput): ValidationResult {
  const errors: FieldErrors = {};

  const type = text(input.type);
  if (!type) {
    errors.type = 'Escolha o tipo do imóvel';
  } else if (!PROPERTY_TYPES.includes(type as PropertyType)) {
    errors.type = 'Escolha um dos tipos da lista';
  }

  const salePrice = money(input.salePrice);
  if (salePrice === undefined) {
    errors.salePrice = 'Informe o valor de venda';
  } else if (salePrice === null || salePrice <= 0) {
    errors.salePrice = 'O valor de venda precisa ser maior que zero';
  }

  const address = input.address ?? {};
  const state = text(address.state)?.toUpperCase() ?? null;
  if (!state) {
    errors['address.state'] = 'Escolha a UF';
  } else if (!BRAZILIAN_STATES.includes(state as (typeof BRAZILIAN_STATES)[number])) {
    errors['address.state'] = 'Escolha uma UF da lista';
  }

  const municipality = text(address.municipality);
  if (!municipality) errors['address.municipality'] = 'Escolha o município';

  const neighborhood = text(address.neighborhood);
  if (!neighborhood) errors['address.neighborhood'] = 'Informe o bairro';

  const street = text(address.street);
  if (!street) errors['address.street'] = 'Informe o logradouro';

  const postalCode = text(address.postalCode)?.replace(/\D/g, '') ?? null;
  if (postalCode && postalCode.length !== 8) {
    errors['address.postalCode'] = 'O CEP precisa ter 8 números';
  }

  const referenceCode = text(input.referenceCode);
  if (referenceCode && referenceCode.length > MAX_REFERENCE_CODE) {
    errors.referenceCode = `Use no máximo ${MAX_REFERENCE_CODE} caracteres no código`;
  }

  const privateAreaM2 = optionalPositive(input.privateAreaM2, 'privateAreaM2', 'A área privativa', errors);
  const totalAreaM2 = optionalPositive(input.totalAreaM2, 'totalAreaM2', 'A área total', errors);

  // 8.7: com "Não", valor e validade ficam vazios; com "Sim", os dois são obrigatórios.
  const hasAppraisal = input.hasAppraisal === true;
  let appraisalValue: number | null = null;
  let appraisalValidUntil: string | null = null;

  if (hasAppraisal) {
    const value = money(input.appraisalValue);
    if (value === undefined) {
      errors.appraisalValue = 'Informe o valor avaliado';
    } else if (value === null || value <= 0) {
      errors.appraisalValue = 'O valor avaliado precisa ser maior que zero';
    } else {
      appraisalValue = value;
    }

    const validUntil = text(input.appraisalValidUntil);
    if (!validUntil) {
      errors.appraisalValidUntil = 'Informe até quando a avaliação vale';
    } else if (!isIsoDate(validUntil)) {
      errors.appraisalValidUntil = 'Informe uma data válida';
    } else {
      appraisalValidUntil = validUntil;
    }
  }

  const internalNotes = text(input.internalNotes);
  if (internalNotes && internalNotes.length > MAX_NOTES) {
    errors.internalNotes = `Use no máximo ${MAX_NOTES} caracteres nas observações`;
  }

  for (const [field, value, label] of [
    ['developmentName', input.developmentName, 'empreendimento'],
    ['registrationNumber', input.registrationNumber, 'matrícula'],
    ['address.number', address.number, 'número'],
    ['address.complement', address.complement, 'complemento'],
  ] as const) {
    const cleaned = text(value);
    if (cleaned && cleaned.length > MAX_SHORT_TEXT) {
      errors[field] = `Use no máximo ${MAX_SHORT_TEXT} caracteres em ${label}`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      referenceCode,
      type: type as PropertyType,
      salePrice: salePrice as number,
      developmentName: text(input.developmentName),
      address: {
        state: state as string,
        municipality: municipality as string,
        municipalityIbgeCode: text(address.municipalityIbgeCode),
        neighborhood: neighborhood as string,
        street: street as string,
        number: text(address.number),
        complement: text(address.complement),
        postalCode,
      },
      privateAreaM2,
      totalAreaM2,
      registrationNumber: text(input.registrationNumber),
      hasAppraisal,
      appraisalValue,
      appraisalValidUntil,
      internalNotes,
      responsibleBrokerId: text(input.responsibleBrokerId),
    },
  };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * `undefined` = não informado; `null` = informado mas ilegível. Aceita número
 * ou texto com ponto decimal; o app manda número, não "R$ 890.000,00".
 */
function money(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());

  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * 100) / 100;
}

function optionalPositive(
  value: unknown,
  field: string,
  label: string,
  errors: FieldErrors,
): number | null {
  const parsed = money(value);

  if (parsed === undefined) return null;

  if (parsed === null || parsed <= 0) {
    errors[field] = `${label} precisa ser maior que zero`;
    return null;
  }

  return parsed;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
