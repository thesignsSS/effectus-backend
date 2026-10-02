import type { PropertyStatus } from './property.js';

/** Situações que não podem ir para anúncio (glossário: "situação anunciável"). */
export const NON_ADVERTISABLE_STATUSES: readonly PropertyStatus[] = ['vendido', 'inativo'];

export type AdReadinessInput = {
  status: PropertyStatus;
  typology: string | null;
  title: string | null;
  headline: string | null;
  municipality: string | null;
  state: string | null;
  photoCount: number;
  hasCover: boolean;
};

export type AdReadiness =
  | { kind: 'ready' }
  | { kind: 'missing'; missing: string[] }
  /** Vendido ou Inativo: não é "faltam", é fora do anúncio (CA-9.2). */
  | { kind: 'not_advertisable' };

/**
 * "Pronto para anunciar" (12.5): indicador calculado, nunca situação.
 * Único lugar do cálculo — lista, detalhe e tela do anúncio usam este.
 * Os itens faltantes saem em texto, na ordem em que o usuário preenche.
 */
export function computeAdReadiness(input: AdReadinessInput): AdReadiness {
  if (NON_ADVERTISABLE_STATUSES.includes(input.status)) return { kind: 'not_advertisable' };

  const missing: string[] = [];

  if (!input.typology) missing.push('tipologia');
  if (!input.title) missing.push('título');
  if (!input.headline) missing.push('chamada');
  if (!input.municipality || !input.state) missing.push('município e UF');
  if (input.photoCount === 0) missing.push('foto');
  else if (!input.hasCover) missing.push('capa');

  return missing.length === 0 ? { kind: 'ready' } : { kind: 'missing', missing };
}

export function adReadinessLabel(readiness: AdReadiness): string {
  if (readiness.kind === 'ready') return 'Pronto para anunciar';
  if (readiness.kind === 'not_advertisable') return 'Fora do anúncio nesta situação';

  return `Faltam: ${readiness.missing.join(', ')}`;
}
