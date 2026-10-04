import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { toast } from './components/Toaster.tsx';
import { ApiError } from './lib/api.ts';
import { router } from './router.tsx';

const queryClient = new QueryClient({
  // Confirms what succeeded silently before (a setting saved, a backup deleted): mutations say what in meta.success.
  mutationCache: new MutationCache({
    onSuccess: (data, variables, _ctx, mutation) => {
      const success = mutation.meta?.success;
      if (success) toast.success(typeof success === 'function' ? success(data, variables) : success);
    },
  }),
  defaultOptions: {
    queries: {
      // ddeploy answers in seconds, not milliseconds: keep data around and
      // don't refetch on every window focus.
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
