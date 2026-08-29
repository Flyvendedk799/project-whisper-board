import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isRetryable } from "./lib/errors";
import { captureError } from "./lib/providers";

/**
 * The QueryClient had no defaults at all, which meant staleTime 0 — every tab
 * switch and every remount refetched everything. And `defaultPreloadStaleTime:
 * 0` meant router preloads were fetched and then immediately discarded, so
 * hovering a link did the work twice.
 */
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Retrying a permission denial or a validation failure just triples
        // the load and delays the error the user needs to see.
        retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: 0,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        captureError(error, { scope: "query", queryKey: query.queryKey });
      },
    }),
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
  });
};
