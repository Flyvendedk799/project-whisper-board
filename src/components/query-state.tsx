import type { UseQueryResult } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/errors";
import { ListSkeleton } from "@/components/app-shell";

/**
 * Loading, failed, empty and loaded, in one place.
 *
 * None of the eighteen queries in this app handled `isError`, so a failed fetch
 * rendered as an empty list — visually identical to "you have no tickets". This
 * makes the failed case impossible to forget, because you cannot render the
 * data without going through it.
 */

export interface QueryStateProps<T> {
  query: Pick<UseQueryResult<T>, "data" | "isPending" | "isError" | "error" | "refetch">;
  children: (data: T) => React.ReactNode;
  /** Rendered when the query succeeded and returned nothing. */
  empty?: React.ReactNode;
  /** Defaults to a list skeleton; pass a shape that matches the real content. */
  pending?: React.ReactNode;
  /** Prefixes the mapped error message, e.g. "Couldn't load tickets." */
  errorTitle?: string;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function QueryState<T>({
  query,
  children,
  empty,
  pending,
  errorTitle = "Couldn't load this",
}: QueryStateProps<T>) {
  if (query.isPending) return <>{pending ?? <ListSkeleton />}</>;

  if (query.isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      >
        <AlertCircle className="mx-auto h-5 w-5 text-destructive" aria-hidden="true" />
        <p className="mt-2 font-medium">{errorTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{toUserMessage(query.error)}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  if (empty && isEmpty(query.data)) return <>{empty}</>;

  return <>{children(query.data as T)}</>;
}
