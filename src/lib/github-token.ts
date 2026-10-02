import { SecretBox, maskSecret, type CredentialStore } from "@flyvendedk799/ai-auth";
import { AppError } from "@/lib/errors";
import { sealingSecret } from "@/lib/ai-auth/secret";
import { SupabaseCredentialStore } from "@/lib/ai-auth/store";
import { octokitPort, type GitHubPort } from "@/lib/github-port";

export { NOT_CONNECTED_MESSAGE } from "@/lib/github-port";

/**
 * A person's own GitHub token, kept sealed, and the one place that decides which token a GitHub call uses.
 *
 * Whose token: the signed-in user's own. An API key acts as the person who made it. Only when that
 * person has not connected GitHub does the deployment's `GITHUB_PAT` (if any) answer, and `source` says
 * so, because a screen that cannot tell "your token" from "the shared one" invites a second one to be
 * pasted over a working setup.
 *
 * SERVER ONLY: it reaches for `node:crypto` through the sealing box. Import it inside server handlers,
 * never at the top of a module the browser also loads.
 *
 * The token never leaves this file in the clear except to the code about to call GitHub with it. What a
 * browser gets is a login name, the scopes GitHub reported, and a masked hint.
 */

/** Namespaces the encryption key: a GitHub ciphertext must not open under any other store's key. */
const SEAL_LABEL = "boared:github-token";

const GITHUB_API = "https://api.github.com";

const storeKey = (userId: string) => `boared:github:${userId}`;

export type GitHubTokenSource = "user" | "workspace";
export type ResolvedGitHub = { token: string; source: GitHubTokenSource };

export interface GitHubConnection {
  /** False when this deployment has nowhere to keep a token. */
  available: boolean;
  /** A token is in use and GitHub accepts it. */
  connected: boolean;
  /** Whose token answers: your own, the shared one on the server, or none. */
  source: GitHubTokenSource | "none";
  login: string | null;
  /** Classic tokens report their scopes; fine-grained ones do not, so null is normal. */
  scopes: string[] | null;
  /** Enough to recognise the token, never enough to use it. */
  hint: string | null;
  /** What is wrong, in words a person can act on. Null when nothing is. */
  problem: string | null;
}

/**
 * The order of preference, and nothing else. Your own token wins over the shared one; neither means
 * "not connected". Pure so the order is stated once and tested.
 */
export function pickToken(
  stored: string | null | undefined,
  env: string | null | undefined,
): ResolvedGitHub | null {
  const own = stored?.trim();
  if (own) return { token: own, source: "user" };
  const shared = env?.trim();
  if (shared) return { token: shared, source: "workspace" };
  return null;
}

export type GitHubIdentity = { login: string; scopes: string[] | null };

type FetchLike = typeof fetch;

/** Ask GitHub who a token belongs to. A rejected token is a 400 the person can act on, not a crash. */
export async function identifyToken(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubIdentity> {
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "boared",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    throw new AppError(
      "github_unreachable",
      "Couldn't reach GitHub to check that token. Try again.",
      {
        status: 502,
      },
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "github_token_invalid",
      "GitHub rejected that token. Check that you copied all of it and that it has not expired.",
      { status: 400 },
    );
  }
  if (!response.ok) {
    throw new AppError(
      "github_unreachable",
      `GitHub couldn't check that token right now (status ${response.status}). Try again.`,
      { status: 502 },
    );
  }

  const body = (await response.json().catch(() => null)) as { login?: unknown } | null;
  if (!body || typeof body.login !== "string" || body.login.length === 0) {
    throw new AppError("github_token_invalid", "GitHub did not say who that token belongs to.", {
      status: 400,
    });
  }
  const header = response.headers.get("x-oauth-scopes");
  const scopes =
    header === null
      ? null
      : header
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  return { login: body.login, scopes };
}

export interface GitHubTokenDeps {
  store: CredentialStore;
  /** The host's secret. Null when the deployment has none: nothing can be stored, but the shared token still works. */
  secret: string | null;
  /** Where the shared fallback lives. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

const UNAVAILABLE_MESSAGE = "This deployment can't store a GitHub connection.";

export function createGitHubTokens(deps: GitHubTokenDeps) {
  const env = deps.env ?? process.env;
  const box = deps.secret ? new SecretBox(deps.secret, SEAL_LABEL) : null;
  const fetchImpl = deps.fetch ?? fetch;

  /** The user's own token, or null when none is stored or the stored one can no longer be opened. */
  async function readOwn(userId: string): Promise<{ token: string | null; unreadable: boolean }> {
    if (!box) return { token: null, unreadable: false };
    // A failing read must not look like "no token": it would invite a second paste over a fine one.
    const record = await deps.store.read(storeKey(userId));
    if (!record) return { token: null, unreadable: false };
    const token = box.open(record.payload);
    return token ? { token, unreadable: false } : { token: null, unreadable: true };
  }

