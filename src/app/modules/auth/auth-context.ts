import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedToken } from './jwt-verifier.js';

/**
 * Quem está chamando, resolvido a partir do token e do perfil — nunca de
 * parâmetro da requisição. Mesmo formato do `UsuarioAutenticado` do
 * `effectus-api` (`src/core/auth/usuario-autenticado.ts`), para as duas APIs
 * falarem a mesma língua.
 */
export type AuthContext = {
  userId: string;
  email: string | null;
  /** Nulo quando o perfil ainda não foi vinculado a uma empresa. */
  companyId: string | null;
  isAdmin: boolean;
  /** Dono da empresa: quem contratou o plano. */
  isOwner: boolean;
};

export interface AuthContextResolver {
  resolve(token: VerifiedToken): Promise<AuthContext>;
}

/**
 * Porta de `SupabaseAuthGuard.resolverContexto` do `effectus-api`. Cacheado por
 * pouco tempo porque roda a cada requisição: mudança de papel ou de empresa
 * leva no máximo `ttlMs` para valer.
 */
export class SupabaseAuthContextResolver implements AuthContextResolver {
  private readonly cache = new Map<string, { value: AuthContext; expiresAt: number }>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(token: VerifiedToken): Promise<AuthContext> {
    const cached = this.cache.get(token.userId);

    if (cached && cached.expiresAt > this.now()) return cached.value;

    const { data: profile, error } = await this.client
      .from('profiles')
      .select('company_id, role')
      .eq('id', token.userId)
      .maybeSingle<{ company_id: string | null; role: string | null }>();

    if (error) throw new Error(`Falha ao carregar perfil: ${error.message}`);

    const companyId = profile?.company_id ?? null;
    let isOwner = false;

    if (companyId) {
      const { data: company } = await this.client
        .from('companies')
        .select('owner_id')
        .eq('id', companyId)
        .maybeSingle<{ owner_id: string | null }>();

      isOwner = company?.owner_id === token.userId;
    }

    const value: AuthContext = {
      userId: token.userId,
      email: token.email,
      companyId,
      isAdmin: profile?.role === 'admin',
      isOwner,
    };

    this.cache.set(token.userId, { value, expiresAt: this.now() + this.ttlMs });

    return value;
  }
}
