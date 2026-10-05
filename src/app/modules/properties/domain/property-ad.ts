/**
 * Dados do anúncio (seção 12). Valores [PROVISÓRIO] num lugar só (seção 16).
 */

/** [PROVISÓRIO] Lista de tipologias, mantida só aqui. */
export const TYPOLOGIES = ['apartamento', 'casa', 'casa_condominio', 'terreno', 'sala_loja'] as const;
export type Typology = (typeof TYPOLOGIES)[number];

export const TYPOLOGY_LABELS: Record<Typology, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  casa_condominio: 'Casa em condomínio',
  terreno: 'Terreno',
  sala_loja: 'Sala ou loja',
};

export const MAX_TITLE = 40;
export const MAX_HEADLINE = 125;
/** [PROVISÓRIO] */
export const MAX_HIGHLIGHTS = 8;
const MAX_HIGHLIGHT_LENGTH = 40;
const MAX_DESCRIPTION = 5000;

export const TRI_STATE = ['sim', 'nao', 'nao_informado'] as const;
export type TriState = (typeof TRI_STATE)[number];

export type PropertyAdData = {
  typology: Typology | null;
  title: string | null;
  headline: string | null;
  description: string | null;
  highlights: string[];
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  acceptsFinancing: TriState;
  acceptsFgts: TriState;
  acceptsMcmv: TriState;
  showPrice: boolean;
  showFullAddress: boolean;
  latitude: number | null;
  longitude: number | null;
};

export const EMPTY_AD: PropertyAdData = {
  typology: null,
  title: null,
  headline: null,
  description: null,
  highlights: [],
  bedrooms: null,
  suites: null,
  bathrooms: null,
  parkingSpaces: null,
  acceptsFinancing: 'nao_informado',
  acceptsFgts: 'nao_informado',
  acceptsMcmv: 'nao_informado',
  showPrice: true,
  showFullAddress: false,
  latitude: null,
  longitude: null,
};

export type AdInput = Partial<Record<keyof Omit<PropertyAdData, 'latitude' | 'longitude'>, unknown>>;

export type AdValidation =
  | { ok: true; data: Omit<PropertyAdData, 'latitude' | 'longitude'>; warnings: string[] }
  | { ok: false; errors: Partial<Record<string, string>> };

/**
 * Nenhum campo é obrigatório e salvar nunca é bloqueado por falta de campo
 * (12.1). Só valores fora da regra (texto acima do limite, número negativo)
 * são recusados. Telefone ou e-mail no texto geram aviso, sem bloquear (12.4).
 */
export function validateAdInput(input: AdInput): AdValidation {
  const errors: Partial<Record<string, string>> = {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const typology = text(input.typology);
  if (typology && !TYPOLOGIES.includes(typology as Typology)) errors.typology = 'Escolha uma tipologia da lista';

  const title = text(input.title);
  if (title && title.length > MAX_TITLE) errors.title = `Use no máximo ${MAX_TITLE} caracteres no título`;

  const headline = text(input.headline);
  if (headline && headline.length > MAX_HEADLINE) errors.headline = `Use no máximo ${MAX_HEADLINE} caracteres na chamada`;

  const description = text(input.description);
  if (description && description.length > MAX_DESCRIPTION) {
    errors.description = `Use no máximo ${MAX_DESCRIPTION} caracteres na descrição`;
  }

  const highlights = Array.isArray(input.highlights)
    ? input.highlights.map(text).filter((item): item is string => Boolean(item))
    : [];
  if (highlights.length > MAX_HIGHLIGHTS) errors.highlights = `Use no máximo ${MAX_HIGHLIGHTS} destaques`;
  if (highlights.some((item) => item.length > MAX_HIGHLIGHT_LENGTH)) {
    errors.highlights = `Cada destaque pode ter até ${MAX_HIGHLIGHT_LENGTH} caracteres`;
  }

  const count = (field: string, value: unknown, label: string) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors[field] = `${label}: informe um número inteiro, zero ou maior`;
      return null;
    }
    return parsed;
  };

  const tri = (field: string, value: unknown): TriState => {
    if (value === null || value === undefined || value === '') return 'nao_informado';
    if (!TRI_STATE.includes(value as TriState)) {
      errors[field] = 'Escolha Sim, Não ou Não informado';
      return 'nao_informado';
    }
    return value as TriState;
  };

  const data = {
    typology: (typology as Typology | null) ?? null,
    title,
    headline,
    description,
    highlights,
    bedrooms: count('bedrooms', input.bedrooms, 'Quartos'),
    suites: count('suites', input.suites, 'Suítes'),
    bathrooms: count('bathrooms', input.bathrooms, 'Banheiros'),
    parkingSpaces: count('parkingSpaces', input.parkingSpaces, 'Vagas'),
    acceptsFinancing: tri('acceptsFinancing', input.acceptsFinancing),
    acceptsFgts: tri('acceptsFgts', input.acceptsFgts),
    acceptsMcmv: tri('acceptsMcmv', input.acceptsMcmv),
    showPrice: input.showPrice === undefined ? true : input.showPrice === true,
    showFullAddress: input.showFullAddress === true,
  };

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, data, warnings: contactWarnings(data) };
}

// [PROVISÓRIO] Detecção simples de telefone e e-mail no texto público (12.4).
const PHONE = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s.]?\d{4}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function contactWarnings(ad: Pick<PropertyAdData, 'title' | 'headline' | 'description'>): string[] {
  const fields = [
    ['título', ad.title],
    ['chamada', ad.headline],
    ['descrição pública', ad.description],
  ] as const;

  return fields
    .filter(([, value]) => value && (PHONE.test(value) || EMAIL.test(value)))
    .map(([label]) => `O campo ${label} parece ter telefone ou e-mail. Os contatos chegam pelo formulário do anúncio; prefira tirar.`);
}