  /** No network: which token a call would use, and whose it is. */
  async function resolve(userId: string | null | undefined): Promise<ResolvedGitHub | null> {
    const own = userId ? await readOwn(userId) : { token: null, unreadable: false };
    return pickToken(own.token, env.GITHUB_PAT);
  }

  async function status(userId: string): Promise<GitHubConnection> {
    const available = box !== null;
    const own = await readOwn(userId);
    const resolved = pickToken(own.token, env.GITHUB_PAT);

    const unreadableNote = own.unreadable
      ? "Your saved token can't be read any more (the server's secret changed). Connect it again."
      : null;

    if (!resolved) {
      return {
        available,
        connected: false,
        source: "none",
        login: null,
        scopes: null,
        hint: null,
        problem: unreadableNote,
      };
    }

    try {
      const who = await identifyToken(resolved.token, fetchImpl);
      return {
        available,
        connected: true,
        source: resolved.source,
        login: who.login,
        scopes: who.scopes,
        hint: maskSecret(resolved.token),
        problem: unreadableNote,
      };
    } catch (e) {
      const rejected = e instanceof AppError && e.code === "github_token_invalid";
      return {
        available,
        connected: false,
        source: resolved.source,
        login: null,
        scopes: null,
        hint: maskSecret(resolved.token),
        problem: rejected
          ? resolved.source === "user"
            ? "GitHub no longer accepts your token. Connect it again."
            : "GitHub rejected the shared token on this server (GITHUB_PAT). Connect your own token instead."
          : "Couldn't reach GitHub to check the token just now.",
      };
    }
  }

  /** Check the token with GitHub, then keep it sealed. Nothing is stored for a token GitHub refuses. */
  async function save(userId: string, rawToken: string): Promise<GitHubConnection> {
    if (!box) throw new AppError("github_unavailable", UNAVAILABLE_MESSAGE, { status: 501 });
    const token = rawToken.trim();
    if (!token || /\s/.test(token) || token.length > 255) {
      throw new AppError(
        "github_token_invalid",
        "That doesn't look like a GitHub token. Paste just the token, nothing else.",
        { status: 400 },
      );
    }
    const who = await identifyToken(token, fetchImpl);
    await deps.store.write(storeKey(userId), {
      payload: box.seal(token),
      meta: {
        login: who.login,
        scopes: who.scopes ? who.scopes.join(",") : null,
        connectedAt: new Date().toISOString(),
      },
    });
    return status(userId);
  }

  async function forget(userId: string): Promise<GitHubConnection> {
    await deps.store.delete(storeKey(userId));
    return status(userId);
  }

  return { resolve, status, save, forget };
}

export type GitHubTokens = ReturnType<typeof createGitHubTokens>;

let shared: GitHubTokens | undefined;

/** The deployment's token service, backed by the app's own credential table. */
export function githubTokens(): GitHubTokens {
  shared ??= createGitHubTokens({
    store: new SupabaseCredentialStore(),
    secret: sealingSecret(),
  });
  return shared;
}

/** Test seam, and the reset after the secret changes under a running process. */
export function resetGitHubTokens() {
  shared = undefined;
}

export type GitHubAccess = {
  /** Null when there is no token to call GitHub with. */
  port: GitHubPort | null;
  source: GitHubTokenSource | "none";
  /** The raw token, for the few callers that use Octokit directly. Never send it anywhere else. */
  token: string | null;
};

/** What a call made on behalf of this person (or, for an API key, the person who made it) can use. */
export async function githubFor(
  userId: string | null | undefined,
  tokens: GitHubTokens = githubTokens(),
): Promise<GitHubAccess> {
  const resolved = await tokens.resolve(userId);
  if (!resolved) return { port: null, source: "none", token: null };
  return { port: octokitPort(resolved.token), source: resolved.source, token: resolved.token };
}
