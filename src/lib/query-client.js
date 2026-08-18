import { QueryClient, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/lib/errors';

/**
 * Two defaults here are load-bearing.
 *
 * staleTime: routes are lazy-mounted, so with the default of 0 every
 * navigation refetched every whole table — ["pos"] alone is the entire
 * purchase_order table including its jsonb items column. Five minutes is safe
 * because every mutation already invalidates explicitly.
 *
 * MutationCache.onError: not one of the app's mutations defined an onError, so
 * a failed save produced no toast, no banner, nothing — the dialog simply
 * didn't close. A cache-level handler cannot be forgotten at a call site.
 */
export const queryClientInstance = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // A mutation that handles its own errors opts out via meta.
      if (mutation?.meta?.suppressErrorToast) return;
      toast.error(friendlyErrorMessage(error, 'That change could not be saved.'));
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    },
  },
});
