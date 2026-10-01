import type { SupabaseClient } from '@supabase/supabase-js';
import {
  motivoDoBloqueio,
  temAcesso,
  type SituacaoEmpresa,
} from '../../infra/supabase/company-scope.js';
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
  /**
   * Motivo pelo qual a empresa está sem direito de uso (assinatura suspensa,
   * teste vencido), ou nulo se pode usar. Mesma regra de `company-scope.ts`.
   */
  companyBlockedReason: string | null;
};

export interface AuthContextResolver {
  resolve(token: VerifiedToken): Promise<AuthContext>;
}

type ProfileRow = {
  company_id: string | null;
  role: string | null;
  companies: (SituacaoEmpresa & { owner_id: string | null }) | (SituacaoEmpresa & { owner_id: string | null })[] | null;
};

/**
 * Porta de `SupabaseAuthGuard.resolverContexto` do `effectus-api`, somando a
 * trava de pagamento. Cacheado por pouco tempo porque roda a cada requisição:
 * mudança de papel, empresa ou assinatura leva no máximo `ttlMs` para valer.
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
      .select('company_id, role, companies(owner_id, plan, status, trial_expira_em, acesso_ate)')
      .eq('id', token.userId)
      .maybeSingle<ProfileRow>();

    if (error) throw new Error(`Falha ao carregar perfil: ${error.message}`);

    // O embed vem como objeto quando a FK é única, mas o tipo admite array.
    const company = Array.isArray(profile?.companies) ? profile.companies[0] : profile?.companies;
    const companyId = profile?.company_id ?? null;

    const value: AuthContext = {
      userId: token.userId,
      email: token.email,
      companyId,
      isAdmin: profile?.role === 'admin',
      isOwner: Boolean(company?.owner_id) && company?.owner_id === token.userId,
      // Sem status na consulta, deixa passar como `resolveCompanyIdForUser`:
      // derrubar todo mundo por um cache de schema defasado seria pior.
      companyBlockedReason: company?.status && !temAcesso(company, new Date(this.now()))
        ? motivoDoBloqueio(company)
        : null,
    };

    this.cache.set(token.userId, { value, expiresAt: this.now() + this.ttlMs });

    return value;
  }
}
