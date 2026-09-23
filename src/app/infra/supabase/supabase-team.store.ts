import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateTemporaryPassword } from '../../utils/generate-password.js';
import {
  DeleteTeamMemberInput,
  InviteTeamMemberInput,
  InviteTeamMemberResult,
  ListTeamInput,
  ListTeamResult,
  ResetTeamMemberPasswordInput,
  ResetTeamMemberPasswordResult,
  TeamMember,
  TeamRole,
  TeamStore,
} from '../../domain/interfaces/team-store.interface.js';

export interface SupabaseTeamStoreConfig {
  url?: string;
  serviceRoleKey?: string;
}

type CompanyContext = {
  companyId: string;
  ownerId: string;
  maxUsuarios: number;
  isRequesterOwner: boolean;
};

export class SupabaseTeamStore implements TeamStore {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseTeamStoreConfig) {
    if (!config.url || !config.serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to manage team members',
      );
    }

    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async list(input: ListTeamInput): Promise<ListTeamResult> {
    const context = await this.assertRequesterCanManage(input.requesterId);

    const { data, error } = await this.client
      .from('profiles')
      .select(
        'id, full_name, role, is_active, can_view_preferences_insights, created_at',
      )
      .eq('company_id', context.companyId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Supabase team list failed: ${error.message}`);
    }

    const rows = data ?? [];
    const emails = await this.getEmailsByIds(rows.map((row) => row.id));

    const members: TeamMember[] = rows.map((row) => ({
      id: row.id,
      fullName: row.full_name ?? '',
      email: emails.get(row.id) ?? '',
      role: (row.role === 'admin' ? 'admin' : 'broker') as TeamRole,
      isActive: row.is_active !== false,
      isOwner: row.id === context.ownerId,
      canViewPreferencesInsights:
        row.role === 'admin' || row.can_view_preferences_insights === true,
      createdAt: row.created_at,
    }));

    return {
      members,
      seatsUsed: members.length,
      seatsIncluded: context.maxUsuarios,
    };
  }

  async invite(input: InviteTeamMemberInput): Promise<InviteTeamMemberResult> {
    const context = await this.assertRequesterCanManage(input.requesterId);

    // A regra de "owner pode convidar além do limite pagando mais" ainda não
    // existe — por enquanto o limite do plano vale para todo mundo.
    const { count, error: countError } = await this.client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', context.companyId);

    if (countError) {
      throw new Error(`Supabase team count failed: ${countError.message}`);
    }

    if ((count ?? 0) >= context.maxUsuarios) {
      throw new Error(
        `O limite de usuários do plano foi atingido (${context.maxUsuarios}).`,
      );
    }

    const temporaryPassword = generateTemporaryPassword();

    const { data, error } = await this.client.auth.admin.createUser({
      email: input.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        company_id: context.companyId,
        must_change_password: true,
      },
    });

    if (error || !data.user) {
      throw new Error(
        `Não foi possível criar o usuário: ${error?.message ?? 'erro desconhecido'}`,
      );
    }

    if (input.role === 'admin') {
      const { error: roleError } = await this.client
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', data.user.id);

      if (roleError) {
        throw new Error(`Supabase team role update failed: ${roleError.message}`);
      }
    }

    return { userId: data.user.id, temporaryPassword };
  }

  async resetPassword(
    input: ResetTeamMemberPasswordInput,
  ): Promise<ResetTeamMemberPasswordResult> {
    const context = await this.assertRequesterCanManage(input.requesterId);
    await this.assertTargetInCompany(input.targetUserId, context.companyId);

    const temporaryPassword = generateTemporaryPassword();

    const { data: currentUser, error: getUserError } =
      await this.client.auth.admin.getUserById(input.targetUserId);

    if (getUserError || !currentUser.user) {
      throw new Error('Usuário não encontrado.');
    }

    const { error } = await this.client.auth.admin.updateUserById(
      input.targetUserId,
      {
        password: temporaryPassword,
        user_metadata: {
          ...currentUser.user.user_metadata,
          must_change_password: true,
        },
      },
    );

    if (error) {
      throw new Error(`Não foi possível redefinir a senha: ${error.message}`);
    }

    return { temporaryPassword };
  }

  async remove(input: DeleteTeamMemberInput): Promise<void> {
    const context = await this.assertRequesterCanManage(input.requesterId);
    await this.assertTargetInCompany(input.targetUserId, context.companyId);

    if (input.targetUserId === context.ownerId) {
      throw new Error('Sem permissão para excluir o dono da empresa.');
    }

    const { error } = await this.client.auth.admin.deleteUser(
      input.targetUserId,
    );

    if (error) {
      throw new Error(`Não foi possível excluir o usuário: ${error.message}`);
    }
  }

  /**
   * Só o owner ou um admin da empresa gerenciam usuários. Lança um erro cujo
   * texto o `statusFromError` do servidor HTTP já sabe mapear para 403.
   */
  private async assertRequesterCanManage(
    requesterId: string,
  ): Promise<CompanyContext> {
    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', requesterId)
      .single();

    if (profileError || !profile?.company_id) {
      throw new Error('Perfil do solicitante não encontrado.');
    }

    const { data: company, error: companyError } = await this.client
      .from('companies')
      .select('id, owner_id, max_usuarios')
      .eq('id', profile.company_id)
      .single();

    if (companyError || !company) {
      throw new Error('Empresa não encontrada.');
    }

    const isRequesterOwner = company.owner_id === requesterId;

    if (profile.role !== 'admin' && !isRequesterOwner) {
      throw new Error('Sem permissão para gerenciar usuários.');
    }

    return {
      companyId: company.id,
      ownerId: company.owner_id,
      maxUsuarios: company.max_usuarios,
      isRequesterOwner,
    };
  }

  private async assertTargetInCompany(
    targetUserId: string,
    companyId: string,
  ): Promise<void> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase team target check failed: ${error.message}`);
    }

    if (!data) {
      throw new Error('Usuário não encontrado nesta empresa.');
    }
  }

  private async getEmailsByIds(ids: string[]): Promise<Map<string, string>> {
    const emails = new Map<string, string>();

    await Promise.all(
      ids.map(async (id) => {
        const { data } = await this.client.auth.admin.getUserById(id);
        if (data.user?.email) {
          emails.set(id, data.user.email);
        }
      }),
    );

    return emails;
  }
}
