export type TeamRole = 'admin' | 'broker';

export type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  role: TeamRole;
  isActive: boolean;
  isOwner: boolean;
  createdAt: string;
};

export type ListTeamInput = {
  requesterId: string;
};

export type ListTeamResult = {
  members: TeamMember[];
  seatsUsed: number;
  seatsIncluded: number;
};

export type InviteTeamMemberInput = {
  requesterId: string;
  email: string;
  fullName: string;
  role: TeamRole;
};

export type InviteTeamMemberResult = {
  userId: string;
  temporaryPassword: string;
};

export type ResetTeamMemberPasswordInput = {
  requesterId: string;
  targetUserId: string;
};

export type ResetTeamMemberPasswordResult = {
  temporaryPassword: string;
};

export type DeleteTeamMemberInput = {
  requesterId: string;
  targetUserId: string;
};

/**
 * Gestão de usuários dentro de uma empresa (convite, redefinição de senha,
 * exclusão). Toda operação exige a service role key — por isso vive aqui no
 * bot-wpp, não no front, que só tem a chave anônima.
 */
export interface TeamStore {
  list(input: ListTeamInput): Promise<ListTeamResult>;
  invite(input: InviteTeamMemberInput): Promise<InviteTeamMemberResult>;
  resetPassword(
    input: ResetTeamMemberPasswordInput,
  ): Promise<ResetTeamMemberPasswordResult>;
  remove(input: DeleteTeamMemberInput): Promise<void>;
}
