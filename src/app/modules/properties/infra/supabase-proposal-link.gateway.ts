import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '../../auth/auth-context.js';
import type { LinkedProposal, ProposalLinkGateway } from '../domain/proposal-link.js';

type ProposalLinkRow = {
  id: string;
  company_id: string;
  proposal_number: number;
  status: string | null;
  broker_user_id: string;
  property_id: string | null;
  form_data: Record<string, unknown> | null;
};

const COLUMNS = 'id, company_id, proposal_number, status, broker_user_id, property_id, form_data';

/** Lê e grava `proposals.property_id`. O resto da proposta é do módulo de propostas. */
export class SupabaseProposalLinkGateway implements ProposalLinkGateway {
  constructor(private readonly client: SupabaseClient) {}

  /** Mesma regra de acesso das propostas: ADM vê todas da empresa; corretor, as suas e as que colabora. */
  async findAccessible(context: AuthContext, proposalId: string): Promise<LinkedProposal | null> {
    if (!context.companyId) return null;

    const { data, error } = await this.client
      .from('proposals')
      .select(COLUMNS)
      .eq('id', proposalId)
      .eq('company_id', context.companyId)
      .maybeSingle();

    if (error) throw new Error(`Falha ao ler proposta: ${error.message}`);
    if (!data) return null;

    const row = data as ProposalLinkRow;

    if (context.isAdmin || row.broker_user_id === context.userId) return toLinked(row);

    const { count, error: collaboratorError } = await this.client
      .from('proposal_collaborators')
      .select('proposal_id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
      .eq('user_id', context.userId);

    if (collaboratorError) throw new Error(`Falha ao ler colaboradores: ${collaboratorError.message}`);

    return count ? toLinked(row) : null;
  }

  async findById(proposalId: string): Promise<LinkedProposal | null> {
    const { data, error } = await this.client.from('proposals').select(COLUMNS).eq('id', proposalId).maybeSingle();

    if (error) throw new Error(`Falha ao ler proposta: ${error.message}`);

    return data ? toLinked(data as ProposalLinkRow) : null;
  }

  async setProperty(companyId: string, proposalId: string, propertyId: string | null): Promise<void> {
    const { error } = await this.client
      .from('proposals')
      .update({ property_id: propertyId })
      .eq('id', proposalId)
      .eq('company_id', companyId);

    if (error) throw new Error(`Falha ao vincular imóvel à proposta: ${error.message}`);
  }

  async listByProperty(companyId: string, propertyId: string): Promise<LinkedProposal[]> {
    const { data, error } = await this.client
      .from('proposals')
      .select(COLUMNS)
      .eq('company_id', companyId)
      .eq('property_id', propertyId);

    if (error) throw new Error(`Falha ao listar propostas do imóvel: ${error.message}`);

    return ((data ?? []) as ProposalLinkRow[]).map(toLinked);
  }
}

function toLinked(row: ProposalLinkRow): LinkedProposal {
  const modality = row.form_data?.['Tipo do Imóvel'];

  return {
    id: row.id,
    companyId: row.company_id,
    code: `PROP-${String(row.proposal_number).padStart(3, '0')}`,
    status: row.status ?? 'em_analise',
    brokerUserId: row.broker_user_id,
    propertyId: row.property_id,
    modality: typeof modality === 'string' ? modality : null,
  };
}
