export type UserRole = 'broker' | 'admin';

export interface StoredUserPreferences {
  theme?: string;
  fontSize?: string;
  density?: string;
  proposalsLayout?: string;
  chatWallpaper?: string;
  enterBehavior?: string;
  notifications?: {
    sound?: boolean;
    types?: Record<string, boolean>;
  };
}

export interface UserProfile {
  id: string;
  fullName: string;
  role: UserRole;
  isAdmin: boolean;
  isActive: boolean;
  appearsInChat: boolean;
  avatarPath: string | null;
  canViewPreferencesInsights: boolean;
  preferencesSnapshot: StoredUserPreferences | null;
  preferencesUpdatedAt: string | null;
  updatedAt: string | null;
}

export interface ProfileStore {
  getById(userId: string): Promise<UserProfile | null>;
  searchByName(input: {
    query: string;
    excludeUserId?: string;
    limit?: number;
  }): Promise<UserProfile[]>;
  listPreferenceInsights(): Promise<UserProfile[]>;
}
