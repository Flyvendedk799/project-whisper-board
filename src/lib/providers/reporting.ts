import { describeError, fingerprint } from "@/lib/errors";
import type { ErrorTracker } from "./types";

/**
 * With no DSN, errors are still captured — fingerprinted, batched, and written
 * to `app_errors`, which Settings renders grouped by fingerprint. The point is
 * that a crash a client hit is discoverable without them telling you, which is
 * the whole value of error tracking; a hosted service just adds alerting.
 *
 * `capture` never throws and never awaits: reporting a failure must not be able
 * to cause one.
 */

type Pending = {
  fingerprint: string;
  message: string;
  stack?: string;
  side: "client" | "server";
  url?: string;
  context?: Record<string, unknown>;
  occurredAt: string;
};

type Sink = (batch: Pending[]) => void;

let sink: Sink | undefined;
let queue: Pending[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let currentUser: { id: string; email?: string } | null = null;

/**
 * Wired up once at startup — on the client to a server function, on the server
 * straight to the table. Until then errors queue rather than being dropped, so
 * failures during boot are not invisible.
 */
export function setErrorSink(next: Sink) {
  sink = next;
  flush();
}

function flush() {
  if (!sink || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    sink(batch);
  } catch {
    // A failing sink must not resurrect the error it was reporting.
  }
}

function enqueue(entry: Pending) {
  // Bounded: a render loop throwing on every frame must not exhaust memory.
  if (queue.length >= 50) queue.shift();
  queue.push(entry);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flush();
    }, 1000);
  }
}

function createLocalTracker(): ErrorTracker {
  return {
    name: "local",
    enabled: false,
    capture(error, context) {
      try {
        const described = describeError(error);
        console.error("[error]", described.message, { ...described.extra, ...context });
        enqueue({
          fingerprint: fingerprint(
            error,
            typeof context?.scope === "string" ? context.scope : "app",
          ),
          message: described.message,
          stack: described.stack,
          side: typeof window === "undefined" ? "server" : "client",
          url: typeof window === "undefined" ? undefined : window.location.href,
          context: { ...described.extra, ...context, userId: currentUser?.id },
          occurredAt: new Date().toISOString(),
        });
      } catch {
        // Deliberately silent.
      }
    },
    setUser(user) {
      currentUser = user;
    },
  };
}

function createSentryTracker(dsn: string): ErrorTracker {
  const local = createLocalTracker();
  // The SDK is loaded lazily so the placeholder path costs nothing. Until it
  // resolves, and if it fails to, capture still lands in app_errors.
  type SentryLike = {
    init(opts: { dsn: string; release?: string }): void;
    captureException(e: unknown, hint?: { extra?: Record<string, unknown> }): void;
    setUser(u: { id: string; email?: string } | null): void;
  };
  let sentry: SentryLike | undefined;

  // Computed specifier: @sentry/browser is an optional peer that is not
  // installed by default, and a literal import would fail typecheck and get
  // bundled. This resolves only when the package is actually present.
  const sentryModule = "@sentry/browser";
  void import(/* @vite-ignore */ sentryModule)
    .then((mod) => {
      sentry = mod as unknown as SentryLike;
      sentry.init({ dsn, release: import.meta.env?.VITE_APP_VERSION });
      if (currentUser) sentry.setUser(currentUser);
    })
    .catch(() => {
      console.warn("[error] SENTRY_DSN is set but @sentry/browser is not installed");
    });

  return {
    name: "sentry",
    enabled: true,
    capture(error, context) {
      local.capture(error, context);
      try {
        sentry?.captureException(error, { extra: context });
      } catch {
        // Deliberately silent.
      }
    },
    setUser(user) {
      currentUser = user;
      try {
        sentry?.setUser(user);
      } catch {
        // Deliberately silent.
      }
    },
  };
}

let cached: ErrorTracker | undefined;

export function getErrorTracker(): ErrorTracker {
  if (cached) return cached;
  const dsn =
    (typeof process !== "undefined" ? process.env.SENTRY_DSN : undefined) ??
    import.meta.env?.VITE_SENTRY_DSN;
  cached = dsn ? createSentryTracker(dsn) : createLocalTracker();
  return cached;
}

/** Convenience wrapper so call sites read as one verb. */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  getErrorTracker().capture(error, context);
}

/** Test seam. */
export function resetErrorTracker() {
  cached = undefined;
  queue = [];
  sink = undefined;
  currentUser = null;
}
