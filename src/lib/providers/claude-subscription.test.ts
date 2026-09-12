import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The subscription path, which has one detail that fails in a way nobody would
 * guess: without the identity block, as the FIRST system block and in a block of
 * its own, the premium models answer 429 — a rate-limit status on a plan nowhere
 * near its limit. Haiku is exempt, which is the trap, because it is the cheap
 * model people reach for when testing.
 *
 * So these assert the request shape rather than any behaviour of ours.
 */

const status = vi.hoisted(() => vi.fn());
const token = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-auth/claude", () => ({
  claudeAccounts: () => ({ status, token }),
}));

import { getAiProviderFor, resetAiProvider } from "./ai";

const ENV = ["AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AI_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  status.mockReset();
  token.mockReset();
  resetAiProvider();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe("a connected Claude subscription", () => {
  it("authenticates as a bearer token and never sends x-api-key", async () => {
    status.mockResolvedValue({ connected: true, plan: "max", expired: false, scopes: [] });
    token.mockResolvedValue("oauth-token");

    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ai = await getAiProviderFor("user-1");
    expect(ai.name).toBe("claude-subscription");
    expect(await ai.chat([{ role: "user", content: "x" }])).toBe("ok");

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer oauth-token");
    // Present-but-wrong is worse than absent: Anthropic validates x-api-key
    // whenever the header exists, so sending both rejects a good credential.
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["user-agent"]).toMatch(/^claude-cli\//);
  });

  it("puts the identity first, in its own block, ahead of our prompt", async () => {
    status.mockResolvedValue({ connected: true, plan: "max", expired: false, scopes: [] });
    token.mockResolvedValue("oauth-token");
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await (
      await getAiProviderFor("user-1")
    ).chat([
      { role: "system", content: "be terse" },
      { role: "user", content: "x" },
    ]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
    });
    // Our own prompt survives as a separate block — folding the two together
    // does not count and is refused the same way as omitting the identity.
    expect(body.system[1]).toEqual({ type: "text", text: "be terse" });
  });

  it("resolves the token per call, so an expiry refreshes instead of failing", async () => {
    status.mockResolvedValue({ connected: true, plan: "max", expired: true, scopes: [] });
    token.mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }))),
    );

    const ai = await getAiProviderFor("user-1");
    await ai.chat([{ role: "user", content: "x" }]);
    await ai.chat([{ role: "user", content: "y" }]);
    expect(token).toHaveBeenCalledTimes(2);
  });

  it("falls back to the deployment key when nobody has connected an account", async () => {
    status.mockResolvedValue({ connected: false, plan: null, expired: false, scopes: [] });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const ai = await getAiProviderFor("user-1");
    expect(ai.name).toBe("anthropic");
    expect(token).not.toHaveBeenCalled();
  });

  it("a store that cannot be read does not take AI down for everyone else", async () => {
    status.mockRejectedValue(new Error("database is unreachable"));
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const ai = await getAiProviderFor("user-1");
    expect(ai.enabled).toBe(true);
    expect(ai.name).toBe("anthropic");
  });
});
