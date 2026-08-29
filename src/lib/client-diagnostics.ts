/**
 * A rolling record of what the browser was complaining about.
 *
 * The single biggest difference between "the checkout is broken" and a bug
 * somebody can act on is the console output and the failed request that came
 * with it. A client will never think to include either, so the app collects
 * them continuously and attaches them to whatever they report.
 *
 * Three rules, because this runs in front of every console call the app makes:
 *   - never swallow: the original console method is always called;
 *   - never grow: both buffers are capped by entry count and by total bytes;
 *   - never throw: a failure in here must not become the bug being reported.
 */

export interface ConsoleEntry {
  level: "log" | "warn" | "error";
  ts: string;
  message: string;
}

export interface NetworkEntry {
  url: string;
  status: number;
  method: string;
  ts: string;
}

const MAX_CONSOLE_ENTRIES = 100;
const MAX_NETWORK_ENTRIES = 50;
const MAX_MESSAGE_CHARS = 500;
/** Roughly 64KB of text, so a chatty app cannot bloat a ticket. */
const MAX_TOTAL_CHARS = 64_000;

let consoleBuffer: ConsoleEntry[] = [];
let networkBuffer: NetworkEntry[] = [];
let installed = false;

function totalChars(): number {
  let n = 0;
  for (const e of consoleBuffer) n += e.message.length;
  for (const e of networkBuffer) n += e.url.length;
  return n;
}

function trim() {
  while (consoleBuffer.length > MAX_CONSOLE_ENTRIES) consoleBuffer.shift();
  while (networkBuffer.length > MAX_NETWORK_ENTRIES) networkBuffer.shift();
  while (totalChars() > MAX_TOTAL_CHARS && consoleBuffer.length > 1) consoleBuffer.shift();
}

/** Console arguments are arbitrary; stringify without ever throwing. */
function stringify(args: unknown[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  return parts.join(" ").slice(0, MAX_MESSAGE_CHARS);
}

function record(level: ConsoleEntry["level"], args: unknown[]) {
  try {
    consoleBuffer.push({ level, ts: new Date().toISOString(), message: stringify(args) });
    trim();
  } catch {
    // Deliberately silent.
  }
}

/** Query strings carry tokens and personal data; the path is what diagnoses. */
function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0]?.slice(0, 300) ?? url.slice(0, 300);
  }
}

/**
 * Idempotent. Returns a function that puts the originals back, which matters
 * for tests and for React 18 double-invoked effects.
 */
export function installClientDiagnostics(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const originalConsole = {
    // eslint-disable-next-line no-console -- capturing the original to restore it
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.warn = (...args: unknown[]) => {
    record("warn", args);
    originalConsole.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    record("error", args);
    originalConsole.error(...args);
  };

  const onError = (event: ErrorEvent) => {
    record("error", [event.message, event.filename ? `at ${event.filename}:${event.lineno}` : ""]);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    record("error", ["Unhandled rejection:", event.reason]);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    try {
      const response = await originalFetch(...args);
      if (!response.ok) {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        networkBuffer.push({
          url: scrubUrl(url),
          status: response.status,
          method: (init?.method ?? "GET").toUpperCase(),
          ts: new Date().toISOString(),
        });
        trim();
      }
      return response;
    } catch (error) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      networkBuffer.push({
        url: scrubUrl(url),
        status: 0, // The request never completed.
        method: (init?.method ?? "GET").toUpperCase(),
        ts: new Date().toISOString(),
      });
      trim();
      throw error;
    }
  };

  return () => {
    // eslint-disable-next-line no-console -- restoring what we replaced
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.fetch = originalFetch;
    installed = false;
  };
}

export function getDiagnostics(): { console: ConsoleEntry[]; network: NetworkEntry[] } {
  return { console: [...consoleBuffer], network: [...networkBuffer] };
}

export function clearDiagnostics() {
  consoleBuffer = [];
  networkBuffer = [];
}

/** Test seam. */
export const __testing = {
  get consoleBuffer() {
    return consoleBuffer;
  },
  get networkBuffer() {
    return networkBuffer;
  },
  limits: { MAX_CONSOLE_ENTRIES, MAX_NETWORK_ENTRIES, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS },
};
