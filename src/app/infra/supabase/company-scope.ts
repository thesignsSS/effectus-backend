import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O bot usa a service role key, que ignora RLS por completo — por isso a
 * responsabilidade de carimbar `company_id` em toda linha nova é 100% do
 * código aqui, não do banco. Sem isso, nenhuma política de RLS por empresa
 * teria efeito sobre o que o bot grava.
 */

export async function resolveCompanyIdForUser(
  client: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .single();

  if (error || !data?.company_id) {
    throw new Error(
      `Não foi possível resolver a empresa do usuário ${userId}: ${error?.message ?? 'company_id ausente no perfil'}`,
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
