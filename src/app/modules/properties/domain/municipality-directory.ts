export type Municipality = {
  ibgeCode: string;
  name: string;
};

export type MunicipalityCheck =
  | { status: 'valid'; municipality: Municipality }
  | { status: 'invalid' }
  /** Fonte fora do ar: quem chama decide se bloqueia. */
  | { status: 'unavailable' };

/**
 * Lista oficial de municípios por UF (8.2). A fonte é [PROVISÓRIO]: hoje a API
 * pública do IBGE; trocar por tabela própria não muda quem usa esta interface.
 */
export interface MunicipalityDirectory {
  listByState(state: string): Promise<Municipality[] | null>;
  check(state: string, municipality: string, ibgeCode?: string | null): Promise<MunicipalityCheck>;
}

/** Compara nomes sem acento e sem diferença de maiúsculas ("são paulo" = "São Paulo"). */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function checkAgainstList(
  list: Municipality[] | null,
  municipality: string,
  ibgeCode?: string | null,
): Promise<MunicipalityCheck> {
  if (!list) return { status: 'unavailable' };

  const wanted = normalizeName(municipality);
  const match = list.find((item) =>
    ibgeCode ? item.ibgeCode === ibgeCode : normalizeName(item.name) === wanted,
  );

  return match ? { status: 'valid', municipality: match } : { status: 'invalid' };
}
