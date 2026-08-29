import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataError, toUserMessage } from "@/lib/errors";
import { captureError } from "@/lib/providers";

/**
 * One place where a mutation gets its pending state, its success toast, its
 * cache invalidation, its optimistic update and its error handling.
 *
 * This replaces thirteen copies of
 *
 *   setBusy(true);
 *   try { await fn(); toast.success("…"); onChanged(); }
 *   catch (e: any) { toast.error(e.message); }
 *   finally { setBusy(false); }
 *
 * which leaked raw Postgres text to clients, reported nothing anywhere, and
 * got the busy flag subtly wrong whenever someone forgot the `finally`.
 */

type ServerFn<TInput, TOutput> = (arg: { data: TInput }) => Promise<TOutput>;

export interface ServerActionOptions<TInput, TOutput> {
  /** Shown on success. Omit for actions whose result is visible on its own. */
  success?: string | ((result: TOutput, input: TInput) => string);
  /** Shown instead of the generic message when the failure is not recognised. */
  errorMessage?: string;
  /** Keys to invalidate. Prefix keys cover everything nested beneath them. */
  invalidate?: readonly QueryKey[] | ((result: TOutput, input: TInput) => readonly QueryKey[]);
  onSuccess?: (result: TOutput, input: TInput) => void | Promise<void>;
  onError?: (error: unknown, input: TInput) => void;
  /** Named in the error report so a failure points at the action that caused it. */
  label?: string;
}

export interface ServerAction<TInput, TOutput> {
  run: (input: TInput) => Promise<TOutput>;
  /** Fire-and-forget variant for onClick, so a rejection cannot go unhandled. */
  fire: (input: TInput) => void;
  busy: boolean;
  error: unknown;
  reset: () => void;
}

export function useServerAction<TInput, TOutput>(
  fn: ServerFn<TInput, TOutput>,
  options: ServerActionOptions<TInput, TOutput> = {},
): ServerAction<TInput, TOutput> {
  const queryClient = useQueryClient();

  const mutation = useMutation<TOutput, unknown, TInput>({
    mutationFn: (data: TInput) => fn({ data }),

    onError: (error, input) => {
      captureError(error, { scope: "server-action", label: options.label });
      toast.error(toUserMessage(error, options.errorMessage));
      options.onError?.(error, input);
    },

    onSuccess: async (result, input) => {
      const keys =
        typeof options.invalidate === "function"
          ? options.invalidate(result, input)
          : (options.invalidate ?? []);

      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      await options.onSuccess?.(result, input);

      const message =
        typeof options.success === "function" ? options.success(result, input) : options.success;
      if (message) toast.success(message);
    },
  });

  const { mutateAsync, isPending, error, reset } = mutation;

  const run = useCallback((input: TInput) => mutateAsync(input), [mutateAsync]);
  const fire = useCallback(
    (input: TInput) => {
      // onError has already handled it; this only stops an unhandled rejection.
      void mutateAsync(input).catch(() => {});
    },
    [mutateAsync],
  );

  return { run, fire, busy: isPending, error, reset };
}

/**
 * The same ergonomics for a direct table write. `throwOnError()` turns
 * PostgREST's `{ data, error }` into a rejection, which is what stopped eleven
 * writes in this codebase from failing silently — a rejected status update used
 * to leave the dropdown snapping back with no explanation.
 */
/**
 * PostgREST resolves to a union — a row with no error, or an error with no row.
 * Inferring the row type through that union directly collapses to `never`, so
 * the whole response is inferred and the row type read back off it.
 */
type PostgrestOutcome = { data: unknown; error: unknown };
type RowOf<T extends PostgrestOutcome> = NonNullable<T["data"]>;

export function useDataMutation<TInput, TResult extends PostgrestOutcome>(
  op: string,
  fn: (input: TInput) => PromiseLike<TResult>,
  options: Omit<ServerActionOptions<TInput, RowOf<TResult>>, "label"> = {},
): ServerAction<TInput, RowOf<TResult>> {
  const wrapped = useCallback(
    async ({ data: input }: { data: TInput }): Promise<RowOf<TResult>> => {
      const { data, error } = await fn(input);
      if (error) {
        throw new DataError(op, error as { message: string; code?: string; details?: string });
      }
      // PostgREST types `data` as nullable even on the success branch. A write
      // that reports no error and returns nothing is a real anomaly, not
      // something to hand to a caller expecting a row.
      if (data == null) {
        throw new DataError(op, { message: "The write reported success but returned nothing." });
      }
      return data as RowOf<TResult>;
    },
    [fn, op],
  );

  return useServerAction(wrapped, { ...options, label: op });
}
