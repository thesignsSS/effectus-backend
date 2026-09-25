import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O bot usa a service role key, que ignora RLS por completo — por isso a
 * responsabilidade de carimbar `company_id` em toda linha nova é 100% do
 * código aqui, não do banco. Sem isso, nenhuma política de RLS por empresa
 * teria efeito sobre o que o bot grava.
 */

/**
 * Trecho exato usado pela camada HTTP para devolver 403 e pelo app para
 * mostrar a tela de empresa suspensa. Mudar isto quebra os dois — mude junto.
 */
export const EMPRESA_SUSPENSA = 'Empresa suspensa';

type SituacaoEmpresa = {
  plan?: string | null;
  status?: string | null;
  trial_expira_em?: string | null;
  acesso_ate?: string | null;
};

/**
 * Se a empresa pode usar o sistema agora.
 *
 * Espelha `temAcesso` de `effectus-api/src/modules/companies/domain/company.ts`.
 * São serviços separados, sem código compartilhado: mudou lá, mude aqui.
 *
 * A data local manda para BLOQUEAR e o webhook manda para LIBERAR, nunca o
 * contrário: `trial` vale só enquanto a data não passou, mesmo que nenhum
 * evento de atraso tenha chegado. Assim, falha de integração com o gateway
 * nunca abre acesso indevido — no máximo fecha antes.
 *
 * `interno` passa antes de qualquer olhada em status ou data: é atribuído pela
 * Effectus e não passa por cobrança.
 */
function temAcesso(empresa: SituacaoEmpresa, agora: Date): boolean {
  if (empresa.plan === 'interno') return true;

  if (empresa.status === 'trial') {
    return venceDepoisDe(empresa.trial_expira_em, agora);
  }

  if (empresa.status === 'ativa') {
    // Nulo é empresa ativa de antes desta coluna existir: o status manda.
    return !empresa.acesso_ate || venceDepoisDe(empresa.acesso_ate, agora);
  }

  return false;
}

function venceDepoisDe(iso: string | null | undefined, agora: Date): boolean {
  if (!iso) return false;

  const limite = new Date(iso);

  // Data ilegível não pode virar acesso liberado por acidente.
  return !Number.isNaN(limite.getTime()) && limite > agora;
}

/**
 * Resolve a empresa do usuário e, de quebra, barra empresa sem direito de uso.
 *
 * Esta é a trava de acesso por pagamento. Fica aqui porque praticamente todo
 * store com escopo de empresa passa por esta função — não existe middleware
 * central no servidor, e espalhar a checagem rota a rota garantiria esquecer
 * alguma. Bloquear no frontend não vale: basta chamar a API direto.
 *
 * Os dados da empresa continuam intactos; só o acesso é negado.
 */
export async function resolveCompanyIdForUser(
  client: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from('profiles')
    .select(
      'company_id, companies(plan, status, trial_expira_em, acesso_ate)',
    )
    .eq('id', userId)
    .single();

  if (error || !data?.company_id) {
    throw new Error(
      `Não foi possível resolver a empresa do usuário ${userId}: ${error?.message ?? 'company_id ausente no perfil'}`,
    );
  }

  // O embed vem como objeto quando a FK é única, mas o tipo gerado admite
  // array — normalizar evita depender de qual dos dois o cliente devolveu.
  const bruto = data.companies as unknown;
  const empresa = (
    Array.isArray(bruto) ? bruto[0] : bruto
  ) as SituacaoEmpresa | null | undefined;

  if (!empresa?.status) {
    // Deixar passar mantém o sistema de pé se a consulta da situação quebrar
    // (cache de schema defasado, por exemplo), mas silenciar transformaria
    // esta trava num no-op invisível — o pior desfecho para um controle de
    // acesso. Se este log aparecer, a trava não está protegendo nada.
    console.error(
      `[company-scope] situação da empresa ${data.company_id} não veio na consulta: a trava de acesso por pagamento está inativa para o usuário ${userId}.`,
    );

    return data.company_id as string;
  }

  if (!temAcesso(empresa, new Date())) {
    throw new Error(
      `${EMPRESA_SUSPENSA}: o acesso está bloqueado (situação: ${empresa.status}). Fale com o suporte.`,
    );
  }

  return data.company_id as string;
}

export async function resolveCompanyIdForProposal(
  client: SupabaseClient,
  proposalId: string,
): Promise<string> {
  const { data, error } = await client
    .from('proposals')
    .select('company_id')
    .eq('id', proposalId)
    .single();

  if (error || !data?.company_id) {
    throw new Error(
      `Não foi possível resolver a empresa da proposta ${proposalId}: ${error?.message ?? 'company_id ausente'}`,
    );
  }

  return data.company_id as string;
}

export async function resolveCompanyIdForRequest(
  client: SupabaseClient,
  requestId: string,
): Promise<string> {
  const { data, error } = await client
    .from('engineering_requests')
    .select('company_id')
    .eq('id', requestId)
    .single();

  if (error || !data?.company_id) {
    throw new Error(
      `Não foi possível resolver a empresa da solicitação ${requestId}: ${error?.message ?? 'company_id ausente'}`,
    );
  }

  return data.company_id as string;
}
