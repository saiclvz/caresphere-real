import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/** Fetches `path` and re-fetches when it changes. Pass null to skip. */
export default function useApi(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);
  const controller = useRef(null);

  const load = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const res = await api(path, { signal: controller.current.signal });
      setData(res);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}
