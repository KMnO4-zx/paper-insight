import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  fetchMe,
  githubAuthUrl,
  login as loginRequest,
  logout as logoutRequest,
  migrateAnonymousData,
} from '@/lib/api';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { clearPaperMarks, getAllPaperMarks, getUserId } from '@/lib/storage';
import type { AuthUser } from '@/types';

async function migrateLegacyLocalData(): Promise<void> {
  const anonymousUserId = getUserId();
  const paperMarks = getAllPaperMarks();
  try {
    await migrateAnonymousData(anonymousUserId, paperMarks);
    clearPaperMarks();
  } catch (error) {
    console.warn('Failed to migrate legacy local data', error);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      const payload = await fetchMe();
      setUser(payload.user);
      await migrateLegacyLocalData();
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    void refresh().finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    login: async (email: string, password: string) => {
      const payload = await loginRequest(email, password);
      setUser(payload.user);
      await migrateLegacyLocalData();
    },
    loginWithGithub: (nextPath = '/') => {
      window.location.href = githubAuthUrl(nextPath);
    },
    logout: async () => {
      await logoutRequest();
      setUser(null);
    },
    refresh,
  }), [isLoading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
