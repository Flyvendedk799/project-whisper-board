import { createServerOnlyFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * The public origin of the app (e.g. `https://boared.online`), for every link
 * the server puts in an email or hands to Supabase Auth as a `redirectTo`.
 *
 * `SITE_URL` wins when it is set. Without it the origin comes from the request
 * being served: the reverse proxy's `x-forwarded-proto` / `x-forwarded-host`,
 * then `host`, then the request URL. A localhost origin is never chosen in
 * production while a real host is on offer, because a link to localhost in an
 * email is broken for everyone who receives it.
 */

export type OriginRequest = {
  url?: string;
  headers?: { get(name: string): string | null };
};

export type OriginInput = {
  siteUrl?: string | null;
  request?: OriginRequest | null;
  production?: boolean;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** True for loopback and unspecified hosts that nobody else can reach. */
export function isLocalOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || /^127\./.test(hostname)
  );
}

/** First value of a header that a chain of proxies may have comma-joined. */
function firstHeader(request: OriginRequest | null | undefined, name: string): string | undefined {
  const raw = request?.headers?.get(name);
  const value = raw?.split(",")[0]?.trim();
  return value || undefined;
}

/** `scheme://host[:port]` with no trailing slash, or undefined if unusable. */
function normalise(candidate: string | undefined | null): string | undefined {
  const value = candidate?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // Keep a path prefix if SITE_URL carries one (app served under /boared).
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function fromRequest(request: OriginRequest | null | undefined, production: boolean): string[] {
  if (!request) return [];
  let requestUrl: URL | undefined;
  try {
    requestUrl = request.url ? new URL(request.url) : undefined;
  } catch {
    requestUrl = undefined;
  }

  const forwardedProto = firstHeader(request, "x-forwarded-proto")?.replace(/:$/, "");
  const forwardedHost = firstHeader(request, "x-forwarded-host");
  const host = firstHeader(request, "host");
  const urlProto = requestUrl?.protocol.replace(/:$/, "");

  const candidates: string[] = [];
  const add = (proto: string | undefined, hostValue: string | undefined) => {
    if (!hostValue) return;
    // Behind a TLS-terminating proxy the app itself sees plain http, so with no
    // x-forwarded-proto a public host in production is assumed to be https.
    const fallbackProto =
      production && !isLocalOrigin(`http://${hostValue}`) ? "https" : (urlProto ?? "http");
    const origin = normalise(`${proto ?? fallbackProto}://${hostValue}`);
    if (origin && !candidates.includes(origin)) candidates.push(origin);
  };
  add(forwardedProto, forwardedHost);
  add(forwardedProto, host);
  if (requestUrl) add(requestUrl.protocol.replace(/:$/, ""), requestUrl.host);
  return candidates;
}

/** Pure resolution, so it can be tested without a running server. */
export function resolveAppOrigin({
  siteUrl,
  request,
  production = false,
}: OriginInput): string | undefined {
  const configured = normalise(siteUrl);
  const candidates = [...(configured ? [configured] : []), ...fromRequest(request, production)];
  if (candidates.length === 0) return undefined;
  if (production) {
    const publicOrigin = candidates.find((origin) => !isLocalOrigin(origin));
    if (publicOrigin) return publicOrigin;
  }
  return candidates[0];
}

/**
 * The request being served, or null outside a request (scripts, tests).
 * Server-only so the request import stays out of the client bundle: this module
 * is reachable from modules that the browser also loads.
 */
const readRequest = createServerOnlyFn((): OriginRequest | null => getRequest() ?? null);

function currentRequest(): OriginRequest | null {
  try {
    return readRequest();
  } catch {
    return null;
  }
}

/**
 * The app's public origin for the request being served. Throws when there is
 * neither a `SITE_URL` nor a request to read it from, rather than letting Supabase
 * Auth fall back to its own (often localhost) site URL.
 */
export function appOrigin(): string {
  const origin = resolveAppOrigin({
    siteUrl: process.env.SITE_URL,
    request: currentRequest(),
    production: process.env.NODE_ENV === "production",
  });
  if (!origin) {
    throw new Error("Cannot build a link: set SITE_URL to the app's public origin");
  }
  return origin;
}

/** An absolute link into the app, e.g. `appUrl("/invite/accept")`. */
export function appUrl(path: string): string {
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
