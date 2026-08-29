import { AppError, describeError } from "@/lib/errors";
import { captureError } from "@/lib/providers";

/**
 * Wraps a server-function handler so an unexpected failure becomes a generic
 * message rather than reaching the client's toast.
 *
 * Handlers used to throw things like `new Error("AI error 500")` and
 * `new Error("Not found")`, all of which were rendered verbatim. An AppError is
 * something we wrote for a person and passes through untouched; anything else
 * is reported and replaced.
 */
export async function guard<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) throw error;
    captureError(error, { scope: "server-fn", label });
    const described = describeError(error);
    console.error(`[server-fn:${label}]`, described.message, described.extra ?? "");
    throw new AppError("internal", "Something went wrong. Please try again.", { status: 500 });
  }
}

/** Throws a message the caller can show. Use for expected, explainable refusals. */
export function requireFound<T>(value: T | null | undefined, what: string): T {
  if (value == null)
    throw new AppError("not_found", `We couldn't find that ${what}.`, { status: 404 });
  return value;
}
