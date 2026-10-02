/**
 * Imóvel como cadastro único da empresa (spec BKL-093). Os nomes de tipo e
 * situação seguem o padrão de slugs das propostas (`em_analise`).
 */

export const PROPERTY_TYPES = ['novo', 'usado', 'terreno', 'na_planta', 'adjudicado'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  novo: 'Novo',
  usado: 'Usado',
  terreno: 'Terreno',
  na_planta: 'Na Planta',
  adjudicado: 'Adjudicado',
};

export const PROPERTY_STATUSES = [
  'disponivel',
  'em_negociacao',
  'reservado',
  'em_proposta',
  'vendido',
  'inativo',
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  disponivel: 'Disponível',
  em_negociacao: 'Em negociação',
  reservado: 'Reservado',
  em_proposta: 'Em proposta',
  vendido: 'Vendido',
  inativo: 'Inativo',
};

/** Vendido e Inativo impedem novo uso em proposta ou engenharia (4.1). */
export const STATUSES_BLOCKING_NEW_USE: readonly PropertyStatus[] = ['vendido', 'inativo'];

export type Property = {
  id: string;
  companyId: string;
  referenceCode: string;
  type: PropertyType;
  salePrice: number;
  developmentName: string | null;
  address: PropertyAddress;
  privateAreaM2: number | null;
  totalAreaM2: number | null;
  registrationNumber: string | null;
  appraisal: PropertyAppraisal | null;
  internalNotes: string | null;
  responsibleBrokerId: string;
  status: PropertyStatus;
  statusChangedAt: string;
  /** Dados do anúncio (seção 12); ausente até o imóvel ter algum preenchido. */
  ad?: PropertyAd | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyAd = {
  typology: string | null;
  title: string | null;
  headline: string | null;
};

export type PropertyAddress = {
  state: string;
  municipality: string;
  municipalityIbgeCode: string | null;
  neighborhood: string;
  street: string;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
};

export type PropertyAppraisal = {
  value: number;
  validUntil: string;
};

/** Dados que o formulário de cadastro/edição envia (seção 8). */
export type PropertyInput = {
  referenceCode?: string | null;
  type?: string | null;
  salePrice?: number | string | null;
  developmentName?: string | null;
  address?: Partial<Record<keyof PropertyAddress, string | null>>;
  privateAreaM2?: number | string | null;
  totalAreaM2?: number | string | null;
  registrationNumber?: string | null;
  hasAppraisal?: boolean | null;
  appraisalValue?: number | string | null;
  appraisalValidUntil?: string | null;
  internalNotes?: string | null;
  responsibleBrokerId?: string | null;
};

export type PropertyEventKind =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'price_changed'
  | 'type_corrected'
  | 'photo_added'
  | 'photo_removed'
  | 'cover_changed'
  | 'transferred';

export type PropertyEvent = {
  id: string;
  propertyId: string;
  kind: PropertyEventKind;
  /** Nulo = "Sistema" (mudança automática). */
  actorId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};
