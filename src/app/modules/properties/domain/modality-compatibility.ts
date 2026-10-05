import type { PropertyType } from './property.js';

/**
 * Tabela de compatibilidade entre a modalidade da proposta e o tipo do
 * imóvel (13.5). Ainda não existe: fica vazia e nenhum aviso aparece.
 * [PROVISÓRIO] Quando o negócio definir, basta preencher aqui.
 */
const INCOMPATIBLE: Record<string, readonly PropertyType[]> = {};

/** Só avisa, nunca bloqueia. Nulo = sem aviso. */
export function modalityWarning(modality: string | null | undefined, type: PropertyType): string | null {
  if (!modality) return null;

  return INCOMPATIBLE[modality]?.includes(type)
    ? 'A modalidade da proposta não costuma combinar com o tipo deste imóvel. Confira antes de seguir.'
    : null;
}
