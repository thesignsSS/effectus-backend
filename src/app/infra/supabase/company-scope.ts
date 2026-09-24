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

/**
 * Status que dão direito de usar o sistema. Espelha `podeUsarSistema` do
 * effectus-api: trial usa normalmente (o cliente paga no fim do período), e
 * `pendente`, `suspensa` e `cancelada` não entram.
 */
const STATUS_COM_ACESSO = new Set(['trial', 'ativa']);

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
    .select('company_id, companies(status)')
    .eq('id', userId)
    .single();

  if (error || !data?.company_id) {
    throw new Error(
      `Não foi possível resolver a empresa do usuário ${userId}: ${error?.message ?? 'company_id ausente no perfil'}`,
    );
  }

  // O embed vem como objeto quando a FK é única, mas o tipo gerado admite
  // array — normalizar evita depender de qual dos dois o cliente devolveu.
  const empresa = data.companies as unknown;
  const status = Array.isArray(empresa)
    ? (empresa[0] as { status?: string } | undefined)?.status
    : (empresa as { status?: string } | null)?.status;

  if (!status) {
    // Deixar passar mantém o sistema de pé se a consulta do status quebrar
    // (cache de schema defasado, por exemplo), mas silenciar transformaria
    // esta trava num no-op invisível — o pior desfecho para um controle de
    // acesso. Se este log aparecer, a trava não está protegendo nada.
    console.error(
      `[company-scope] status da empresa ${data.company_id} não veio na consulta: a trava de acesso por pagamento está inativa para o usuário ${userId}.`,
    );

    return data.company_id as string;
  }

  if (!STATUS_COM_ACESSO.has(status)) {
    throw new Error(
      `${EMPRESA_SUSPENSA}: o acesso está bloqueado (situação: ${status}). Fale com o suporte.`,
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
