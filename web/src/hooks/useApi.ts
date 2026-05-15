import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

export interface UseApiResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useApi<T>(path: string): UseApiResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const reqId = useRef(0);

  const load = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((result) => {
        if (id !== reqId.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (id !== reqId.current) return;
        if (e instanceof ApiError || e instanceof Error) setError(e);
        else setError(new Error(String(e)));
        setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
