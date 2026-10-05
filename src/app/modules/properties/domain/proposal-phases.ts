/**
 * Definição única de proposta "ativa" e "sem sucesso" usada pelas regras do
 * imóvel (4.5). [PROVISÓRIO]: confirmar a lista com o negócio. As fases são
 * as que o sistema já usa (`PROPOSAL_STATUS_OPTIONS`).
 */

/** Terminou com sucesso: o imóvel vira Vendido (13.9). */
export const SUCCESSFUL_FINAL_PHASES = ['finalizado'] as const;

/** Terminou sem finalizar: o imóvel pode voltar a Disponível (13.8). */
export const UNSUCCESSFUL_FINAL_PHASES = ['reprovado', 'renda_nao_validada'] as const;

const FINAL = new Set<string>([...SUCCESSFUL_FINAL_PHASES, ...UNSUCCESSFUL_FINAL_PHASES]);

/** "Proposta ativa" é toda proposta que não terminou. */
export function isActiveProposalPhase(status: string): boolean {
  return !FINAL.has(status);
}

export function isSuccessfulFinalPhase(status: string): boolean {
  return (SUCCESSFUL_FINAL_PHASES as readonly string[]).includes(status);
}
