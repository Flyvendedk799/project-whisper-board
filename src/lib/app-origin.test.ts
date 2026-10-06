import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!request.current) throw new Error("no request in scope");
    return request.current;
  },
}));

import { appOrigin, appUrl, isLocalOrigin, resolveAppOrigin } from "./app-origin";

const headers = (init: Record<string, string>) => new Headers(init);

describe("resolveAppOrigin", () => {
  it("uses SITE_URL when it is set", () => {
    expect(
      resolveAppOrigin({
        siteUrl: "https://boared.online",
        request: { url: "http://127.0.0.1:3000/_serverFn/x", headers: headers({}) },
      }),
    ).toBe("https://boared.online");
  });

  it("drops a trailing slash from SITE_URL", () => {
    expect(resolveAppOrigin({ siteUrl: "https://boared.online/" })).toBe("https://boared.online");
    expect(resolveAppOrigin({ siteUrl: " https://boared.online// " })).toBe(
      "https://boared.online",
    );
  });

  it("derives the origin from forwarded headers when SITE_URL is unset", () => {
    expect(
      resolveAppOrigin({
        siteUrl: undefined,
        production: true,
        request: {
          url: "http://127.0.0.1:3000/_serverFn/abc",
          headers: headers({
            host: "127.0.0.1:3000",
            "x-forwarded-proto": "https",
            "x-forwarded-host": "boared.online",
          }),
        },
      }),
    ).toBe("https://boared.online");
  });

  it("takes the first value of comma-joined forwarded headers", () => {
    expect(
      resolveAppOrigin({
        siteUrl: "",
        request: {
          headers: headers({
            "x-forwarded-proto": "https, http",
            "x-forwarded-host": "boared.online, proxy.internal",
          }),
        },
      }),
    ).toBe("https://boared.online");
  });

  it("falls back to the host header, assuming https for a public host in production", () => {
    expect(
      resolveAppOrigin({
        production: true,
        request: { url: "http://boared.online/x", headers: headers({ host: "boared.online" }) },
      }),
    ).toBe("https://boared.online");
  });

  it("never picks localhost in production while a real host is available", () => {
    expect(
      resolveAppOrigin({
        siteUrl: "http://localhost:3000",
        production: true,
        request: {
          url: "http://localhost:3000/x",
          headers: headers({ host: "localhost:3000", "x-forwarded-host": "boared.online" }),
        },
      }),
    ).toBe("https://boared.online");
  });

  it("keeps localhost in development", () => {
    expect(
      resolveAppOrigin({
        production: false,
        request: { url: "http://localhost:8080/x", headers: headers({ host: "localhost:8080" }) },
      }),
    ).toBe("http://localhost:8080");
  });

  it("returns undefined when there is nothing to go on", () => {
    expect(resolveAppOrigin({})).toBeUndefined();
    expect(resolveAppOrigin({ siteUrl: "not a url" })).toBeUndefined();
  });
});

describe("isLocalOrigin", () => {
  it("recognises loopback hosts", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:54321",
      "http://0.0.0.0",
      "http://[::1]:3000",
      "http://app.localhost",
    ]) {
      expect(isLocalOrigin(origin)).toBe(true);
    }
    expect(isLocalOrigin("https://boared.online")).toBe(false);
  });
});

describe("appOrigin / appUrl", () => {
  afterEach(() => {
    request.current = null;
    vi.unstubAllEnvs();
  });

  it("reads SITE_URL from the environment", () => {
    vi.stubEnv("SITE_URL", "https://boared.online/");
    expect(appOrigin()).toBe("https://boared.online");
    expect(appUrl("/invite/accept?project=1")).toBe(
      "https://boared.online/invite/accept?project=1",
    );
  });

  it("reads the current request when SITE_URL is unset", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    request.current = new Request("http://127.0.0.1:3000/_serverFn/x", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "boared.online" },
    });
    expect(appUrl("invite/accept")).toBe("https://boared.online/invite/accept");
  });

  it("throws rather than handing Supabase an empty redirect", () => {
    vi.stubEnv("SITE_URL", "");
    expect(() => appOrigin()).toThrow(/SITE_URL/);
  });
});
