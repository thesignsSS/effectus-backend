export type UserRole = 'broker' | 'admin';

export interface UserProfile {
  id: string;
  fullName: string;
  role: UserRole;
  isAdmin: boolean;
  isActive: boolean;
}

export interface ProfileStore {
  getById(userId: string): Promise<UserProfile | null>;
}
