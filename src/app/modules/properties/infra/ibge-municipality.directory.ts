import type { Logger } from '../../../domain/interfaces/logger.interface.js';
import {
  checkAgainstList,
  type Municipality,
  type MunicipalityCheck,
  type MunicipalityDirectory,
} from '../domain/municipality-directory.js';

const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';

/**
 * Municípios pela API pública do IBGE, em cache por UF (a lista muda raramente).
 * Falha da API não é cacheada: a próxima chamada tenta de novo.
 */
export class IbgeMunicipalityDirectory implements MunicipalityDirectory {
  private readonly cache = new Map<string, { value: Municipality[]; expiresAt: number }>();

  constructor(
    private readonly logger: Logger,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async listByState(state: string): Promise<Municipality[] | null> {
    const uf = state.toUpperCase();
    const cached = this.cache.get(uf);

    if (cached && cached.expiresAt > this.now()) return cached.value;

    try {
      const response = await this.fetchImpl(`${IBGE_URL}/${encodeURIComponent(uf)}/municipios`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = (await response.json()) as { id: number; nome: string }[];
      const value = body
        .map((item) => ({ ibgeCode: String(item.id), name: item.nome }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

      this.cache.set(uf, { value, expiresAt: this.now() + this.ttlMs });

      return value;
    } catch (error) {
      this.logger.warn('Lista de municípios do IBGE indisponível', {
        state: uf,
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }

  async check(state: string, municipality: string, ibgeCode?: string | null): Promise<MunicipalityCheck> {
    return checkAgainstList(await this.listByState(state), municipality, ibgeCode);
  }
}
