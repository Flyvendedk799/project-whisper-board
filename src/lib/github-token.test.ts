import { describe, expect, it, vi } from "vitest";
import { MemoryCredentialStore, SecretBox } from "@flyvendedk799/ai-auth";
import { AppError } from "@/lib/errors";
import { describeGitHubError } from "@/lib/github-port";
import { createGitHubTokens, githubFor, identifyToken, pickToken } from "./github-token";

const SECRET = "a-host-secret-with-plenty-of-entropy-0123456789";
const TOKEN = "ghp_realLookingToken0123456789abcdefghijkl";
const OTHER = "github_pat_11ABCDEFG0123456789_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

/** A GitHub that knows which tokens are good and what login each belongs to. */
function fakeGitHub(good: Record<string, { login: string; scopes?: string }>) {
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    const token = auth.replace(/^Bearer /, "");
    seen.push(token);
    const who = good[token];
    if (!who) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    return new Response(JSON.stringify({ login: who.login }), {
      status: 200,
      headers: who.scopes ? { "x-oauth-scopes": who.scopes } : {},
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen, calls: fetchImpl };
}

function world(
  opts: {
    env?: Record<string, string | undefined>;
    secret?: string | null;
    good?: Record<string, { login: string; scopes?: string }>;
  } = {},
) {
  const store = new MemoryCredentialStore();
  const gh = fakeGitHub(opts.good ?? { [TOKEN]: { login: "tobias", scopes: "repo, read:user" } });
  const tokens = createGitHubTokens({
    store,
    secret: opts.secret === undefined ? SECRET : opts.secret,
    env: opts.env ?? {},
    fetch: gh.fetchImpl,
  });
  return { store, gh, tokens };
}

describe("pickToken", () => {
  it("prefers your own token over the shared one", () => {
    expect(pickToken("mine", "shared")).toEqual({ token: "mine", source: "user" });
  });

  it("falls back to the shared token, and says it is the shared one", () => {
    expect(pickToken(null, "shared")).toEqual({ token: "shared", source: "workspace" });
    expect(pickToken("  ", "shared")).toEqual({ token: "shared", source: "workspace" });
  });

  it("is not connected when there is neither", () => {
    expect(pickToken(null, undefined)).toBeNull();
    expect(pickToken("", "")).toBeNull();
  });
});

describe("identifyToken", () => {
  it("reads the login and the scopes of a classic token", async () => {
    const { gh } = world();
    expect(await identifyToken(TOKEN, gh.fetchImpl)).toEqual({
      login: "tobias",
      scopes: ["repo", "read:user"],
    });
  });

  it("reports no scopes for a fine-grained token, which does not list any", async () => {
    const { gh } = world({ good: { [OTHER]: { login: "someone" } } });
    expect(await identifyToken(OTHER, gh.fetchImpl)).toEqual({ login: "someone", scopes: null });
  });

  it("turns a rejected token into a message a person can act on", async () => {
    const { gh } = world();
    const failure = await identifyToken("nope", gh.fetchImpl).catch((e) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure.code).toBe("github_token_invalid");
    expect(failure.status).toBe(400);
    expect(failure.message).toContain("GitHub rejected that token");
  });

  it("says GitHub is unreachable, not that the token is bad, when GitHub fails", async () => {
    const down = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    const failure = await identifyToken(TOKEN, down).catch((e) => e);
    expect(failure.code).toBe("github_unreachable");
    expect(failure.status).toBe(502);

    const offline = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect((await identifyToken(TOKEN, offline).catch((e) => e)).code).toBe("github_unreachable");
  });
});

describe("connecting a token", () => {
  it("checks it with GitHub, then keeps it sealed: the stored row never holds the token", async () => {
    const { store, tokens } = world();
    const status = await tokens.save("user-1", TOKEN);

    expect(status).toMatchObject({ connected: true, source: "user", login: "tobias" });
    const row = await store.read("boared:github:user-1");
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(row!.payload).not.toContain(TOKEN);
    expect(row!.meta.login).toBe("tobias");
    // It does open under the right key, so it is genuinely recoverable.
    expect(new SecretBox(SECRET, "boared:github-token").open(row!.payload)).toBe(TOKEN);
  });

  it("never gives the token back: a status carries a login and a masked hint only", async () => {
    const { tokens } = world();
    const status = await tokens.save("user-1", TOKEN);
    const wire = JSON.stringify(status);
    expect(wire).not.toContain(TOKEN);
    expect(status.hint).not.toBe(TOKEN);
    expect(status.hint).toContain("…");
    expect(JSON.stringify(await tokens.status("user-1"))).not.toContain(TOKEN);
  });

  it("stores nothing for a token GitHub refuses", async () => {
    const { store, tokens } = world();
    await expect(tokens.save("user-1", "ghp_wrong")).rejects.toMatchObject({
      code: "github_token_invalid",
    });
    expect(await store.read("boared:github:user-1")).toBeNull();
  });

  it("refuses something that is not a token without bothering GitHub", async () => {
    const { gh, tokens } = world();
    for (const bad of ["", "   ", "two words", "a\nb", "x".repeat(300)]) {
      await expect(tokens.save("user-1", bad)).rejects.toMatchObject({
        code: "github_token_invalid",
      });
    }
    expect(gh.calls).not.toHaveBeenCalled();
  });

  it("trims what was pasted", async () => {
    const { tokens, gh } = world();
    await tokens.save("user-1", `  ${TOKEN}\n`);
    expect(gh.seen[0]).toBe(TOKEN);
  });

  it("cannot store anything on a deployment with no secret, and says so", async () => {
    const { tokens } = world({ secret: null });
    await expect(tokens.save("user-1", TOKEN)).rejects.toMatchObject({
      code: "github_unavailable",
      status: 501,
    });
  });

  it("keeps people apart: one person's token is not another's", async () => {
    const { tokens } = world();
    await tokens.save("user-1", TOKEN);
    expect(await tokens.resolve("user-2")).toBeNull();
    expect((await tokens.status("user-2")).connected).toBe(false);
  });

  it("disconnecting forgets only your own token", async () => {
    const { tokens } = world({
      env: { GITHUB_PAT: OTHER },
      good: { [TOKEN]: { login: "tobias" }, [OTHER]: { login: "shared-bot" } },
    });
    await tokens.save("user-1", TOKEN);
    expect((await tokens.resolve("user-1"))?.source).toBe("user");

    const after = await tokens.forget("user-1");
    expect(after).toMatchObject({ source: "workspace", login: "shared-bot" });
    expect(await tokens.resolve("user-1")).toEqual({ token: OTHER, source: "workspace" });
  });
});

describe("which token a call uses", () => {
  it("your own, when you have connected one", async () => {
    const { tokens } = world({ env: { GITHUB_PAT: OTHER } });
    await tokens.save("user-1", TOKEN);
    expect(await tokens.resolve("user-1")).toEqual({ token: TOKEN, source: "user" });
  });

  it("the shared one on the server when you have not, labelled as such", async () => {
    const { tokens } = world({ env: { GITHUB_PAT: OTHER } });
    expect(await tokens.resolve("user-1")).toEqual({ token: OTHER, source: "workspace" });
    expect(await tokens.resolve(null)).toEqual({ token: OTHER, source: "workspace" });
  });

  it("none at all is not connected", async () => {
    const { tokens } = world();
    expect(await tokens.resolve("user-1")).toBeNull();
    expect(await tokens.resolve(undefined)).toBeNull();
    expect(await tokens.status("user-1")).toMatchObject({
      connected: false,
      source: "none",
      login: null,
      hint: null,
    });
  });

  it("an unreadable stored token (the server secret changed) falls back and says to reconnect", async () => {
    const { store, tokens } = world({
      env: { GITHUB_PAT: OTHER },
      good: { [OTHER]: { login: "shared-bot" } },
    });
    // Written under another secret, as after a rotation.
    await store.write("boared:github:user-1", {
      payload: new SecretBox(
        "an-older-secret-0123456789abcdef0123456789",
        "boared:github-token",
      ).seal(TOKEN),
      meta: { login: "tobias" },
    });

    expect(await tokens.resolve("user-1")).toEqual({ token: OTHER, source: "workspace" });
    const status = await tokens.status("user-1");
    expect(status.problem).toContain("Connect it again");
  });

  it("a ciphertext sealed for some other store never opens as a GitHub token", async () => {
    const { store, tokens } = world();
    await store.write("boared:github:user-1", {
      payload: new SecretBox(SECRET, "some-other-label").seal(TOKEN),
      meta: {},
    });
    expect(await tokens.resolve("user-1")).toBeNull();
  });

  it("a failing read is an error, not 'not connected'", async () => {
    const store = new MemoryCredentialStore();
    store.read = async () => {
      throw new Error("database down");
    };
    const tokens = createGitHubTokens({
      store,
      secret: SECRET,
      env: {},
      fetch: fakeGitHub({}).fetchImpl,
    });
    await expect(tokens.resolve("user-1")).rejects.toThrow("database down");
  });
});

describe("status of the token in use", () => {
  it("explains a rejected shared token and points at connecting your own", async () => {
    const { tokens } = world({ env: { GITHUB_PAT: "stale" }, good: {} });
    const status = await tokens.status("user-1");
    expect(status).toMatchObject({ connected: false, source: "workspace" });
    expect(status.problem).toContain("Connect your own token");
  });

  it("explains a rejected personal token", async () => {
    const { tokens, store } = world();
    await tokens.save("user-1", TOKEN);
    // GitHub revokes it later.
    const revoked = createGitHubTokens({
      store,
      secret: SECRET,
      env: {},
      fetch: fakeGitHub({}).fetchImpl,
    });
    const status = await revoked.status("user-1");
    expect(status).toMatchObject({ connected: false, source: "user" });
    expect(status.problem).toContain("no longer accepts your token");
  });

  it("does not call a GitHub outage a bad token", async () => {
    const { store } = world();
    const tokens = createGitHubTokens({
      store,
      secret: SECRET,
      env: { GITHUB_PAT: TOKEN },
      fetch: (async () => new Response("", { status: 502 })) as unknown as typeof fetch,
    });
    expect((await tokens.status("user-1")).problem).toContain("Couldn't reach GitHub");
  });
});

describe("githubFor", () => {
  it("gives a port, and whose token it is", async () => {
    const { tokens } = world({ env: { GITHUB_PAT: OTHER } });
    await tokens.save("user-1", TOKEN);
    const mine = await githubFor("user-1", tokens);
    expect(mine.source).toBe("user");
    expect(mine.port).not.toBeNull();
    const theirs = await githubFor("user-2", tokens);
    expect(theirs.source).toBe("workspace");
  });

  it("gives no port when there is no token at all", async () => {
    const { tokens } = world();
    expect(await githubFor("user-1", tokens)).toEqual({ port: null, source: "none", token: null });
  });
});

describe("describeGitHubError", () => {
  it("tells you to reconnect when GitHub rejects your token", () => {
    const text = describeGitHubError({ status: 401, message: "Bad credentials" }, "merge #5");
    expect(text).toContain("rejected your token");
    expect(text).toContain("Reconnect GitHub in Settings");
    expect(text).not.toContain("GITHUB_PAT");
  });

  it("names the repository your token cannot write to", () => {
    const text = describeGitHubError(
      { status: 403, message: "Resource not accessible" },
      "merge #5",
      "o/openbot",
    );
    expect(text).toContain("Your token is not allowed to merge #5");
    expect(text).toContain("write access to o/openbot");
  });
});
