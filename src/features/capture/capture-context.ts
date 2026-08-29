import { getDiagnostics } from "@/lib/client-diagnostics";

/**
 * What the browser knows and the client would never think to tell you.
 *
 * A client writes "the checkout is broken". What actually diagnoses it is the
 * URL, the browser and version, the viewport, and the two console errors that
 * fired just before they gave up. None of that is something a person should be
 * asked to collect.
 */

export interface CaptureContextInput {
  url?: string;
  pageTitle?: string;
  referrer?: string;
  userAgent?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  deviceType?: string;
  viewportW?: number;
  viewportH?: number;
  screenW?: number;
  screenH?: number;
  dpr?: number;
  timezone?: string;
  locale?: string;
  online?: boolean;
  appVersion?: string;
  consoleLog?: unknown[];
  networkErrors?: unknown[];
}

/** Chromium exposes this; other engines do not, so it stays optional. */
interface UserAgentData {
  brands?: Array<{ brand: string; version: string }>;
  platform?: string;
  mobile?: boolean;
}

/**
 * Prefers navigator.userAgentData, which reports the real brand and version.
 * UA-string sniffing is the fallback and is deliberately shallow: getting
 * "Safari 17" slightly wrong is a much smaller problem than a parser that
 * throws while someone is trying to report a bug.
 */
function identifyBrowser(ua: string, data?: UserAgentData): { name?: string; version?: string } {
  const brands = data?.brands?.filter((b) => !/not.a.brand/i.test(b.brand));
  if (brands?.length) {
    const preferred =
      brands.find((b) => /chrome|edge|firefox|safari|opera/i.test(b.brand)) ?? brands.at(-1)!;
    return { name: preferred.brand, version: preferred.version };
  }

  const patterns: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  for (const [pattern, name] of patterns) {
    const match = ua.match(pattern);
    if (match) return { name, version: match[1] };
  }
  return {};
}

function identifyOs(ua: string, platform?: string): string | undefined {
  if (platform) return platform;
  if (/Windows NT 10/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

function deviceType(width: number, mobile?: boolean): string {
  if (mobile) return "mobile";
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/**
 * Collect at the moment the person decides to report, not at submit — opening
 * the report flow changes location.href, and the page they were on is the whole
 * point.
 */
export function collectCaptureContext(
  overrides: Partial<CaptureContextInput> = {},
): CaptureContextInput {
  if (typeof window === "undefined") return { ...overrides };

  const nav = navigator as Navigator & { userAgentData?: UserAgentData };
  const ua = nav.userAgent ?? "";
  const browser = identifyBrowser(ua, nav.userAgentData);
  const diagnostics = getDiagnostics();

  return {
    url: window.location.href,
    pageTitle: document.title,
    referrer: document.referrer || undefined,
    userAgent: ua.slice(0, 1000),
    browser: browser.name,
    browserVersion: browser.version,
    os: identifyOs(ua, nav.userAgentData?.platform),
    deviceType: deviceType(window.innerWidth, nav.userAgentData?.mobile),
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    screenW: window.screen?.width,
    screenH: window.screen?.height,
    dpr: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: nav.language,
    online: nav.onLine,
    appVersion: import.meta.env?.VITE_APP_VERSION,
    consoleLog: diagnostics.console.length ? diagnostics.console : undefined,
    networkErrors: diagnostics.network.length ? diagnostics.network : undefined,
    ...overrides,
  };
}

/** One line for the person filing the report, so the collection is not a secret. */
export function summariseContext(context: CaptureContextInput): string {
  const parts = [
    [context.browser, context.browserVersion].filter(Boolean).join(" "),
    context.os,
    context.viewportW && context.viewportH ? `${context.viewportW}×${context.viewportH}` : "",
  ].filter(Boolean);

  const problems: string[] = [];
  if (context.consoleLog?.length) problems.push(`${context.consoleLog.length} console messages`);
  if (context.networkErrors?.length)
    problems.push(`${context.networkErrors.length} failed requests`);

  return [parts.join(" · "), problems.join(", ")].filter(Boolean).join(" — ");
}
