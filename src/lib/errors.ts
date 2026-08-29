/**
 * One rule, enforced everywhere: only messages we wrote ourselves are ever
 * shown to a person verbatim.
 *
 * Before this existed, thirteen call sites did `catch (e) { toast.error(e.message) }`,
 * which meant a client filing a bug could be told
 * `new row violates row-level security policy for table "quotes"`. Everything
 * that is not an AppError now goes through toUserMessage(), which maps what it
 * recognises and falls back to something plain. The original error is never
 * discarded — it is what gets reported.
 */

export type ErrorContext = Record<string, unknown>;

/** An error whose message was written for the person who will read it. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly context?: ErrorContext;

  constructor(
    code: string,
    message: string,
    opts: { status?: number; context?: ErrorContext } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? 400;
    this.context = opts.context;
  }
}

/** A failed database call. Keeps the full Postgres detail for reporting. */
export class DataError extends Error {
  readonly op: string;
  readonly pgCode?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(
    op: string,
    cause: { message: string; code?: string; details?: string; hint?: string },
  ) {
    super(cause.message);
    this.name = "DataError";
    this.op = op;
    this.pgCode = cause.code;
    this.details = cause.details ?? undefined;
    this.hint = cause.hint ?? undefined;
    this.cause = cause;
  }
}

const GENERIC = "Something went wrong. Please try again.";

/**
 * Postgres and PostgREST codes we can say something useful about. Anything not
 * listed falls back to GENERIC rather than leaking the raw text.
 */
const CODE_MESSAGES: Record<string, string> = {
  // Constraint violations
  "23505": "That already exists.",
  "23503": "The item this refers to no longer exists.",
  "23502": "Something required was missing.",
  "23514": "That value isn't allowed here.",
  // Access
  "42501": "You don't have access to that.",
  PGRST301: "Your session expired. Sign in again.",
  PGRST116: "We couldn't find that.",
  PGRST204: "We couldn't find that.",
  // Resource limits
  "53300": "The service is busy. Try again in a moment.",
  "57014": "That took too long. Try narrowing your filters.",
  "40001": "Someone else changed this at the same time. Try again.",
  "40P01": "Someone else changed this at the same time. Try again.",
};

/**
 * Specific constraints are worth a specific sentence — a generic
 * "That already exists" is unhelpful when the real answer is that you already
 * have a timer running.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  one_running_timer_per_user: "You already have a timer running. Stop it first.",
  tickets_workspace_number_key: "That ticket number is already taken.",
  saved_views_owner_id_scope_name_key: "You already have a view with that name.",
  ticket_relations_from_ticket_id_to_ticket_id_kind_key:
    "Those tickets are already linked that way.",
  workspace_members_pkey: "They're already a member of this workspace.",
  project_members_project_id_user_id_key: "They're already on this project.",
  user_roles_user_workspace_role_key: "They already have that role.",
  payments_provider_provider_ref_key: "That payment was already recorded.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Postgrest errors arrive as plain objects, not Error instances. */
export function isPostgrestError(
  e: unknown,
): e is { message: string; code?: string; details?: string; hint?: string } {
  return isRecord(e) && typeof e.message === "string" && ("code" in e || "details" in e);
}

function constraintMessage(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/constraint "([^"]+)"|"([^"]+)"/);
  const name = match?.[1] ?? match?.[2];
  return name ? CONSTRAINT_MESSAGES[name] : undefined;
}

/** Turn anything thrown into a sentence it is safe to show someone. */
export function toUserMessage(e: unknown, fallback: string = GENERIC): string {
  if (e instanceof AppError) return e.message;

  if (e instanceof DataError) {
    return (
      constraintMessage(e.message) ??
      constraintMessage(e.details) ??
      (e.pgCode ? CODE_MESSAGES[e.pgCode] : undefined) ??
      fallback
    );
  }

  if (isPostgrestError(e)) {
    return (
      constraintMessage(e.message) ??
      constraintMessage(e.details) ??
      (e.code ? CODE_MESSAGES[e.code] : undefined) ??
      fallback
    );
  }

  if (e instanceof Error) {
    // The auth middleware rejects with "Unauthorized: ..." before any handler runs.
    if (e.message.startsWith("Unauthorized")) return "Please sign in again.";
    if (e.name === "AbortError") return "That was cancelled.";
    if (e.message === "Failed to fetch" || e.name === "TypeError") {
      return "Couldn't reach the server. Check your connection.";
    }
  }

  return fallback;
}

/** Retrying a permission denial or a validation failure only wastes time. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof AppError) return e.status >= 500;
  const code = e instanceof DataError ? e.pgCode : isPostgrestError(e) ? e.code : undefined;
  if (code) {
    if (code.startsWith("PGRST")) return false;
    // 23xxx integrity, 42xxx syntax/access, 22xxx data exception
    if (/^(23|42|22)/.test(code)) return false;
  }
  if (e instanceof Error && e.message.startsWith("Unauthorized")) return false;
  return true;
}

/**
 * A stable key for grouping the same failure across occurrences, so the error
 * list shows "this happened 40 times" rather than 40 separate rows.
 */
export function fingerprint(e: unknown, scope = "app"): string {
  if (e instanceof DataError) return `${scope}:${e.op}:${e.pgCode ?? "unknown"}`;
  if (e instanceof AppError) return `${scope}:${e.code}`;
  if (isPostgrestError(e)) return `${scope}:postgrest:${e.code ?? "unknown"}`;
  if (e instanceof Error) {
    // Drop digits and UUIDs so "ticket abc-123 not found" groups with its siblings.
    const normalised = e.message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
      .replace(/\d+/g, "<n>")
      .slice(0, 120);
    return `${scope}:${e.name}:${normalised}`;
  }
  return `${scope}:unknown`;
}

/** Full detail for the error tracker. Never rendered to a person. */
export function describeError(e: unknown): {
  message: string;
  stack?: string;
  extra?: ErrorContext;
} {
  if (e instanceof DataError) {
    return {
      message: e.message,
      stack: e.stack,
      extra: { op: e.op, pgCode: e.pgCode, details: e.details, hint: e.hint },
    };
  }
  if (e instanceof AppError) {
    return { message: e.message, stack: e.stack, extra: { code: e.code, ...e.context } };
  }
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  if (isPostgrestError(e))
    return { message: e.message, extra: { code: e.code, details: e.details } };
  return { message: String(e) };
}
