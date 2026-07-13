import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchReadingOverview } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ReadingOverviewResponse } from '@/types';

interface ReadingOverviewState {
  overview: ReadingOverviewResponse | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  refresh: () => Promise<void>;
}

export function useReadingOverview(days = 112): ReadingOverviewState {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [overview, setOverview] = useState<ReadingOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (showLoading = true) => {
    const requestId = ++requestIdRef.current;
    if (!user) {
      setOverview(null);
      setError(null);
      setIsLoading(isAuthLoading);
      return;
    }

    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const payload = await fetchReadingOverview(days);
      if (requestId === requestIdRef.current) {
        setOverview(payload);
      }
    } catch (requestError) {
      if (requestId === requestIdRef.current) {
        setError(requestError instanceof Error ? requestError.message : '阅读概览加载失败');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [days, isAuthLoading, user]);

  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => {
    if (isAuthLoading) {
      setIsLoading(true);
      return;
    }
    void load(true);
  }, [isAuthLoading, load]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const handleMarkChange = () => {
      void refresh();
    };
    window.addEventListener('paper:mark-changed', handleMarkChange);
    return () => window.removeEventListener('paper:mark-changed', handleMarkChange);
  }, [refresh, user]);

  return {
    overview,
    isLoading,
    error,
    isAuthenticated: Boolean(user),
    refresh,
  };
}
