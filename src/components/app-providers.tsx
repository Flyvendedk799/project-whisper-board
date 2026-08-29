import { useEffect } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { setErrorSink } from "@/lib/providers";
import { installClientDiagnostics } from "@/lib/client-diagnostics";
import { reportErrors } from "@/lib/reporting.functions";

/**
 * Everything the whole app needs mounted exactly once, in the order it needs
 * mounting: query cache, then theme (so the toggle can read it), then auth.
 */
export function AppProviders({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Telemetry />
          {children}
          <Toaster richColors position="top-right" closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Connects the error tracker's queue to the server, and starts the console and
 * network buffers a bug report attaches. Renders nothing.
 */
function Telemetry() {
  const report = useServerFn(reportErrors);

  useEffect(() => {
    const uninstall = installClientDiagnostics();

    setErrorSink((batch) => {
      void report({
        data: {
          entries: batch.map((e) => ({
            fingerprint: e.fingerprint,
            message: e.message.slice(0, 2000),
            stack: e.stack?.slice(0, 8000),
            side: e.side,
            url: e.url?.slice(0, 2000),
            context: e.context,
            occurredAt: e.occurredAt,
          })),
        },
      }).catch(() => {
        // If reporting the error fails there is nowhere left to report that.
      });
    });

    return uninstall;
  }, [report]);

  return null;
}
