import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * One value kept in the address (?key=…), so links and the back button keep
 * filters and selections. Setting the default removes it from the address;
 * updates replace the history entry instead of adding one per keystroke.
 */
export function useSearchState<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = search[key];
  const value = (typeof raw === typeof fallback ? raw : fallback) as T;
  const set = useCallback(
    (v: T) =>
      void navigate({
        to: '.',
        replace: true,
        search: ((prev: Record<string, unknown>) => ({ ...prev, [key]: v === fallback || v === '' ? undefined : v })) as never,
      }),
    [navigate, key, fallback],
  );
  return [value, set];
}
